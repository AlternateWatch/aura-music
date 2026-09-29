// Análisis de sonoridad por canción.
//
// El worklet entrega la energía media de cada bloque de 100 ms. Aquí los
// guardamos indexados por su posición en la canción (slot = 100 ms), de modo
// que rebobinar o repetir un tramo sobrescribe en vez de contar doble, y a
// partir de ellos calculamos el LUFS integrado como define BS.1770-4:
// ventanas de 400 ms con solape del 75 % (4 slots consecutivos), puerta
// absoluta a -70 LUFS y puerta relativa a -10 LU respecto a la media.

export const SLOT_SECONDS = 0.1;
const LUFS_OFFSET = -0.691;

export const msToLufs = (ms: number) =>
  ms > 0 ? LUFS_OFFSET + 10 * Math.log10(ms) : -Infinity;

export interface IntegratedResult {
  lufs: number | null;
  /** Segundos de audio que superaron ambas puertas (mide la "confianza"). */
  gatedSeconds: number;
}

export class TrackAnalysis {
  private slots = new Float32Array(6000).fill(NaN);
  private filled = 0;

  reset() {
    this.slots.fill(NaN);
    this.filled = 0;
  }

  set(index: number, ms: number) {
    if (index < 0 || !Number.isFinite(ms)) return;
    if (index >= this.slots.length) {
      const grown = new Float32Array(Math.max(index + 1000, this.slots.length * 2)).fill(NaN);
      grown.set(this.slots);
      this.slots = grown;
    }
    if (Number.isNaN(this.slots[index])) this.filled++;
    this.slots[index] = ms;
  }

  /** Fracción [0..1] de la canción ya medida. */
  coverage(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
    return Math.min(1, (this.filled * SLOT_SECONDS) / durationSeconds);
  }

  integrated(): IntegratedResult {
    const n = this.slots.length;
    const s = this.slots;
    const windows: number[] = [];

    for (let i = 0; i + 3 < n; i++) {
      const a = s[i], b = s[i + 1], c = s[i + 2], d = s[i + 3];
      // NaN en cualquiera => hueco sin medir; se ignora esa ventana.
      if (a !== a || b !== b || c !== c || d !== d) continue;
      const m = (a + b + c + d) / 4;
      if (msToLufs(m) > -70) windows.push(m);
    }
    if (windows.length === 0) return { lufs: null, gatedSeconds: 0 };

    let sum = 0;
    for (const m of windows) sum += m;
    const relThreshold = msToLufs(sum / windows.length) - 10;

    let gsum = 0, gcount = 0;
    for (const m of windows) {
      if (msToLufs(m) > relThreshold) { gsum += m; gcount++; }
    }
    if (gcount === 0) return { lufs: null, gatedSeconds: 0 };

    return { lufs: msToLufs(gsum / gcount), gatedSeconds: gcount * SLOT_SECONDS };
  }
}

// ---------------------------------------------------------------------------
// Caché persistente: una canción ya analizada arranca con su ganancia exacta
// desde el primer segundo, sin volver a medir.

const CACHE_KEY = "aura_loudness_v1";
const MAX_ENTRIES = 3000;

export class LoudnessCache {
  private map = new Map<string, [number, number]>(); // id -> [lufs, timestamp]
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, [number, number]>;
        for (const [id, v] of Object.entries(obj)) {
          if (Array.isArray(v) && Number.isFinite(v[0])) this.map.set(id, [v[0], v[1] || 0]);
        }
      }
    } catch {
      /* caché corrupta: se empieza de cero */
    }
  }

  get(id: string): number | null {
    const v = this.map.get(id);
    return v ? v[0] : null;
  }

  set(id: string, lufs: number) {
    this.map.set(id, [Math.round(lufs * 100) / 100, Date.now()]);
    if (this.map.size > MAX_ENTRIES) {
      const oldest = [...this.map.entries()].sort((a, b) => a[1][1] - b[1][1]);
      for (let i = 0; i < oldest.length - MAX_ENTRIES; i++) this.map.delete(oldest[i][0]);
    }
    this.scheduleSave();
  }

  /**
   * Mediana de lo ya medido en la biblioteca. Sirve como estimación inicial
   * para canciones nuevas: la mayoría caerá cerca, así que el primer segundo
   * ya suena casi al nivel correcto en lugar de a ganancia 0.
   */
  prior(): number | null {
    if (this.map.size < 5) return null;
    const vals = [...this.map.values()].map((v) => v[0]).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  clear() {
    this.map.clear();
    this.scheduleSave();
  }

  get size() {
    return this.map.size;
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        const obj: Record<string, [number, number]> = {};
        this.map.forEach((v, k) => { obj[k] = v; });
        localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
      } catch {
        /* cuota llena o modo privado: se pierde solo la persistencia */
      }
    }, 800);
  }
}
