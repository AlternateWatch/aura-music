import React, { useMemo, useRef, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { X, SlidersHorizontal, Activity, RotateCcw } from "lucide-react";
import {
  AudioSettings,
  NORMALIZER_TARGETS,
} from "../audio/audioSettings";
import {
  EQ_BAND_COUNT,
  EQ_LABELS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_PRESETS,
  CUSTOM_PRESET_ID,
  clampDb,
  responseDb,
  logFrequencies,
  autoPreampDb,
} from "../audio/eqMath";
import type { AudioStatus } from "../audio/audioGraph";

interface Props {
  onClose: () => void;
  settings: AudioSettings;
  onChange: (next: AudioSettings) => void;
  subscribeStatus: (listener: () => void) => () => void;
  getStatus: () => AudioStatus;
  onClearLoudnessCache: () => void;
}

const fmtDb = (v: number, digits = 1) => `${v > 0.05 ? "+" : ""}${v.toFixed(digits)}`;

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onClick}
    className={`w-12 h-6 rounded-full transition-all relative shrink-0 outline-none ${on ? "bg-brand-primary" : "bg-white/10"}`}
  >
    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-7" : "left-1"}`} />
  </button>
);

// ---------------------------------------------------------------------------
// Slider vertical propio: los <input type="range"> verticales no se comportan
// igual en WebView2, Android WebView y Safari.

