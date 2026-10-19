import Dexie, { type Table } from 'dexie';
import { type Song } from '../constants';

export interface OfflineTrackRecord {
  id: string;
  song: Song;
  audioUrl: string;
  coverUrl: string;
  audioBlob: Blob;
  coverBlob: Blob | null;
  downloadedAt: number;
  sizeBytes: number;
}

export interface DownloadNotice {
  uid: number;
  status: 'downloading' | 'completed' | 'removed' | 'error';
  title: string;
  subtitle: string;
}

class AuraOfflineDB extends Dexie {
  tracks!: Table<OfflineTrackRecord, string>;

  constructor() {
    super('AuraOfflineDB');
    this.version(1).stores({
      tracks: 'id, audioUrl, coverUrl, downloadedAt',
    });
  }
}

export const offlineDb = new AuraOfflineDB();

const DISK_STORAGE_KEY = 'aura_disk_downloaded_ids';

function loadDiskIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISK_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDiskIds(ids: Set<string>) {
  try {
    localStorage.setItem(DISK_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

// Estado reactivo en memoria para la UI
let offlineIdsSnapshot = new Set<string>();
let downloadingIdsSnapshot = new Set<string>();
let diskDownloadedIdsSnapshot = loadDiskIds();
let diskDownloadingIdsSnapshot = new Set<string>();
let downloadNoticeSnapshot: DownloadNotice | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
const blobUrlCache = new Map<string, string>();
let initPromise: Promise<void> | null = null;

function notify() {
  offlineIdsSnapshot = new Set(offlineIdsSnapshot);
  downloadingIdsSnapshot = new Set(downloadingIdsSnapshot);
  diskDownloadedIdsSnapshot = new Set(diskDownloadedIdsSnapshot);
  diskDownloadingIdsSnapshot = new Set(diskDownloadingIdsSnapshot);
  listeners.forEach((l) => l());
}

function setNotice(notice: Omit<DownloadNotice, 'uid'>, autoHideMs = 3500) {
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  downloadNoticeSnapshot = { ...notice, uid: Date.now() + Math.random() };
  notify();

  if (autoHideMs > 0) {
    noticeTimer = setTimeout(() => {
      downloadNoticeSnapshot = null;
      noticeTimer = null;
      notify();
    }, autoHideMs);
  }
}

export function initOfflineStore(): Promise<void> {
  if (initPromise) return initPromise;
  if (typeof indexedDB === 'undefined') {
    initPromise = Promise.resolve();
    return initPromise;
  }

  initPromise = offlineDb.tracks
    .toArray()
    .then((rows) => {
      offlineIdsSnapshot = new Set(rows.map((r) => String(r.id)));
      for (const r of rows) {
        if (r.coverUrl && r.coverBlob) {
          cacheBlobForUrls(r.coverUrl, r.coverBlob);
        }
      }
      notify();
    })
    .catch((err) => {
      console.warn('[OfflineDB] No se pudo inicializar IndexedDB:', err);
    });

  return initPromise;
}

if (typeof window !== 'undefined') {
  void initOfflineStore();
}

export function subscribeOfflineStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOfflineIdsSnapshot(): Set<string> {
  return offlineIdsSnapshot;
}

export function getDownloadingIdsSnapshot(): Set<string> {
  return downloadingIdsSnapshot;
}

export function getDiskDownloadedIdsSnapshot(): Set<string> {
  return diskDownloadedIdsSnapshot;
}

export function getDiskDownloadingIdsSnapshot(): Set<string> {
  return diskDownloadingIdsSnapshot;
}

export function getDownloadNoticeSnapshot(): DownloadNotice | null {
  return downloadNoticeSnapshot;
}

export function isSongOffline(songId: string | undefined | null): boolean {
  if (!songId) return false;
  return offlineIdsSnapshot.has(String(songId));
}

export function isSongDownloading(songId: string | undefined | null): boolean {
  if (!songId) return false;
  return downloadingIdsSnapshot.has(String(songId));
}

function getUrlVariants(url: string): string[] {
  if (!url) return [];
  const variants = new Set<string>([url]);
  if (url.startsWith('/uploads/')) {
    variants.add(`https://aura.basildo.me${url}`);
  } else if (url.startsWith('https://aura.basildo.me/uploads/')) {
    variants.add(url.replace('https://aura.basildo.me', ''));
  }
  return Array.from(variants);
}

function cacheBlobForUrls(rawUrl: string, blob: Blob): string {
  const existing = blobUrlCache.get(rawUrl);
  if (existing) return existing;
  const objUrl = URL.createObjectURL(blob);
  for (const v of getUrlVariants(rawUrl)) {
    blobUrlCache.set(v, objUrl);
  }
  return objUrl;
}

export function getCachedOfflineBlobUrl(originalUrl?: string | null): string | undefined {
  if (!originalUrl) return undefined;
  for (const v of getUrlVariants(originalUrl)) {
    const cached = blobUrlCache.get(v);
    if (cached) return cached;
  }
  return undefined;
}

/**
 * Si la URL (audio o portada) está guardada en IndexedDB, devuelve un blob: URL local.
 */
export async function getOfflineBlobUrl(originalUrl: string): Promise<string | null> {
  if (!originalUrl || typeof indexedDB === 'undefined') return null;

  await initOfflineStore();
  if (offlineIdsSnapshot.size === 0) return null;

  const variants = getUrlVariants(originalUrl);
  for (const v of variants) {
    const cached = blobUrlCache.get(v);
    if (cached) return cached;
  }

  try {
    for (const v of variants) {
      const byAudio = await offlineDb.tracks.where('audioUrl').equals(v).first();
      if (byAudio && byAudio.audioBlob) {
        return cacheBlobForUrls(byAudio.audioUrl || originalUrl, byAudio.audioBlob);
      }

      const byCover = await offlineDb.tracks.where('coverUrl').equals(v).first();
      if (byCover && byCover.coverBlob) {
        return cacheBlobForUrls(byCover.coverUrl || originalUrl, byCover.coverBlob);
      }
    }
  } catch (err) {
    console.warn('[OfflineDB] Error leyendo blob offline:', err);
  }

  return null;
}

/**
 * Descarga una canción (audio + portada) y la guarda en IndexedDB para reproducción sin conexión.
 */
export async function downloadSongOffline(song: Song): Promise<boolean> {
  const id = String(song.id);
  if (downloadingIdsSnapshot.has(id)) return false;

  downloadingIdsSnapshot.add(id);
  setNotice(
    {
      status: 'downloading',
      title: `Guardando sin conexión...`,
      subtitle: `${song.artist} — ${song.title}`,
    },
    0
  );

  try {
    const audioRes = await fetch(song.audioUrl);
    if (!audioRes.ok) {
      throw new Error(`HTTP ${audioRes.status} descargando audio`);
    }
    const audioBlob = await audioRes.blob();

    let coverBlob: Blob | null = null;
    if (song.coverUrl) {
      try {
        const coverRes = await fetch(song.coverUrl);
        if (coverRes.ok) {
          coverBlob = await coverRes.blob();
        }
      } catch {}
    }

    const sizeBytes = audioBlob.size + (coverBlob?.size ?? 0);

    await offlineDb.tracks.put({
      id,
      song: { ...song },
      audioUrl: song.audioUrl,
      coverUrl: song.coverUrl || '',
      audioBlob,
      coverBlob,
      downloadedAt: Date.now(),
      sizeBytes,
    });

    if (song.audioUrl) cacheBlobForUrls(song.audioUrl, audioBlob);
    if (song.coverUrl && coverBlob) cacheBlobForUrls(song.coverUrl, coverBlob);

    offlineIdsSnapshot.add(id);
    setNotice({
      status: 'completed',
      title: 'Disponible sin conexión',
      subtitle: `${song.artist} — ${song.title}`,
    });
    return true;
  } catch (err) {
    console.error(`[OfflineDB] Error descargando "${song.title}":`, err);
    setNotice({
      status: 'error',
      title: 'Error al descargar',
      subtitle: `${song.title}`,
    });
    return false;
  } finally {
    downloadingIdsSnapshot.delete(id);
    notify();
  }
}

/**
 * Elimina una canción descargada de IndexedDB y libera su memoria blob.
 */
export async function removeSongOffline(songId: string): Promise<void> {
  const id = String(songId);
  try {
    const record = await offlineDb.tracks.get(id);
    if (record) {
      for (const u of [record.audioUrl, record.coverUrl]) {
        for (const v of getUrlVariants(u)) {
          const objUrl = blobUrlCache.get(v);
          if (objUrl) {
            URL.revokeObjectURL(objUrl);
            blobUrlCache.delete(v);
          }
        }
      }
    }
    await offlineDb.tracks.delete(id);
    offlineIdsSnapshot.delete(id);
    setNotice({
      status: 'removed',
      title: 'Eliminada de descargas offline',
      subtitle: record?.song?.title || '',
    });
  } catch (err) {
    console.error('[OfflineDB] Error eliminando pista offline:', err);
  }
}

export async function toggleSongOffline(song: Song): Promise<boolean> {
  const id = String(song.id);
  if (isSongOffline(id)) {
    await removeSongOffline(id);
    return false;
  } else {
    return await downloadSongOffline(song);
  }
}

/**
 * Devuelve todas las canciones guardadas en IndexedDB (para modo sin conexión)
 * y precalienta sus blob: URLs en memoria para reproducción e imágenes instantáneas.
 */
export async function getAllOfflineSongs(): Promise<Song[]> {
  try {
    const rows = await offlineDb.tracks.orderBy('downloadedAt').reverse().toArray();
    for (const r of rows) {
      if (r.audioUrl && r.audioBlob) {
        cacheBlobForUrls(r.audioUrl, r.audioBlob);
      }
      if (r.coverUrl && r.coverBlob) {
        cacheBlobForUrls(r.coverUrl, r.coverBlob);
      }
    }
    return rows.map((r) => r.song);
  } catch {
    return [];
  }
}

/**
 * Descarga el archivo de audio directamente al disco duro del usuario ("Artista - Título.ext")
 * mostrando progreso visual y marcando la canción como descargada.
 */
export async function downloadSongToDisk(song: Song): Promise<void> {
  const id = String(song.id);
  if (diskDownloadingIdsSnapshot.has(id)) return;

  const extMatch = song.audioUrl?.split('?')[0].match(/\.(mp3|flac|wav|ogg|m4a)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : song.format ? `.${song.format.toLowerCase()}` : '.mp3';
  const safeArtist = (song.artist || 'Aura').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  const safeTitle = (song.title || 'Track').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  const fileName = `${safeArtist} - ${safeTitle}${ext}`;

  diskDownloadingIdsSnapshot.add(id);
  setNotice(
    {
      status: 'downloading',
      title: 'Descargando archivo al disco...',
      subtitle: fileName,
    },
    0
  );

  try {
    // 1. Si ya está en IndexedDB, guardamos el Blob directamente al instante
    const record = await offlineDb.tracks.get(id).catch(() => undefined);
    let blob: Blob | null = record?.audioBlob ?? null;

    // 2. Si no está en IndexedDB, descargamos el archivo completo para saber exactamente cuándo finaliza
    if (!blob) {
      const isRemoteHost =
        typeof window !== 'undefined' &&
        (window.location.protocol === 'capacitor:' ||
          window.location.protocol === 'tauri:' ||
          window.location.hostname === 'tauri.localhost' ||
          (window.location.hostname === 'localhost' && window.location.port === ''));

      const base = isRemoteHost ? 'https://aura.basildo.me' : '';
      const downloadUrl = `${base}/api/tracks/${encodeURIComponent(song.id)}/download`;

      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }

    const tempUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = tempUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(tempUrl), 15000);

    diskDownloadedIdsSnapshot.add(id);
    saveDiskIds(diskDownloadedIdsSnapshot);

    setNotice({
      status: 'completed',
      title: '¡Canción descargada al disco!',
      subtitle: fileName,
    });
  } catch (err) {
    console.error('[OfflineDB] Error descargando al disco:', err);
    setNotice({
      status: 'error',
      title: 'Error al guardar en disco',
      subtitle: fileName,
    });
  } finally {
    diskDownloadingIdsSnapshot.delete(id);
    notify();
  }
}
