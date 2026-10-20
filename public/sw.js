// sw.js — Caché de audio para Aura Music.
//
// Objetivo: que una canción que ya empezó a sonar NO se corte si se pierde
// la conexión a media reproducción, y que la siguiente de la cola esté
// lista de antemano (precarga en segundo plano), igual que hacen
// Spotify/Tidal en su cliente web.
//
// Estrategia:
//  - Las peticiones de audio se sirven "cache-first": si ya la tenemos
//    entera en caché, respondemos desde ahí (incluso con Range requests,
//    que el <audio> nativo usa constantemente para hacer seek).
//  - Si no está en caché, dejamos pasar la petición a red tal cual (para no
//    romper el arranque rápido/seek en directo) y, en paralelo, lanzamos
//    UNA descarga completa (sin Range) para dejarla cacheada para la
//    próxima vez / para que el resto de la canción sobreviva a un corte.
//  - El cliente puede pedir "PREFETCH" de una URL (la siguiente canción de
//    la cola) para que se cachee sin necesidad de reproducirla.
//  - Caché con límite de nº de pistas (LRU simple).

const CACHE_NAME = "aura-audio-cache-v1";
const SHELL_CACHE_NAME = "aura-app-shell-v1";
const META_KEY = "https://aura.internal/__cache-index__";
const MAX_CACHED_TRACKS = 30;

const CORE_SHELL_URLS = [
  "/",
  "/index.html",
  "/default_cover.jpg",
  "/default-cover.jpg",
  "/manifest.json",
];

// Solo interceptamos peticiones que "huelen" a audio: evita cachear por
// error HTML/JS/API/websockets. Cubre el backend propio (/uploads/...),
// Firebase Storage, y extensiones de audio habituales por si vienen de
// otro origen (CDN, iTunes preview, etc.).
function looksLikeAudio(url) {
  const path = url.pathname;
  const isAudioExt = /\.(mp3|flac|m4a|wav|ogg|aac)(\?|$)/i.test(path);
  const isImageExt = /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(path);

  return (
    isAudioExt ||
    (path.includes("/uploads/") && !isImageExt) ||
    url.hostname.endsWith("firebasestorage.app") ||
    url.hostname.includes("firebasestorage.googleapis.com")
  );
}

function isStaticShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/socket.io/") || path.startsWith("/uploads/")) {
    return false;
  }
  return (
    path.startsWith("/assets/") ||
    path.startsWith("/icons/") ||
    /\.(js|css|woff2?|ttf|otf|png|jpe?g|webp|svg|ico|json|webmanifest)(\?|$)/i.test(path)
  );
}

