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
const META_KEY = "https://aura.internal/__cache-index__";
const MAX_CACHED_TRACKS = 30;

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

// Cache API no soporta Range de forma nativa: si tenemos el fichero
// completo cacheado, troceamos el body nosotros mismos y devolvemos un 206.
async function servePartial(cachedResponse, rangeHeader) {
  const buffer = await cachedResponse.arrayBuffer();
  const total = buffer.byteLength;

  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || "");
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;

  if (start >= total || start > end) {
    return new Response(null, { status: 416 });
  }

  const slice = buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cachedResponse.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(slice.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
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
  if (!looksLikeAudio(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request.url); // sin Range: copia completa
      const rangeHeader = request.headers.get("Range");

      if (cached) {
        await touchAndEvict(cache, request.url);
        if (rangeHeader) {
          return servePartial(cached.clone(), rangeHeader);
        }
        return cached.clone();
      }

      // No está en caché todavía: la petición va a red normal (para no
      // penalizar el arranque ni el seek) y en segundo plano se encola UNA
      // descarga completa (deduplicada) para futuras veces / para aguantar
      // un corte de conexión más adelante en esta misma canción.
      event.waitUntil(cacheFullTrack(cache, request).catch(() => {}));
      return fetch(request);
    })()
  );
});

self.addEventListener("message", (event) => {
  const { type, url } = event.data || {};

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

  if (type === "CLEAR_CACHE") {
    event.waitUntil(caches.delete(CACHE_NAME));
  }
});
