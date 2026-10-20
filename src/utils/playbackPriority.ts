/**
 * Playback Priority Coordinator
 *
 * Garantiza que la reproducción de música sea la MÁXIMA PRIORIDAD del sistema.
 * Ninguna descarga en segundo plano (playlists offline, álbumes, canciones en cola o pre-buffering)
 * puede saturar el ancho de banda ni el hilo de red si la canción actual está reproduciéndose
 * o necesita datos en su buffer.
 */

class PlaybackPriorityCoordinator {
  private isPlaying = false;
  private isBuffering = false;
  private activeAudio: HTMLAudioElement | null = null;
  private remainingDuration = 0;

  /**
   * Actualiza el estado de reproducción activo y referencia al elemento de audio.
   */
  public reportPlaybackState(
    isPlaying: boolean,
    audio: HTMLAudioElement | null,
    remainingSeconds = 0
  ) {
    this.isPlaying = isPlaying;
    this.activeAudio = audio;
    this.remainingDuration = remainingSeconds;
  }

  /**
   * Marca si el reproductor está sufriendo falta de datos (eventos waiting / stalled / loadstart).
   */
  public setBuffering(isBuffering: boolean) {
    this.isBuffering = isBuffering;
  }

  /**
   * Calcula cuántos segundos por delante tiene el elemento de audio en su buffer actual.
   */
  public getBufferedAhead(audio: HTMLAudioElement | null = this.activeAudio): number {
    if (!audio) return 0;
    try {
      const ct = audio.currentTime;
      const b = audio.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= ct + 0.5 && ct <= b.end(i)) {
          return Math.max(0, b.end(i) - ct);
        }
      }
    } catch {}
    return 0;
  }

  /**
   * Comprueba si la reproducción activa necesita ancho de banda urgentemente.
   * Devuelve true si:
   * 1. La app está reproduciendo música y el elemento está en estado de buffer (waiting/stalled).
   * 2. O si el buffer por delante es menor a 20 segundos y aún queda canción por descargar.
   */
  public isPlaybackNeedingBandwidth(): boolean {
    if (!this.isPlaying || !this.activeAudio) return false;
    if (this.isBuffering) return true;

    const bufferedAhead = this.getBufferedAhead(this.activeAudio);
    // Si la pista ya tiene todo lo que le queda en memoria, no necesita más red
    if (this.remainingDuration > 0 && bufferedAhead >= this.remainingDuration - 0.5) {
      return false;
    }

    // Umbral de seguridad: al menos 20 segundos de colchón de audio
    return bufferedAhead < 20;
  }

  /**
   * Espera de forma asíncrona hasta que la red esté libre o el reproductor
   * tenga suficiente buffer acumulado antes de permitir descargas en segundo plano.
   */
  public async waitForBandwidth(): Promise<void> {
    if (!this.isPlaying) return;

    // Si la música está sonando y necesita ancho de banda, pausar descargas y esperar
    while (this.isPlaybackNeedingBandwidth()) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    // Pequeño descanso de cortesía de 50ms para ceder ciclos de red y CPU
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const playbackPriority = new PlaybackPriorityCoordinator();

/**
 * Realiza una descarga HTTP en streaming respetando la prioridad de la música.
 * Lee el stream en fragmentos (chunks) y se detiene inmediatamente si el reproductor
 * entra en buffering o se queda con poco margen de buffer.
 */
export async function fetchWithPlaybackPriority(url: string, options?: RequestInit): Promise<Blob> {
  // 1. Esperar a que haya margen de ancho de banda antes de abrir la conexión
  await playbackPriority.waitForBandwidth();

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} descargando ${url}`);
  }

  // Fallback si ReadableStream no estuviera disponible en el entorno
  if (!response.body || typeof response.body.getReader !== 'function') {
    return await response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      // 2. Comprobar periódicamente si el reproductor necesita la red
      if (playbackPriority.isPlaybackNeedingBandwidth()) {
        await playbackPriority.waitForBandwidth();
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
      }

      // Micro-pausa de 10ms cada ~1MB para que las peticiones Range del audio pasen primero
      if (chunks.length % 16 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return new Blob(chunks, { type: contentType });
}
