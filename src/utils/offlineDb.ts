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

// Estado reactivo en memoria para la UI
let offlineIdsSnapshot = new Set<string>();
let downloadingIdsSnapshot = new Set<string>();
const listeners = new Set<() => void>();
const blobUrlCache = new Map<string, string>();
let initPromise: Promise<void> | null = null;

function notify() {
  // Nuevas referencias de Set para que useSyncExternalStore detecte el cambio
  offlineIdsSnapshot = new Set(offlineIdsSnapshot);
  downloadingIdsSnapshot = new Set(downloadingIdsSnapshot);
  listeners.forEach((l) => l());
}

export function initOfflineStore(): Promise<void> {
  if (initPromise) return initPromise;
  if (typeof indexedDB === 'undefined') {
    initPromise = Promise.resolve();
    return initPromise;
  }

  initPromise = offlineDb.tracks
    .toCollection()
    .primaryKeys()
    .then((keys) => {
      offlineIdsSnapshot = new Set(keys.map(String));
      notify();
    })
    .catch((err) => {
      console.warn('[OfflineDB] No se pudo inicializar IndexedDB:', err);
    });

  return initPromise;
}

// Inicializar al importar en cliente
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

export function isSongOffline(songId: string | undefined | null): boolean {
  if (!songId) return false;
  return offlineIdsSnapshot.has(String(songId));
}

export function isSongDownloading(songId: string | undefined | null): boolean {
  if (!songId) return false;
  return downloadingIdsSnapshot.has(String(songId));
}

/**
 * Si la URL (audio o portada) está guardada en IndexedDB, devuelve un blob: URL local.
 */
export async function getOfflineBlobUrl(originalUrl: string): Promise<string | null> {
  if (!originalUrl || typeof indexedDB === 'undefined') return null;

  await initOfflineStore();
  if (offlineIdsSnapshot.size === 0) return null;

  const cached = blobUrlCache.get(originalUrl);
  if (cached) return cached;

  try {
    const byAudio = await offlineDb.tracks.where('audioUrl').equals(originalUrl).first();
    if (byAudio && byAudio.audioBlob) {
      const objUrl = URL.createObjectURL(byAudio.audioBlob);
      blobUrlCache.set(originalUrl, objUrl);
      return objUrl;
    }

    const byCover = await offlineDb.tracks.where('coverUrl').equals(originalUrl).first();
    if (byCover && byCover.coverBlob) {
      const objUrl = URL.createObjectURL(byCover.coverBlob);
      blobUrlCache.set(originalUrl, objUrl);
      return objUrl;
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
  notify();

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
      } catch {
        // La portada es opcional si falla
      }
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

    offlineIdsSnapshot.add(id);
    return true;
  } catch (err) {
    console.error(`[OfflineDB] Error descargando "${song.title}":`, err);
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
        const objUrl = blobUrlCache.get(u);
        if (objUrl) {
          URL.revokeObjectURL(objUrl);
          blobUrlCache.delete(u);
        }
      }
    }
    await offlineDb.tracks.delete(id);
    offlineIdsSnapshot.delete(id);
    notify();
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
 * Devuelve todas las canciones guardadas en IndexedDB (para modo sin conexión).
 */
export async function getAllOfflineSongs(): Promise<Song[]> {
  try {
    const rows = await offlineDb.tracks.orderBy('downloadedAt').reverse().toArray();
    return rows.map((r) => r.song);
  } catch {
    return [];
  }
}

/**
 * Descarga el archivo de audio directamente al disco duro del usuario ("Artista - Título.ext").
 * Si ya está guardada en IndexedDB (modo offline), la guarda al instante desde memoria local.
 */
export async function downloadSongToDisk(song: Song): Promise<void> {
  const extMatch = song.audioUrl?.split('?')[0].match(/\.(mp3|flac|wav|ogg|m4a)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : song.format ? `.${song.format.toLowerCase()}` : '.mp3';
  const safeArtist = (song.artist || 'Aura').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  const safeTitle = (song.title || 'Track').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  const fileName = `${safeArtist} - ${safeTitle}${ext}`;

  try {
    const record = await offlineDb.tracks.get(String(song.id));
    if (record?.audioBlob) {
      const tempUrl = URL.createObjectURL(record.audioBlob);
      const a = document.createElement('a');
      a.href = tempUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(tempUrl), 15000);
      return;
    }
  } catch {}

  const isRemoteHost =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'tauri:' ||
      window.location.hostname === 'tauri.localhost' ||
      (window.location.hostname === 'localhost' && window.location.port === ''));

  const base = isRemoteHost ? 'https://aura.basildo.me' : '';
  const downloadUrl = `${base}/api/tracks/${encodeURIComponent(song.id)}/download`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
