// Pequeño puente entre la app y el Service Worker de caché de audio
// (public/sw.js). No hace nada en plataformas donde no aplica: la app
// nativa de Android usa su propio reproductor/plugin, y Capacitor en
// Android/desconocido puede no soportar SW de la misma forma que un
// navegador de verdad.

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerAudioCacheSW(): Promise<ServiceWorkerRegistration | null> {
  if (registrationPromise) return registrationPromise;

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    registrationPromise = Promise.resolve(null);
    return registrationPromise;
  }

  registrationPromise = navigator.serviceWorker
    .register("/sw.js")
    .catch((err) => {
      console.error("No se pudo registrar el Service Worker de audio:", err);
      return null;
    });

  return registrationPromise;
}

// Pide al SW que descargue y cachee `url` en segundo plano, sin
// reproducirla. Pensado para precargar la siguiente canción de la cola en
// cuanto arranca la actual.
export async function prefetchAudio(url: string | undefined | null) {
  if (!url) return;

  const registration = await registerAudioCacheSW();
  const target = registration?.active || navigator.serviceWorker?.controller;
  if (!target) return;

  target.postMessage({ type: "PREFETCH", url });
}

export async function clearAudioCache() {
  const registration = await registerAudioCacheSW();
  const target = registration?.active || navigator.serviceWorker?.controller;
  target?.postMessage({ type: "CLEAR_CACHE" });
}
