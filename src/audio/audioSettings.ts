import {
  EQ_BAND_COUNT,
  EQ_PRESETS,
  CUSTOM_PRESET_ID,
  clampDb,
} from "./eqMath";

export interface NormalizerSettings {
  enabled: boolean;
  /** Sonoridad objetivo en LUFS. */
  targetLufs: number;
}

export interface EqSettings {
  enabled: boolean;
  /** id de EQ_PRESETS o "custom". */
  preset: string;
  bands: number[];
  /** Preamp manual en dB. */
  preamp: number;
  /** Suma una compensación automática para que el EQ no cambie el volumen. */
  autoPreamp: boolean;
}

export type PlaybackPresetId = "normal" | "nightcore" | "slowed" | "speedup" | "custom";

export interface PlaybackRateSettings {
  rate: number;          // 0.5 a 2.0 (default 1.0)
  preservePitch: boolean;// true = preserva tono vocal; false = shift natural (Nightcore/Slowed)
  reverbWet: number;     // 0.0 a 1.0 (reverberación de sala; 0 = seco)
  preset: PlaybackPresetId;
}

export interface PlaybackPresetDef {
  id: PlaybackPresetId;
  label: string;
  icon: string;
  rate: number;
  preservePitch: boolean;
  reverbWet: number;
  description: string;
}

export const PLAYBACK_PRESETS: PlaybackPresetDef[] = [
  {
    id: "normal",
    label: "Normal",
    icon: "🎵",
    rate: 1.0,
    preservePitch: true,
    reverbWet: 0.0,
    description: "Velocidad estándar 1.0x sin alteraciones",
  },
  {
    id: "nightcore",
    label: "Nightcore",
    icon: "⚡",
    rate: 1.25,
    preservePitch: false,
    reverbWet: 0.0,
    description: "1.25x velocidad acelerada con tono agudo natural y energía",
  },
  {
    id: "slowed",
    label: "Slowed & Reverb",
    icon: "🌙",
    rate: 0.85,
    preservePitch: false,
    reverbWet: 0.35,
    description: "0.85x tempo relajado con tono grave y reverberación espacial",
  },
  {
    id: "speedup",
    label: "Speed Up",
    icon: "⏩",
    rate: 1.15,
    preservePitch: true,
    reverbWet: 0.0,
    description: "1.15x más rápido manteniendo el tono de voz original",
  },
  {
    id: "custom",
    label: "Personalizado",
    icon: "🎚️",
    rate: 1.0,
    preservePitch: true,
    reverbWet: 0.0,
    description: "Ajuste libre de velocidad, tono y reverberación",
  },
];

export interface AudioSettings {
  normalizer: NormalizerSettings;
  eq: EqSettings;
  crossfade: {
    enabled: boolean;
    duration: number;
  };
  gapless: {
    enabled: boolean;
  };
  visualizer: {
    enabled: boolean;
  };
  playbackRate: PlaybackRateSettings;
  autoplay?: {
    enabled: boolean;
  };
}

export const NORMALIZER_TARGETS = [
  { label: "Silencioso", lufs: -18, hint: "-18 LUFS · máxima dinámica" },
  { label: "Normal", lufs: -14, hint: "-14 LUFS · como Spotify/YouTube" },
  { label: "Alto", lufs: -11, hint: "-11 LUFS · más presencia" },
];

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  normalizer: { enabled: false, targetLufs: -14 },
  eq: {
    enabled: false,
    preset: "flat",
    bands: new Array(EQ_BAND_COUNT).fill(0),
    preamp: 0,
    autoPreamp: true,
  },
  crossfade: { enabled: false, duration: 5 },
  gapless: { enabled: true },
  visualizer: { enabled: true },
  playbackRate: {
    rate: 1.0,
    preservePitch: true,
    reverbWet: 0.0,
    preset: "normal",
  },
  autoplay: { enabled: true },
};

const KEY = "aura_audio_v2";
const LEGACY_NORMALIZER_KEY = "aura_norm";

export function loadAudioSettings(): AudioSettings {
  const base: AudioSettings = JSON.parse(JSON.stringify(DEFAULT_AUDIO_SETTINGS));
  try {
    // Migración: antes solo existía el interruptor del normalizador.
    if (localStorage.getItem(LEGACY_NORMALIZER_KEY) === "true") base.normalizer.enabled = true;

    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw);

    if (p?.normalizer) {
      base.normalizer.enabled = !!p.normalizer.enabled;
      const t = Number(p.normalizer.targetLufs);
      if (Number.isFinite(t) && t >= -30 && t <= -6) base.normalizer.targetLufs = t;
    }
    if (p?.eq) {
      base.eq.enabled = !!p.eq.enabled;
      if (Array.isArray(p.eq.bands) && p.eq.bands.length === EQ_BAND_COUNT) {
        base.eq.bands = p.eq.bands.map((v: unknown) => clampDb(Number(v) || 0));
      }
      const known = p.eq.preset === CUSTOM_PRESET_ID || EQ_PRESETS.some((x) => x.id === p.eq.preset);
      base.eq.preset = known ? p.eq.preset : CUSTOM_PRESET_ID;
      const pre = Number(p.eq.preamp);
      base.eq.preamp = Number.isFinite(pre) ? Math.min(12, Math.max(-12, pre)) : 0;
      base.eq.autoPreamp = p.eq.autoPreamp !== false;
    }
    if (p?.crossfade) {
      base.crossfade.enabled = !!p.crossfade.enabled;
      const dur = Number(p.crossfade.duration);
      if (Number.isFinite(dur) && dur >= 0 && dur <= 20) base.crossfade.duration = dur;
    }
    if (p?.gapless !== undefined) {
      base.gapless = { enabled: p.gapless.enabled !== false };
    }
    if (p?.visualizer) {
      base.visualizer.enabled = !!p.visualizer.enabled;
    }
    if (p?.playbackRate) {
      const r = Number(p.playbackRate.rate);
      if (Number.isFinite(r) && r >= 0.5 && r <= 2.0) base.playbackRate.rate = r;
      base.playbackRate.preservePitch = p.playbackRate.preservePitch !== false;
      const w = Number(p.playbackRate.reverbWet);
      if (Number.isFinite(w) && w >= 0 && w <= 1) base.playbackRate.reverbWet = w;
      if (typeof p.playbackRate.preset === 'string') {
        base.playbackRate.preset = p.playbackRate.preset as PlaybackPresetId;
      }
    }
    if (p?.autoplay !== undefined) {
      base.autoplay = { enabled: p.autoplay.enabled !== false };
    }
  } catch {
    /* ajustes corruptos: valores por defecto */
  }
  return base;
}

export function saveAudioSettings(s: AudioSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // Mantiene sincronizada la clave antigua por si otra parte la lee.
    localStorage.setItem(LEGACY_NORMALIZER_KEY, String(s.normalizer.enabled));
  } catch {
    /* sin persistencia */
  }
}
