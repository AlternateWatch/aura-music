import { AudioSettings, DEFAULT_AUDIO_SETTINGS } from "./audioSettings";
import { EQ_FREQUENCIES, EQ_Q, bandType, autoPreampDb } from "./eqMath";
import { LOUDNESS_WORKLET_NAME, LOUDNESS_WORKLET_SOURCE } from "./loudnessWorklet";
import { LoudnessCache, SLOT_SECONDS, TrackAnalysis, msToLufs, IntegratedResult } from "./loudnessAnalysis";

// Cadena de señal Dual-Player (Gapless 0ms + Crossfade + Normalizador + EQ):
//
//   Player A ──► sourceA ──► gainA ──┐
//                                    ├──► preSum ──► norm ──► preamp ──► EQ (10 bandas) ──► limitador ──► volumen ──► analizador ──► salida
//   Player B ──► sourceB ──► gainB ──┘     ▲
//                                          └──► medidor (K-weighting, solo lectura)
//
// El medidor lee la señal ANTES de norma/EQ/volumen.
// Player A y Player B cuentan con sus propios nodos de ganancia independientes (gainA, gainB)
// antes de la suma, permitiendo transiciones instantáneas 0 ms (Gapless) o fundidos (Crossfade)
// manteniendo activos e ininterrumpidos el analizador de espectro, normalizador y ecualizador.

export type GainSource = "off" | "cache" | "live" | "prior" | "waiting";

export interface AudioStatus {
  graphReady: boolean;
  meter: "loading" | "ready" | "unsupported";
  normalizerActive: boolean;
  source: GainSource;
  /** LUFS integrado de la canción (medido hasta ahora o guardado). */
  lufs: number | null;
  /** Ganancia que está aplicando el normalizador (dB). */
  gainDb: number;
  targetLufs: number;
  /** Fracción de la canción ya analizada [0..1]. */
  coverage: number;
  /** Sonoridad momentánea (400 ms) para el medidor en vivo. */
  momentaryLufs: number | null;
  /** Reducción actual del limitador (dB, ≤ 0). */
  limiterReductionDb: number;
}

export const IDLE_STATUS: AudioStatus = {
  graphReady: false,
  meter: "loading",
  normalizerActive: false,
  source: "off",
  lufs: null,
  gainDb: 0,
  targetLufs: -14,
  coverage: 0,
  momentaryLufs: null,
  limiterReductionDb: 0,
};

const MAX_BOOST_DB = 12;
const MAX_CUT_DB = -24;
/** Con poca información no se sube más de esto (bajar siempre es seguro). */
const UNSURE_BOOST_DB = 6;
/** Segundos de audio "válido" a partir de los cuales la estimación en vivo es fiable. */
const CONFIDENT_SECONDS = 30;
/** Se guarda en caché al analizar al menos este porcentaje de la canción. */
const SAVE_COVERAGE = 0.8;

const LIMITER_THRESHOLD_DB = -1;
const LIMITER_RATIO = 20;
function limiterMakeupCompensation(): number {
  const outDb = LIMITER_THRESHOLD_DB + (0 - LIMITER_THRESHOLD_DB) / LIMITER_RATIO;
  const fullRangeGain = Math.pow(10, outDb / 20);
  const makeup = Math.pow(1 / fullRangeGain, 0.6);
  return 1 / makeup;
}

const dbToLin = (db: number) => Math.pow(10, db / 20);

const sharedCache = new LoudnessCache();

function createImpulseResponse(ctx: AudioContext, duration = 2.5, decay = 2.2): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const env = Math.pow(1 - n, decay);
    left[i] = (Math.random() * 2 - 1) * env;
    right[i] = (Math.random() * 2 - 1) * env;
  }
  return impulse;
}

export class AudioGraph {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;

  readonly audioA: HTMLAudioElement;
  readonly audioB: HTMLAudioElement;
  private sourceA: MediaElementAudioSourceNode;
  private sourceB: MediaElementAudioSourceNode;
  private gainA: GainNode;
  private gainB: GainNode;
  private preSum: GainNode;

  private activePlayer: "A" | "B" = "A";

  private norm: GainNode;
  private preamp: GainNode;
  private filters: BiquadFilterNode[] = [];
  private limiter: DynamicsCompressorNode;
  private master: GainNode;
  private convolver: ConvolverNode;
  private reverbWetGain: GainNode;
  private reverbDryGain: GainNode;
  private reverbMerge: GainNode;
  private meterNode: AudioWorkletNode | null = null;
  private meterInitStarted = false;
  private meterConnected = false;
  private meterState: AudioStatus["meter"] = "loading";
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextPreparedSrc: string | null = null;
  private activeDspChainKey = "";

