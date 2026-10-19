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
    .then(async (reg) => {
      try {
        const readyReg = await navigator.serviceWorker.ready;
        const target = readyReg?.active || reg?.active || navigator.serviceWorker?.controller;
        if (target && typeof document !== "undefined") {
          const urls = new Set<string>([
            window.location.href,
            "/",
            "/index.html",
            "/default-cover.jpg",
          ]);
          document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => {
            if (s.src && s.src.startsWith(window.location.origin)) urls.add(s.src);
          });
          document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href], link[rel="modulepreload"][href]').forEach((l) => {
            if (l.href && l.href.startsWith(window.location.origin)) urls.add(l.href);
          });
          target.postMessage({ type: "WARM_APP_SHELL", urls: Array.from(urls) });
        }
      } catch {}
      return reg;
    })
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