const BandSlider: React.FC<{
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, disabled, onChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = 1 - (clientY - r.top) / r.height;
    const raw = EQ_MIN_DB + t * (EQ_MAX_DB - EQ_MIN_DB);
    onChange(clampDb(Math.round(raw * 2) / 2)); // pasos de 0,5 dB
  };

  const pct = ((value - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)) * 100;
  const zeroPct = ((0 - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)) * 100;
  const fillBottom = Math.min(pct, zeroPct);
  const fillHeight = Math.abs(pct - zeroPct);

  return (
    <div className={`flex flex-col items-center gap-2 flex-1 min-w-0 select-none ${disabled ? "opacity-40" : ""}`}>
      <span className="text-[10px] font-mono font-bold text-white/50 h-3 leading-none">
        {value === 0 ? "0" : fmtDb(value)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} Hz`}
        aria-valuemin={EQ_MIN_DB}
        aria-valuemax={EQ_MAX_DB}
        aria-valuenow={value}
        className="relative w-8 h-36 flex justify-center cursor-pointer outline-none group"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientY);
        }}
        onPointerMove={(e) => { if (dragging.current) fromPointer(e.clientY); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onDoubleClick={() => { if (!disabled) onChange(0); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onChange(clampDb(value + 0.5)); }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onChange(clampDb(value - 0.5)); }
          if (e.key === "Home") { e.preventDefault(); onChange(EQ_MIN_DB); }
          if (e.key === "End") { e.preventDefault(); onChange(EQ_MAX_DB); }
          if (e.key === "0") { e.preventDefault(); onChange(0); }
        }}
      >
        <div className="absolute inset-y-0 w-[3px] bg-white/10 rounded-full" />
        <div className="absolute w-2 h-[2px] bg-white/25 rounded-full" style={{ bottom: `${zeroPct}%` }} />
        <div
          className="absolute w-[3px] bg-brand-primary rounded-full"
          style={{ bottom: `${fillBottom}%`, height: `${fillHeight}%` }}
        />
        <div
          className="absolute w-4 h-4 bg-white rounded-full shadow-lg border-2 border-black group-focus-visible:ring-2 ring-brand-primary transition-transform group-hover:scale-110"
          style={{ bottom: `calc(${pct}% - 8px)` }}
        />
      </div>
      <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">{label}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------

const CURVE_W = 600;
const CURVE_H = 110;
const CURVE_FREQS = logFrequencies(140);

const EqCurve: React.FC<{ bands: number[]; active: boolean }> = ({ bands, active }) => {
  const { path, area } = useMemo(() => {
    const resp = responseDb(bands, CURVE_FREQS);
    const yOf = (db: number) => {
      const t = (Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, db)) - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB);
      return CURVE_H - t * CURVE_H;
    };
    const pts = resp.map((db, i) => [(i / (CURVE_FREQS.length - 1)) * CURVE_W, yOf(db)] as const);
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const mid = yOf(0);
    return { path: d, area: `${d} L${CURVE_W},${mid} L0,${mid} Z` };
  }, [bands]);

  const gridDb = [-6, 0, 6];
  const yOf = (db: number) => CURVE_H - ((db - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)) * CURVE_H;

  return (
    <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} className="w-full h-24" preserveAspectRatio="none" aria-hidden>
      {gridDb.map((db) => (
        <line
          key={db}
          x1={0} x2={CURVE_W} y1={yOf(db)} y2={yOf(db)}
          stroke="white" strokeOpacity={db === 0 ? 0.15 : 0.06} strokeDasharray={db === 0 ? undefined : "4 6"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill="#F27D26" fillOpacity={active ? 0.12 : 0.04} />
      <path
        d={path} fill="none" stroke="#F27D26" strokeOpacity={active ? 1 : 0.35}
        strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------

const METER_MIN = -40;
const METER_MAX = 0;
const meterPct = (lufs: number) =>
  Math.max(0, Math.min(100, ((lufs - METER_MIN) / (METER_MAX - METER_MIN)) * 100));

const sourceLabel = (s: AudioStatus): string => {
  if (s.meter === "unsupported" && s.source !== "cache") return "Live meter unavailable on this device";
  switch (s.source) {
    case "cache": return "Track analysed · exact level applied";
    case "live": return `Measuring as it plays · ${Math.round(s.coverage * 100)}%`;
    case "prior": return "Starting from your library average · measuring…";
    case "waiting": return s.graphReady ? "Listening to the first seconds…" : "Starts with the next play";
    default: return "";
  }
};

const NormalizerSection: React.FC<Pick<Props, "settings" | "onChange" | "subscribeStatus" | "getStatus" | "onClearLoudnessCache">> = ({
  settings, onChange, subscribeStatus, getStatus, onClearLoudnessCache,
}) => {
  const status = useSyncExternalStore(subscribeStatus, getStatus, getStatus);
  const n = settings.normalizer;
  const set = (patch: Partial<AudioSettings["normalizer"]>) =>
    onChange({ ...settings, normalizer: { ...n, ...patch } });

  const showLive = n.enabled && status.graphReady;

  return (
    <section className="p-6 bg-white/[0.02] border border-white/5 rounded-[24px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Activity className="text-brand-primary" size={18} />
          <div>
            <p className="text-sm font-bold text-white leading-none">Normalizer</p>
            <p className="text-[9px] font-bold uppercase text-white/20 tracking-wider mt-1">
              Loudness matching between tracks
            </p>
          </div>
        </div>
        <Toggle on={n.enabled} onClick={() => set({ enabled: !n.enabled })} label="Normalizer" />
      </div>

      <div className={`mt-5 transition-opacity ${n.enabled ? "" : "opacity-40 pointer-events-none"}`}>
        <div className="grid grid-cols-3 gap-2">
          {NORMALIZER_TARGETS.map((t) => {
            const active = n.targetLufs === t.lufs;
            return (
              <button
                key={t.lufs}
                onClick={() => set({ targetLufs: t.lufs })}
                title={t.hint}
                className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all outline-none ${
                  active ? "bg-brand-primary text-black" : "bg-white/5 text-white/40 hover:text-white"
                }`}
              >
                {t.label}
                <span className={`block font-mono text-[9px] mt-0.5 ${active ? "text-black/60" : "text-white/20"}`}>
                  {t.lufs} LUFS
                </span>
              </button>
            );
          })}
        </div>

        {/* Medidor en vivo */}
        <div className="mt-5">
          <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-white/60 rounded-full transition-[width] duration-200"
              style={{ width: `${showLive && status.momentaryLufs !== null ? meterPct(status.momentaryLufs) : 0}%` }}
            />
          </div>
          <div className="relative h-4">
            <div
              className="absolute top-0 w-px h-2 bg-brand-primary"
              style={{ left: `${meterPct(n.targetLufs)}%` }}
            />
            <span
              className="absolute top-2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-widest text-brand-primary/70 whitespace-nowrap"
              style={{ left: `${meterPct(n.targetLufs)}%` }}
            >
              target
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="Track loudness" value={showLive && status.lufs !== null ? `${status.lufs.toFixed(1)} LUFS` : "—"} />
          <Stat label="Adjustment" value={showLive && status.source !== "waiting" ? `${fmtDb(status.gainDb)} dB` : "—"} />
          <Stat
            label="Limiter"
            value={showLive && status.limiterReductionDb < -0.3 ? `${status.limiterReductionDb.toFixed(1)} dB` : "idle"}
          />
        </div>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-white/30 min-h-[14px]">
          {showLive ? sourceLabel(status) : ""}
        </p>

        <button
          onClick={onClearLoudnessCache}
          className="mt-3 text-[9px] font-bold uppercase tracking-widest text-white/20 hover:text-white/60 transition-colors outline-none"
        >
          Forget saved analyses
        </button>
      </div>
    </section>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="text-center p-3 bg-white/[0.03] rounded-2xl border border-white/5">
    <p className="text-sm font-bold font-mono text-white tabular-nums">{value}</p>
    <p className="text-[8px] font-bold uppercase text-white/30 tracking-widest mt-1">{label}</p>
  </div>
);