  private settings: AudioSettings = JSON.parse(JSON.stringify(DEFAULT_AUDIO_SETTINGS));
  private volume = 0.7;
  private limiterComp = limiterMakeupCompensation();

  // Estado de la canción actual
  private trackId: string | null = null;
  private duration = NaN;
  private analysis = new TrackAnalysis();
  private live: IntegratedResult = { lufs: null, gatedSeconds: 0 };
  private cachedLufs: number | null = null;
  private lastIntegrate = 0;
  private ignoreUntil = 0;
  private ring = new Float64Array(4);
  private ringCount = 0;
  private ringPos = 0;
  private momentary: number | null = null;

  private appliedDb = 0;
  private source_: GainSource = "off";

  private status: AudioStatus = IDLE_STATUS;
  private lastPublish = 0;
  private listeners = new Set<() => void>();

  private onSeeked = () => { this.ignoreUntil = performance.now() + 300; };
  private onEnded = () => this.finalizeTrack();

  constructor(primaryAudio: HTMLAudioElement, secondaryAudio?: HTMLAudioElement) {
    this.audioA = primaryAudio;
    this.audioB = secondaryAudio ?? new Audio();
    this.audioB.crossOrigin = "anonymous";
    this.audioB.preload = "auto";

    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: "playback" });
    const ctx = this.ctx;

    // Conexión Dual Player hacia el bus preSum
    this.sourceA = ctx.createMediaElementSource(this.audioA);
    this.sourceB = ctx.createMediaElementSource(this.audioB);

    this.gainA = ctx.createGain();
    this.gainA.gain.value = 1;

    this.gainB = ctx.createGain();
    this.gainB.gain.value = 0;

    this.preSum = ctx.createGain();
    this.preSum.gain.value = 1;

    this.sourceA.connect(this.gainA);
    this.gainA.connect(this.preSum);

    this.sourceB.connect(this.gainB);
    this.gainB.connect(this.preSum);

    // Cadena DSP
    this.norm = ctx.createGain();
    this.preamp = ctx.createGain();

    this.filters = EQ_FREQUENCIES.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = bandType(i);
      b.frequency.value = f;
      b.Q.value = EQ_Q;
      b.gain.value = 0;
      return b;
    });

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER_THRESHOLD_DB;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = LIMITER_RATIO;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 64;

    this.rebuildChain(false, false);

    this.audioA.volume = 1;
    this.audioB.volume = 1;

    this.audioA.addEventListener("seeked", this.onSeeked);
    this.audioA.addEventListener("ended", this.onEnded);
    this.audioB.addEventListener("seeked", this.onSeeked);
    this.audioB.addEventListener("ended", this.onEnded);
  }

  private rebuildChain(eqOn: boolean, normOn: boolean) {
    const key = `${eqOn ? 1 : 0}:${normOn ? 1 : 0}`;
    if (this.activeDspChainKey === key) return;
    this.activeDspChainKey = key;

    const useLimiter = eqOn || normOn;
    const allNodes: AudioNode[] = [
      this.preSum,
      this.norm,
      this.preamp,
      ...this.filters,
      this.limiter,
      this.master,
      this.analyser,
    ];
    for (const n of allNodes) {
      try { n.disconnect(); } catch {}
    }

    const chain: AudioNode[] = [this.norm, this.preamp];
    if (eqOn) {
      chain.push(...this.filters);
    }
    if (useLimiter) {
      chain.push(this.limiter);
    }
    chain.push(this.master, this.analyser);

    let node: AudioNode = this.preSum;
    for (const next of chain) {
      node.connect(next);
      node = next;
    }
    node.connect(this.ctx.destination);

    if (this.meterNode && normOn) {
      try {
        this.preSum.connect(this.meterNode);
        this.meterConnected = true;
      } catch {}
    } else {
      this.meterConnected = false;
    }

    const comp = useLimiter ? this.limiterComp : 1;
    this.master.gain.setTargetAtTime(this.volume * comp, this.ctx.currentTime, 0.015);
  }

  // ---- Dual-Player & Transiciones -----------------------------------------

  getActiveAudio(): HTMLAudioElement {
    return this.activePlayer === "A" ? this.audioA : this.audioB;
  }

  getStandbyAudio(): HTMLAudioElement {
    return this.activePlayer === "A" ? this.audioB : this.audioA;
  }

  getActivePlayer(): "A" | "B" {
    return this.activePlayer;
  }

  /** Compatibilidad hacia atrás */
  get audio(): HTMLAudioElement {
    return this.getActiveAudio();
  }

  get tailAudio(): HTMLAudioElement {
    return this.getStandbyAudio();
  }

  /**
   * Pre-buferiza el siguiente track en el reproductor standby de forma silenciosa.
   */
  prepareStandby(src: string) {
    if (!src) return;
    this.nextPreparedSrc = src;
    const standby = this.getStandbyAudio();
    if (standby.paused && standby.src !== src) {
      standby.src = src;
      standby.preload = "auto";
      standby.load();
    }
  }

  prepareTail(src: string) {
    this.prepareStandby(src);
  }

  /**
   * Transición Gapless real a 0 ms:
   * Activa instantáneamente el reproductor standby ya cargado y apaga el saliente,
   * con continuidad ininterrumpida de sample sin silencios.
   */
  triggerGaplessTransition(): "A" | "B" {
    const from = this.activePlayer;
    const to: "A" | "B" = from === "A" ? "B" : "A";
    const now = this.ctx.currentTime;

    const fromGain = from === "A" ? this.gainA : this.gainB;
    const toGain = to === "A" ? this.gainA : this.gainB;
    const toAudio = to === "A" ? this.audioA : this.audioB;
    const fromAudio = from === "A" ? this.audioA : this.audioB;

    toGain.gain.cancelScheduledValues(now);
    toGain.gain.setValueAtTime(1, now);

    fromGain.gain.cancelScheduledValues(now);
    fromGain.gain.setValueAtTime(0, now);

    const rate = this.settings.playbackRate?.rate ?? 1.0;
    const preservesPitch = this.settings.playbackRate?.preservePitch !== false;
    if (toAudio.playbackRate !== rate) toAudio.playbackRate = rate;
    (toAudio as any).preservesPitch = preservesPitch;
    (toAudio as any).mozPreservesPitch = preservesPitch;
    (toAudio as any).webkitPreservesPitch = preservesPitch;
    void toAudio.play().catch(() => {});

    fromAudio.pause();
    fromAudio.currentTime = 0;

    this.activePlayer = to;
    if (Number.isFinite(toAudio.duration) && toAudio.duration > 0) {
      this.duration = toAudio.duration;
    }
    return to;
  }

  /**
   * Transición Crossfade solapada entre ambos reproductores.
   */
  triggerCrossfadeTransition(durationSec: number): "A" | "B" {
    if (durationSec <= 0) return this.triggerGaplessTransition();

    const from = this.activePlayer;
    const to: "A" | "B" = from === "A" ? "B" : "A";
    const now = this.ctx.currentTime;

    const fromGain = from === "A" ? this.gainA : this.gainB;
    const toGain = to === "A" ? this.gainA : this.gainB;
    const toAudio = to === "A" ? this.audioA : this.audioB;
    const fromAudio = from === "A" ? this.audioA : this.audioB;

    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    toGain.gain.cancelScheduledValues(now);
    toGain.gain.setValueAtTime(0.0001, now);
    toGain.gain.linearRampToValueAtTime(1, now + durationSec);

    fromGain.gain.cancelScheduledValues(now);
    fromGain.gain.setValueAtTime(1, now);
    fromGain.gain.linearRampToValueAtTime(0.0001, now + durationSec);

    void toAudio.play().catch(() => {});

    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      fromAudio.pause();
      fromAudio.currentTime = 0;
      const endNow = this.ctx.currentTime;
      fromGain.gain.cancelScheduledValues(endNow);
      fromGain.gain.setValueAtTime(0, endNow);
      toGain.gain.cancelScheduledValues(endNow);
      toGain.gain.setValueAtTime(1, endNow);
    }, durationSec * 1000 + 100);

    this.activePlayer = to;
    if (Number.isFinite(toAudio.duration) && toAudio.duration > 0) {
      this.duration = toAudio.duration;
    }
    return to;
  }

  startCrossfade(outgoingSrc: string, outgoingTime: number, durationSec: number) {
    this.triggerCrossfadeTransition(durationSec);
  }

  resetGains(active: "A" | "B") {
    this.activePlayer = active;
    const now = this.ctx.currentTime;
    if (active === "A") {
      this.gainA.gain.cancelScheduledValues(now);
      this.gainA.gain.setValueAtTime(1, now);
      this.gainB.gain.cancelScheduledValues(now);
      this.gainB.gain.setValueAtTime(0, now);
    } else {
      this.gainA.gain.cancelScheduledValues(now);
      this.gainA.gain.setValueAtTime(0, now);
      this.gainB.gain.cancelScheduledValues(now);
      this.gainB.gain.setValueAtTime(1, now);
    }
  }

  stopCrossfade() {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    const standby = this.getStandbyAudio();
    if (!standby.paused) {
      standby.pause();
    }
    this.resetGains(this.activePlayer);
  }

  // ---- API pública --------------------------------------------------------

  subscribeStatus = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getStatus = () => this.status;

  setVolume(v: number) {
    this.volume = v;
    const useLimiter = this.settings.eq.enabled || this.settings.normalizer.enabled;
    const comp = useLimiter ? this.limiterComp : 1;
    this.master.gain.setTargetAtTime(v * comp, this.ctx.currentTime, 0.015);
  }

  applySettings(s: AudioSettings) {
    this.settings = s;
    const now = this.ctx.currentTime;

    const eqOn = s.eq.enabled;
    const normOn = s.normalizer.enabled;
    this.rebuildChain(eqOn, normOn);

    if (normOn) {
      if (!this.meterInitStarted) {
        this.meterInitStarted = true;
        void this.initMeter();
      } else if (this.meterNode && !this.meterConnected) {
        try {
          this.preSum.connect(this.meterNode);
          this.meterConnected = true;
        } catch {}
      }
    } else if (this.meterNode && this.meterConnected) {
      try {
        this.preSum.disconnect(this.meterNode);
      } catch {}
      this.meterConnected = false;
    }

    if (eqOn) {
      this.filters.forEach((f, i) => {
        f.gain.setTargetAtTime(s.eq.bands[i] ?? 0, now, 0.02);
      });
    }
    const preDb = eqOn ? s.eq.preamp + (s.eq.autoPreamp ? autoPreampDb(s.eq.bands) : 0) : 0;
    this.preamp.gain.setTargetAtTime(dbToLin(preDb), now, 0.03);

    if (!s.crossfade.enabled) {
      this.stopCrossfade();
    }

    this.evaluate({ tc: 0.15 });
    this.publish(true);
  }

  /** Nueva canción: se reinicia el análisis y se fija la ganancia inicial sin rampa. */
  beginTrack(id: string | null) {
    this.trackId = id;
    this.analysis.reset();
    this.live = { lufs: null, gatedSeconds: 0 };
    this.cachedLufs = id ? sharedCache.get(id) : null;
    this.duration = NaN;
    this.lastIntegrate = 0;
    this.ringCount = 0;
    this.momentary = null;
    this.ignoreUntil = performance.now() + 400;
    this.evaluate({ instant: true });
    this.publish(true);
  }

  setDuration(d: number) {
    this.duration = d;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  clearLoudnessCache() {
    sharedCache.clear();
    this.cachedLufs = null;
    this.evaluate({ tc: 0.3 });
    this.publish(true);
  }

  get cachedTracks() {
    return sharedCache.size;
  }

  // ---- Medidor ------------------------------------------------------------

  private async initMeter() {
    try {
      if (!this.ctx.audioWorklet) throw new Error("AudioWorklet no disponible");
      const url = URL.createObjectURL(new Blob([LOUDNESS_WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(this.ctx, LOUDNESS_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      node.port.onmessage = this.onBlock;

      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(this.ctx.destination);

      this.meterNode = node;
      if (this.settings.normalizer.enabled) {
        try {
          this.preSum.connect(node);
          this.meterConnected = true;
        } catch {}
      }
      this.meterState = "ready";
    } catch (e) {
      console.warn("Medidor de sonoridad no disponible; el normalizador solo usará valores guardados:", e);
      this.meterState = "unsupported";
    }
    this.publish(true);
  }

  private onBlock = (e: MessageEvent<{ ms: number; peak: number }>) => {
    if (!this.settings.normalizer.enabled) return;

    const ms = e.data.ms;
    const audio = this.getActiveAudio();

    this.ring[this.ringPos] = ms;
    this.ringPos = (this.ringPos + 1) % 4;
    if (this.ringCount < 4) this.ringCount++;

    const playing =
      !audio.paused && !audio.seeking && audio.readyState >= 3 && performance.now() >= this.ignoreUntil;

    if (!playing) {
      this.momentary = null;
      if (this.listeners.size > 0) this.publish(false);
      return;
    }

    if (this.ringCount === 4) {
      const avg = (this.ring[0] + this.ring[1] + this.ring[2] + this.ring[3]) / 4;
      const l = msToLufs(avg);
      this.momentary = Number.isFinite(l) ? l : null;
    }

    if (this.cachedLufs === null && this.trackId) {
      this.analysis.set(Math.round(audio.currentTime / SLOT_SECONDS) - 1, ms);

      const now = performance.now();
      if (now - this.lastIntegrate > 1000) {
        this.lastIntegrate = now;
        this.live = this.analysis.integrated();
        if (
          this.live.lufs !== null &&
          this.analysis.coverage(this.duration) >= SAVE_COVERAGE
        ) {
          this.commitToCache(this.live.lufs);
        }
      }
    }

    this.evaluate({});
    if (this.listeners.size > 0) this.publish(false);
  };

  private commitToCache(lufs: number) {
    if (!this.trackId) return;
    sharedCache.set(this.trackId, lufs);
    this.cachedLufs = lufs;
  }

  private finalizeTrack() {
    if (this.cachedLufs !== null || !this.trackId) return;
    const res = this.analysis.integrated();
    if (res.lufs !== null && this.analysis.coverage(this.duration) >= 0.5) {
      this.commitToCache(res.lufs);
      this.publish(true);
    }
  }

  // ---- Normalizador -------------------------------------------------------

  private computeGain(): { gainDb: number; source: GainSource } {
    const n = this.settings.normalizer;
    if (!n.enabled) return { gainDb: 0, source: "off" };

    let lufs: number | null = null;
    let source: GainSource = "waiting";

    if (this.cachedLufs !== null) {
      lufs = this.cachedLufs;
      source = "cache";
    } else if (this.live.lufs !== null && this.live.gatedSeconds >= 1.2) {
      lufs = this.live.lufs;
      source = "live";
    } else {
      const p = sharedCache.prior();
      if (p !== null) { lufs = p; source = "prior"; }
    }
    if (lufs === null) return { gainDb: 0, source: "waiting" };

    let gain = n.targetLufs - lufs;
    let maxBoost = MAX_BOOST_DB;
    let maxCut = MAX_CUT_DB;
    if (source === "prior") { maxBoost = UNSURE_BOOST_DB; maxCut = -UNSURE_BOOST_DB; }
    else if (source === "live" && this.live.gatedSeconds < CONFIDENT_SECONDS) maxBoost = UNSURE_BOOST_DB;

    gain = Math.min(maxBoost, Math.max(maxCut, gain));
    return { gainDb: gain, source };
  }

  private evaluate(opts: { instant?: boolean; tc?: number }) {
    const { gainDb, source } = this.computeGain();
    this.source_ = source;
    const now = this.ctx.currentTime;
    const param = this.norm.gain;

    if (opts.instant) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(dbToLin(gainDb), now);
      this.appliedDb = gainDb;
      return;
    }
    if (Math.abs(gainDb - this.appliedDb) < 0.1) return;

    const tc = opts.tc ?? (gainDb < this.appliedDb ? 0.4 : 2.5);
    param.setTargetAtTime(dbToLin(gainDb), now, tc);
    this.appliedDb = gainDb;
  }

  // ---- Estado observable --------------------------------------------------

  private publish(force: boolean) {
    const t = performance.now();
    if (!force && t - this.lastPublish < 180) return;
    this.lastPublish = t;

    const red = (this.limiter as any).reduction;
    this.status = {
      graphReady: true,
      meter: this.meterState,
      normalizerActive: this.settings.normalizer.enabled,
      source: this.source_,
      lufs: this.cachedLufs ?? this.live.lufs,
      gainDb: this.appliedDb,
      targetLufs: this.settings.normalizer.targetLufs,
      coverage: this.cachedLufs !== null ? 1 : this.analysis.coverage(this.duration),
      momentaryLufs: this.momentary,
      limiterReductionDb: typeof red === "number" ? red : red?.value ?? 0,
    };
    this.listeners.forEach((l) => l());
  }

  dispose() {
    this.audioA.removeEventListener("seeked", this.onSeeked);
    this.audioA.removeEventListener("ended", this.onEnded);
    this.audioB.removeEventListener("seeked", this.onSeeked);
    this.audioB.removeEventListener("ended", this.onEnded);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (this.meterNode) this.meterNode.port.onmessage = null;
    this.listeners.clear();
    void this.ctx.close();
  }
}

const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();

export function getOrCreateGraph(primaryAudio: HTMLAudioElement, secondaryAudio?: HTMLAudioElement): AudioGraph | null {
  const existing = graphs.get(primaryAudio);
  if (existing) return existing;
  try {
    const g = new AudioGraph(primaryAudio, secondaryAudio);
    graphs.set(primaryAudio, g);
    return g;
  } catch (e) {
    console.error("Error al iniciar Web Audio API:", e);
    return null;
  }
}