async function fetchWithTimeout(request, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function getIndex(cache) {
  const res = await cache.match(META_KEY);
  if (!res) return [];
  try {
    return await res.json();
  } catch {
    return [];
  }
}

async function saveIndex(cache, index) {
  await cache.put(META_KEY, new Response(JSON.stringify(index)));
}

// Marca `url` como usada recientemente y purga las más antiguas si nos
// pasamos del límite.
async function touchAndEvict(cache, url) {
  let index = await getIndex(cache);
  index = index.filter((u) => u !== url);
  index.push(url);

  while (index.length > MAX_CACHED_TRACKS) {
    const evictUrl = index.shift();
    await cache.delete(evictUrl);
  }

  await saveIndex(cache, index);
}

// Descargas completas en curso, por URL. Sin esto, CADA petición Range del
// <audio> (se hacen muchas durante la reproducción y al hacer seek) lanzaba
// una descarga completa nueva del mismo archivo en paralelo, porque la
// copia aún no estaba en caché. Con el tiempo se acumulaban decenas de
// descargas de FLAC/MP3 enteros que saturaban las conexiones al servidor y
// dejaban colgadas otras peticiones (p.ej. la subida de canciones).
const inFlight = new Map();

// Cola: solo una descarga en segundo plano a la vez, para no competir con
// la reproducción ni con las peticiones normales de la app.
let downloadChain = Promise.resolve();

async function doCacheFullTrack(cache, url, accept) {
  // Pedimos el fichero entero (sin Range) para tener una copia completa
  // reutilizable tanto para reproducción offline como para servir
  // cualquier Range que pida el <audio> después.
  const fullRequest = new Request(url, {
    method: "GET",
    headers: { Accept: accept || "*/*" },
    mode: "cors",
    credentials: "omit",
  });

  // Si una descarga se queda colgada, abortarla para no bloquear la cola.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(fullRequest, { signal: controller.signal });
    if (!response.ok) return null;

    await cache.put(url, response.clone());
    await touchAndEvict(cache, url);
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cacheFullTrack(cache, request) {
  const url = request.url;
  if (inFlight.has(url)) return inFlight.get(url);

  const accept = request.headers.get("Accept");
  const job = downloadChain
    .catch(() => {})
    .then(async () => {
      // Puede que otra petición la haya cacheado mientras esperábamos turno.
      const already = await cache.match(url);
      if (already) return already;
      return doCacheFullTrack(cache, url, accept);
    })
    .finally(() => inFlight.delete(url));

  downloadChain = job.catch(() => {});
  inFlight.set(url, job);
  return job;
}

// Memoria temporal del último ArrayBuffer de audio servido para no releer
// un FLAC de 40 MB desde disco en cada petición Range consecutiva.
let hotAudioUrl = null;
let hotAudioBuffer = null;
let hotAudioType = "audio/mpeg";

// Cache API no soporta Range de forma nativa: si tenemos el fichero
// completo cacheado, troceamos el body nosotros mismos y devolvemos un 206.
async function servePartial(cachedResponse, rangeHeader, url) {
  let buffer;
  let contentType;

  if (url && hotAudioUrl === url && hotAudioBuffer) {
    buffer = hotAudioBuffer;
    contentType = hotAudioType;
  } else {
    buffer = await cachedResponse.arrayBuffer();
    contentType = cachedResponse.headers.get("Content-Type") || "audio/mpeg";
    if (url) {
      hotAudioUrl = url;
      hotAudioBuffer = buffer;
      hotAudioType = contentType;
    }
  }

  const total = buffer.byteLength;

  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || "");
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : total - 1;

  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;

  if (start >= total || start > end) {
    return new Response(null, { status: 416 });
  }

  const slice = start === 0 && end === total - 1 ? buffer : buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(slice.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const shellCache = await caches.open(SHELL_CACHE_NAME);
        await Promise.allSettled(
          CORE_SHELL_URLS.map(async (u) => {
            const res = await fetch(u, { cache: "no-cache" });
            if (res.ok) await shellCache.put(u, res);
          })
        );
      } catch {}
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 1. Peticiones de audio: si ya está cacheada por PREFETCH, servimos desde caché;
  // si no está en caché, dejamos que el <audio> haga streaming directo desde red sin
  // lanzar una segunda descarga paralela del mismo fichero que compita por ancho de banda/I/O.
  if (looksLikeAudio(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request.url);
        const rangeHeader = request.headers.get("Range");

        if (cached) {
          event.waitUntil(touchAndEvict(cache, request.url).catch(() => {}));
          if (rangeHeader) {
            return servePartial(cached.clone(), rangeHeader, request.url);
          }
          return cached.clone();
        }

        return fetch(request);
      })()
    );
    return;
  }

  // 2. Navegación HTML (abrir la web o la app de escritorio Tauri en ?app=desktop):
  // Network-First con timeout corto y fallback al App Shell en caché si no hay internet.
  if (request.mode === "navigate" && url.origin === self.location.origin && !url.pathname.startsWith("/api/")) {
    event.respondWith(
      (async () => {
        const shellCache = await caches.open(SHELL_CACHE_NAME);
        try {
          const networkResponse = await fetchWithTimeout(request, 3500);
          if (networkResponse && networkResponse.ok) {
            await shellCache.put(request.url, networkResponse.clone());
            await shellCache.put("/index.html", networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // Sin conexión o timeout: servimos el App Shell cacheado
        }

        const cachedPage =
          (await shellCache.match(request.url)) ||
          (await shellCache.match("/index.html")) ||
          (await shellCache.match("/"));

        if (cachedPage) return cachedPage;
        return fetch(request);
      })()
    );
    return;
  }

  // 3. Recursos estáticos del App Shell (/assets/*, iconos, fuentes, CSS/JS):
  if (isStaticShellAsset(url)) {
    event.respondWith(
      (async () => {
        const shellCache = await caches.open(SHELL_CACHE_NAME);
        const isHashedAsset = url.pathname.startsWith("/assets/");

        // Los bundles de Vite en /assets/* llevan hash en el nombre: Cache-First
        if (isHashedAsset) {
          const cached = await shellCache.match(request.url);
          if (cached) return cached;
          try {
            const netRes = await fetch(request);
            if (netRes && netRes.ok) {
              await shellCache.put(request.url, netRes.clone());
            }
            return netRes;
          } catch (err) {
            const fallback = await shellCache.match(url.pathname);
            if (fallback) return fallback;
            throw err;
          }
        }

        // Resto de estáticos del mismo origen: Network-First con fallback a caché
        try {
          const netRes = await fetchWithTimeout(request, 3500);
          if (netRes && netRes.ok) {
            await shellCache.put(request.url, netRes.clone());
            return netRes;
          }
        } catch {}

        const cached = (await shellCache.match(request.url)) || (await shellCache.match(url.pathname));
        if (cached) return cached;
        return fetch(request);
      })()
    );
  }
});

self.addEventListener("message", (event) => {
  const { type, url, urls } = event.data || {};

  if (type === "PREFETCH" && url) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const already = await cache.match(url);
        if (already) {
          await touchAndEvict(cache, url);
          return;
        }
        try {
          await cacheFullTrack(cache, new Request(url));
        } catch {
          // Sin red o fallo de CORS: simplemente no se pudo precargar,
          // no es un error fatal.
        }
      })()
    );
  }

  if (type === "WARM_APP_SHELL" && Array.isArray(urls)) {
    event.waitUntil(
      (async () => {
        try {
          const shellCache = await caches.open(SHELL_CACHE_NAME);
          await Promise.allSettled(
            urls.map(async (u) => {
              if (!u) return;
              const existing = await shellCache.match(u);
              if (existing) return;
              const res = await fetch(u);
              if (res && res.ok) {
                await shellCache.put(u, res);
              }
            })
          );
        } catch {}
      })()
    );
  }

  if (type === "CLEAR_CACHE") {
    event.waitUntil(caches.delete(CACHE_NAME));
  }
});