// ---------------------------------------------------------------------------

export const AudioSettingsOverlay: React.FC<Props> = ({
  onClose, settings, onChange, subscribeStatus, getStatus, onClearLoudnessCache,
}) => {
  const eq = settings.eq;
  const setEq = (patch: Partial<AudioSettings["eq"]>) => onChange({ ...settings, eq: { ...eq, ...patch } });

  const matchPreset = (bands: number[]) =>
    EQ_PRESETS.find((p) => p.bands.every((v, i) => v === bands[i]))?.id ?? CUSTOM_PRESET_ID;

  const setBand = (i: number, v: number) => {
    const bands = eq.bands.slice();
    bands[i] = v;
    // Tocar una banda también enciende el EQ: es lo que espera quien lo mueve.
    setEq({ bands, preset: matchPreset(bands), enabled: true });
  };

  const selectPreset = (id: string) => {
    const p = EQ_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setEq({ preset: id, bands: p.bands.slice(), enabled: true });
  };

  const reset = () => setEq({ preset: "flat", bands: new Array(EQ_BAND_COUNT).fill(0), preamp: 0 });

  const autoDb = useMemo(() => (eq.autoPreamp ? autoPreampDb(eq.bands) : 0), [eq.autoPreamp, eq.bands]);
  const totalPreamp = eq.preamp + autoDb;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 font-sans"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#121212] border border-white/10 rounded-[40px] p-6 md:p-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl relative"
      >
        <button onClick={onClose} aria-label="Close" className="absolute top-6 right-6 md:top-8 md:right-8 text-white/20 hover:text-white transition-colors outline-none">
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-8">
          <SlidersHorizontal className="text-brand-primary" size={22} />
          <h2 className="text-2xl md:text-3xl font-bold uppercase tracking-tighter text-white font-serif italic">Audio</h2>
        </div>

        <div className="flex flex-col gap-5">
          <NormalizerSection
            settings={settings}
            onChange={onChange}
            subscribeStatus={subscribeStatus}
            getStatus={getStatus}
            onClearLoudnessCache={onClearLoudnessCache}
          />

          {/* AJUSTES DE REPRODUCCIÓN */}
          <section className="p-6 bg-white/[0.02] border border-white/5 rounded-[24px]">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Activity className="text-brand-primary" size={18} />
                  <div>
                    <p className="text-sm font-bold text-white leading-none">Crossfade</p>
                    <p className="text-[9px] font-bold uppercase text-white/20 tracking-wider mt-1">Smooth transition between tracks</p>
                  </div>
                </div>
                <Toggle
                  on={settings.crossfade.enabled}
                  onClick={() => onChange({ ...settings, crossfade: { ...settings.crossfade, enabled: !settings.crossfade.enabled } })}
                  label="Crossfade"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Activity className="text-brand-primary" size={18} />
                  <div>
                    <p className="text-sm font-bold text-white leading-none">Visualizer</p>
                    <p className="text-[9px] font-bold uppercase text-white/20 tracking-wider mt-1">Reactive frequency waves</p>
                  </div>
                </div>
                <Toggle
                  on={settings.visualizer.enabled}
                  onClick={() => onChange({ ...settings, visualizer: { ...settings.visualizer, enabled: !settings.visualizer.enabled } })}
                  label="Visualizer"
                />
              </div>
            </div>
          </section>

          {/* ECUALIZADOR */}

          <section className="p-6 bg-white/[0.02] border border-white/5 rounded-[24px]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="text-brand-primary" size={18} />
                <div>
                  <p className="text-sm font-bold text-white leading-none">Equalizer</p>
                  <p className="text-[9px] font-bold uppercase text-white/20 tracking-wider mt-1">10-band graphic EQ</p>
                </div>
              </div>
              <Toggle on={eq.enabled} onClick={() => setEq({ enabled: !eq.enabled })} label="Equalizer" />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {EQ_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPreset(p.id)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all outline-none ${
                    eq.preset === p.id && eq.enabled
                      ? "bg-brand-primary text-black"
                      : eq.preset === p.id
                      ? "bg-white/15 text-white"
                      : "bg-white/5 text-white/40 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {eq.preset === CUSTOM_PRESET_ID && (
                <span className="px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/15 text-white">
                  Custom
                </span>
              )}
            </div>

            <div className={`mt-6 transition-opacity ${eq.enabled ? "" : "opacity-50"}`}>
              <EqCurve bands={eq.bands} active={eq.enabled} />
              <div className="flex gap-1 mt-3">
                {eq.bands.map((v, i) => (
                  <BandSlider key={i} label={EQ_LABELS[i]} value={v} disabled={false} onChange={(nv) => setBand(i, nv)} />
                ))}
              </div>
              <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-white/15">
                Double-click a band to reset it
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-white/5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Preamp</p>
                <span className="text-[11px] font-mono font-bold text-white/60 tabular-nums">
                  {fmtDb(eq.preamp)} dB
                  {eq.autoPreamp && Math.abs(autoDb) >= 0.05 && (
                    <span className="text-white/25"> {fmtDb(autoDb)} auto = {fmtDb(totalPreamp)}</span>
                  )}
                </span>
              </div>
              <input
                type="range" min={-12} max={12} step={0.5} value={eq.preamp}
                onChange={(e) => setEq({ preamp: parseFloat(e.target.value) })}
                onDoubleClick={() => setEq({ preamp: 0 })}
                aria-label="Preamp"
                className="w-full mt-3 accent-[#F27D26] cursor-pointer"
              />

              <div className="flex items-center justify-between gap-4 mt-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Keep volume constant</p>
                  <p className="text-[9px] text-white/20 mt-0.5">Lowers the level when you boost, so louder never fools you into thinking it sounds better.</p>
                </div>
                <Toggle on={eq.autoPreamp} onClick={() => setEq({ autoPreamp: !eq.autoPreamp })} label="Keep volume constant" />
              </div>

              <button
                onClick={reset}
                className="mt-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors outline-none"
              >
                <RotateCcw size={12} /> Reset equalizer
              </button>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
};
