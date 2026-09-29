// Medidor de sonoridad que corre en el hilo de audio (AudioWorklet).
//
// Aplica el filtro de ponderación K de ITU-R BS.1770 (shelf de agudos + paso
// alto, con los coeficientes exactos para cualquier sample rate) y emite cada
// 100 ms la energía media de ese bloque (suma de los canales L+R). El cálculo
// de LUFS integrado, con sus puertas, se hace en el hilo principal a partir
// de esos bloques (ver loudnessAnalysis.ts).
//
// Se carga como Blob URL para no depender de cómo Vite/Tauri sirvan ficheros
// estáticos, y no lo throttlea el navegador cuando la ventana está en segundo
// plano (a diferencia de setInterval).

export const LOUDNESS_WORKLET_NAME = "aura-loudness";

export const LOUDNESS_WORKLET_SOURCE = `
class AuraLoudnessMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    const fs = sampleRate;
    this.blockLen = Math.round(fs * 0.1);
    this.frames = 0;
    this.sumSq = 0;
    this.peak = 0;

    // Etapa 1: high-shelf (cabeza acústica)
    {
      const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
      const K = Math.tan(Math.PI * f0 / fs);
      const Vh = Math.pow(10, G / 20);
      const Vb = Math.pow(Vh, 0.4996667741545416);
      const a0 = 1 + K / Q + K * K;
      this.s1 = {
        b0: (Vh + Vb * K / Q + K * K) / a0,
        b1: 2 * (K * K - Vh) / a0,
        b2: (Vh - Vb * K / Q + K * K) / a0,
        a1: 2 * (K * K - 1) / a0,
        a2: (1 - K / Q + K * K) / a0
      };
    }
    // Etapa 2: paso alto RLB
    {
      const f0 = 38.13547087602444, Q = 0.5003270373238773;
      const K = Math.tan(Math.PI * f0 / fs);
      const a0 = 1 + K / Q + K * K;
      this.s2 = {
        b0: 1, b1: -2, b2: 1,
        a1: 2 * (K * K - 1) / a0,
        a2: (1 - K / Q + K * K) / a0
      };
    }
    // Estado por canal: [s1.z1, s1.z2, s2.z1, s2.z2]
    this.st = [new Float64Array(4), new Float64Array(4)];
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || inp.length === 0) return true;
    const nCh = Math.min(inp.length, 2);
    const len = inp[0].length;
    const s1 = this.s1, s2 = this.s2;

    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nCh; c++) {
        const x = inp[c][i];
        const st = this.st[c];

        const y1 = s1.b0 * x + st[0];
        st[0] = s1.b1 * x - s1.a1 * y1 + st[1];
        st[1] = s1.b2 * x - s1.a2 * y1;

        const y2 = s2.b0 * y1 + st[2];
        st[2] = s2.b1 * y1 - s2.a1 * y2 + st[3];
        st[3] = s2.b2 * y1 - s2.a2 * y2;

        this.sumSq += y2 * y2;
        const ax = x < 0 ? -x : x;
        if (ax > this.peak) this.peak = ax;
      }
      if (++this.frames >= this.blockLen) {
        this.port.postMessage({ ms: this.sumSq / this.blockLen, peak: this.peak });
        this.frames = 0;
        this.sumSq = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor("${LOUDNESS_WORKLET_NAME}", AuraLoudnessMeter);
`;
