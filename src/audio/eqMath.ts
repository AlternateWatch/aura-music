// Ecualizador gráfico de 10 bandas.
//
// Las fórmulas de los biquads son las de la especificación de Web Audio
// (Audio EQ Cookbook), así que la curva que dibuja la interfaz coincide con
// la que realmente aplican los BiquadFilterNode.

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
export const EQ_BAND_COUNT = EQ_FREQUENCIES.length;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const EQ_Q = 1.41; // ~1 octava de ancho por banda

export type BandType = "lowshelf" | "peaking" | "highshelf";

export const bandType = (i: number): BandType =>
  i === 0 ? "lowshelf" : i === EQ_BAND_COUNT - 1 ? "highshelf" : "peaking";

export interface EqPreset {
  id: string;
  label: string;
  bands: number[];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", label: "Plano", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass", label: "Más graves", bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "bass-reducer", label: "Menos graves", bands: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0] },
  { id: "treble", label: "Más agudos", bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: "vocal", label: "Voces", bands: [-2, -3, -2, 1, 3, 4, 3, 1, 0, -1] },
  { id: "loudness", label: "Loudness", bands: [6, 4, 1, 0, -1, -1, 0, 2, 4, 5] },
  { id: "rock", label: "Rock", bands: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5] },
  { id: "pop", label: "Pop", bands: [-1, 2, 4, 5, 3, 0, -1, -1, -1, -2] },
  { id: "electronic", label: "Electrónica", bands: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5] },
  { id: "hiphop", label: "Hip-hop", bands: [5, 4, 2, 3, -1, -1, 2, -1, 2, 3] },
  { id: "jazz", label: "Jazz", bands: [3, 2, 1, 2, -2, -2, 0, 1, 2, 3] },
  { id: "classical", label: "Clásica", bands: [4, 3, 3, 2, -1, -1, 0, 2, 3, 4] },
  { id: "acoustic", label: "Acústica", bands: [4, 4, 3, 1, 1, 1, 2, 3, 3, 2] },
];

export const CUSTOM_PRESET_ID = "custom";

export const clampDb = (v: number) => Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, v));

// ---------------------------------------------------------------------------

interface Coeffs { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }

export function biquadCoeffs(type: BandType, f0: number, gainDb: number, q: number, fs: number): Coeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);

  if (type === "peaking") {
    const alpha = sin / (2 * q);
    return {
      b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A,
      a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A,
    };
  }

  // Shelves con pendiente S = 1 (Web Audio ignora Q en los shelves).
  const alpha = sin / Math.SQRT2;
  const t = 2 * Math.sqrt(A) * alpha;

  if (type === "lowshelf") {
    return {
      b0: A * ((A + 1) - (A - 1) * cos + t),
      b1: 2 * A * ((A - 1) - (A + 1) * cos),
      b2: A * ((A + 1) - (A - 1) * cos - t),
      a0: (A + 1) + (A - 1) * cos + t,
      a1: -2 * ((A - 1) + (A + 1) * cos),
      a2: (A + 1) + (A - 1) * cos - t,
    };
  }
  return {
    b0: A * ((A + 1) + (A - 1) * cos + t),
    b1: -2 * A * ((A - 1) + (A + 1) * cos),
    b2: A * ((A + 1) + (A - 1) * cos - t),
    a0: (A + 1) - (A - 1) * cos + t,
    a1: 2 * ((A - 1) - (A + 1) * cos),
    a2: (A + 1) - (A - 1) * cos - t,
  };
}

function magnitudePower(c: Coeffs, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w);
  const c2 = Math.cos(2 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2 * (c.b0 * c.b1 + c.b1 * c.b2) * c1 + 2 * c.b0 * c.b2 * c2;
  const den = c.a0 * c.a0 + c.a1 * c.a1 + c.a2 * c.a2 + 2 * (c.a0 * c.a1 + c.a1 * c.a2) * c1 + 2 * c.a0 * c.a2 * c2;
  return num / den;
}

/** Respuesta combinada (dB) de las 10 bandas en las frecuencias dadas. */
export function responseDb(bands: number[], freqs: number[], fs = 48000): number[] {
  const filters = bands.map((g, i) => biquadCoeffs(bandType(i), EQ_FREQUENCIES[i], g, EQ_Q, fs));
  return freqs.map((f) => {
    let db = 0;
    for (const c of filters) db += 10 * Math.log10(magnitudePower(c, f, fs));
    return db;
  });
}

/** n frecuencias espaciadas logarítmicamente entre 20 Hz y 20 kHz. */
export function logFrequencies(n: number, min = 20, max = 20000): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(min * Math.pow(max / min, i / (n - 1)));
  return out;
}

/**
 * Compensación de ganancia (dB) para que el ecualizador no cambie el volumen
 * percibido de la música típica: estima cuánta energía añade o quita la curva
 * ponderándola con un espectro "de música" (rosa, con caída en extremos y el
 * realce de agudos de la ponderación K). Evita el clásico engaño de que un
 * EQ con graves subidos "suena mejor" solo porque suena más fuerte, y deja
 * margen para que el limitador no tenga que trabajar de más.
 */
export function autoPreampDb(bands: number[]): number {
  if (bands.every((b) => b === 0)) return 0;
  const freqs = logFrequencies(96, 30, 16000);
  const resp = responseDb(bands, freqs);
  const kBoost = Math.pow(10, 0.4) - 1;

  let wSum = 0;
  let pSum = 0;
  freqs.forEach((f, i) => {
    const x = f / 1700;
    const k = 1 + (kBoost * x * x) / (1 + x * x);
    const taperHi = 1 / (1 + Math.pow(f / 12000, 4));
    const taperLo = 1 / (1 + Math.pow(50 / f, 4));
    const w = k * taperHi * taperLo;
    wSum += w;
    pSum += w * Math.pow(10, resp[i] / 10);
  });

  const avgDb = 10 * Math.log10(pSum / wSum);
  return Math.min(6, Math.max(-12, -avgDb));
}
