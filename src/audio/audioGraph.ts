import { AudioSettings, DEFAULT_AUDIO_SETTINGS } from "./audioSettings";
import { EQ_FREQUENCIES, EQ_Q, bandType, autoPreampDb } from "./eqMath";
import { LOUDNESS_WORKLET_NAME, LOUDNESS_WORKLET_SOURCE } from "./loudnessWorklet";
import { LoudnessCache, SLOT_SECONDS, TrackAnalysis, msToLufs, IntegratedResult } from "./loudnessAnalysis";

// Cadena de señal:
//
//   <audio> ─┬─────────────────────────────────────────────► medidor (K-weighting, solo lectura)
//            └► norma ► preamp ► EQ (10 bandas) ► limitador ► volumen ► analizador ► salida
//
// El medidor lee la señal ANTES de norma/EQ/volumen: así lo que se mide es
// la canción, no lo que el usuario le haya hecho, y el resultado se puede
// guardar y reutilizar. El volumen del usuario vive en el grafo (no en
// audio.volume) por la misma razón.

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

// El DynamicsCompressorNode aplica una ganancia de compensación automática
// (definida en la especificación de Web Audio) a TODA la señal. Como lo
// usamos de limitador, la calculamos y la cancelamos para que sea
// transparente por debajo del umbral.
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

export class AudioGraph {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;

  private audio: HTMLAudioElement;
  private source: MediaElementAudioSourceNode;
  private norm: GainNode;
  private preamp: GainNode;
  private filters: BiquadFilterNode[] = [];
  private limiter: DynamicsCompressorNode;
  private master: GainNode;
  private meterNode: AudioWorkletNode | null = null;
  private meterState: AudioStatus["meter"] = "loading";

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

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;

    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: "playback" });
    const ctx = this.ctx;

    this.source = ctx.createMediaElementSource(audio);
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
    this.master.gain.value = this.volume * this.limiterComp;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 64;

    let node: AudioNode = this.source;
    const chain: AudioNode[] = [this.norm, this.preamp, ...this.filters, this.limiter, this.master, this.analyser];
    for (const next of chain) { node.connect(next); node = next; }
    node.connect(ctx.destination);

    // El volumen pasa a ser un GainNode; el elemento va siempre a tope para
    // que el medidor vea la señal real de la canción.
    audio.volume = 1;
    audio.addEventListener("seeked", this.onSeeked);
    audio.addEventListener("ended", this.onEnded);

    void this.initMeter();
  }

  // ---- API pública --------------------------------------------------------

  subscribeStatus = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getStatus = () => this.status;

  setVolume(v: number) {
    this.volume = v;
    this.master.gain.setTargetAtTime(v * this.limiterComp, this.ctx.currentTime, 0.015);
  }

  applySettings(s: AudioSettings) {
    this.settings = s;
    const now = this.ctx.currentTime;

    // EQ: siempre en la cadena; "desactivado" = todas las bandas a 0 dB.
    const eqOn = s.eq.enabled;
    this.filters.forEach((f, i) => {
      f.gain.setTargetAtTime(eqOn ? s.eq.bands[i] ?? 0 : 0, now, 0.02);
    });
    const preDb = eqOn ? s.eq.preamp + (s.eq.autoPreamp ? autoPreampDb(s.eq.bands) : 0) : 0;
    this.preamp.gain.setTargetAtTime(dbToLin(preDb), now, 0.03);

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
        channelInterpretation: "speakers", // mono => se duplica a L y R, como al reproducirlo
      });
      node.port.onmessage = this.onBlock;

      // El worklet solo se ejecuta si su salida llega al destino; lo
      // conectamos a través de una ganancia 0 (silencio).
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.source.connect(node);
      node.connect(sink);
      sink.connect(this.ctx.destination);

      this.meterNode = node;
      this.meterState = "ready";
    } catch (e) {
      console.warn("Medidor de sonoridad no disponible; el normalizador solo usará valores guardados:", e);
      this.meterState = "unsupported";
    }
    this.publish(true);
  }

  private onBlock = (e: MessageEvent<{ ms: number; peak: number }>) => {
    const ms = e.data.ms;
    const audio = this.audio;

    this.ring[this.ringPos] = ms;
    this.ringPos = (this.ringPos + 1) % 4;
    if (this.ringCount < 4) this.ringCount++;

    const playing =
      !audio.paused && !audio.seeking && audio.readyState >= 3 && performance.now() >= this.ignoreUntil;

    if (!playing) {
      this.momentary = null;
      this.publish(false);
      return;
    }

    if (this.ringCount === 4) {
      const avg = (this.ring[0] + this.ring[1] + this.ring[2] + this.ring[3]) / 4;
      const l = msToLufs(avg);
      this.momentary = Number.isFinite(l) ? l : null;
    }

    // Solo se analiza mientras no tengamos el valor definitivo guardado.
    if (this.cachedLufs === null && this.trackId) {
      // El bloque recién entregado cubre los 100 ms anteriores a currentTime.
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
    this.publish(false);
  };

  private commitToCache(lufs: number) {
    if (!this.trackId) return;
    sharedCache.set(this.trackId, lufs);
    this.cachedLufs = lufs;
  }

  /** Al terminar la canción, si se oyó lo bastante, se guarda aunque no llegue al umbral. */
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

    // Asimétrico: bajar rápido (evita picos fuertes), subir despacio (evita "bombeo").
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
    this.audio.removeEventListener("seeked", this.onSeeked);
    this.audio.removeEventListener("ended", this.onEnded);
    if (this.meterNode) this.meterNode.port.onmessage = null;
    this.listeners.clear();
    void this.ctx.close();
  }
}

// createMediaElementSource solo puede llamarse una vez por elemento; este
// registro evita errores con StrictMode o recarga en caliente.
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();

export function getOrCreateGraph(audio: HTMLAudioElement): AudioGraph | null {
  const existing = graphs.get(audio);
  if (existing) return existing;
  try {
    const g = new AudioGraph(audio);
    graphs.set(audio, g);
    return g;
  } catch (e) {
    console.error("Error al iniciar Web Audio API:", e);
    return null;
  }
}
