import Dexie, { type Table } from 'dexie';
import { type Song } from '../constants';
import { playbackPriority, fetchWithPlaybackPriority } from './playbackPriority';

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

export interface OfflinePlaylistRecord {
  id: string;
  name: string;
  color?: string;
  description?: string;
  cover_path?: string;
  songIds: string[];
  syncedAt: number;
}

export interface DownloadNotice {
  uid: number;
  status: 'downloading' | 'completed' | 'removed' | 'error';
  title: string;
  subtitle: string;
}

class AuraOfflineDB extends Dexie {
  tracks!: Table<OfflineTrackRecord, string>;
  playlists!: Table<OfflinePlaylistRecord, string>;

  constructor() {
    super('AuraOfflineDB');
    this.version(1).stores({
      tracks: 'id, audioUrl, coverUrl, downloadedAt',
    });
    this.version(2).stores({
      tracks: 'id, audioUrl, coverUrl, downloadedAt',
      playlists: 'id, name, syncedAt',
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
let offlinePlaylistIdsSnapshot = new Set<string>();
let playlistSyncProgressSnapshot = new Map<string, { current: number; total: number }>();
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
  offlinePlaylistIdsSnapshot = new Set(offlinePlaylistIdsSnapshot);
  playlistSyncProgressSnapshot = new Map(playlistSyncProgressSnapshot);
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

  initPromise = Promise.all([
    offlineDb.tracks.toArray(),
    offlineDb.playlists.toArray().catch(() => [] as OfflinePlaylistRecord[]),
  ])
    .then(([trackRows, playlistRows]) => {
      offlineIdsSnapshot = new Set(trackRows.map((r) => String(r.id)));
      for (const r of trackRows) {
        if (r.coverUrl && r.coverBlob) {
          cacheBlobForUrls(r.coverUrl, r.coverBlob);
        }
      }
      offlinePlaylistIdsSnapshot = new Set(playlistRows.map((r) => String(r.id)));
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

export function getOfflinePlaylistIdsSnapshot(): Set<string> {
  return offlinePlaylistIdsSnapshot;
}

export function getPlaylistSyncProgressSnapshot(): Map<string, { current: number; total: number }> {
  return playlistSyncProgressSnapshot;
}

export function isPlaylistOffline(playlistId: string | number | undefined | null): boolean {
  if (!playlistId) return false;
  return offlinePlaylistIdsSnapshot.has(String(playlistId));
}

export function isPlaylistSyncing(playlistId: string | number | undefined | null): boolean {
  if (!playlistId) return false;
  return playlistSyncProgressSnapshot.has(String(playlistId));
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
export async function downloadSongOffline(song: Song, silent = false): Promise<boolean> {
  const id = String(song.id);
  if (downloadingIdsSnapshot.has(id)) return false;

  downloadingIdsSnapshot.add(id);
  if (!silent) {
    setNotice(
      {
        status: 'downloading',
        title: `Guardando sin conexión...`,
        subtitle: `${song.artist} — ${song.title}`,
      },
      0
    );
  }

  try {
    const rawAudioUrl = song.audioUrl.startsWith('/uploads/')
      ? `https://aura.basildo.me${song.audioUrl}`
      : song.audioUrl;
    const audioBlob = await fetchWithPlaybackPriority(rawAudioUrl);

    let coverBlob: Blob | null = null;
    if (song.coverUrl) {
      try {
        const rawCoverUrl = song.coverUrl.startsWith('/uploads/')
          ? `https://aura.basildo.me${song.coverUrl}`
          : song.coverUrl;
        coverBlob = await fetchWithPlaybackPriority(rawCoverUrl);
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
    if (!silent) {
      setNotice({
        status: 'completed',
        title: 'Disponible sin conexión',
        subtitle: `${song.artist} — ${song.title}`,
      });
    }
    return true;
  } catch (err) {
    console.error(`[OfflineDB] Error descargando "${song.title}":`, err);
    if (!silent) {
      setNotice({
        status: 'error',
        title: 'Error al descargar',
        subtitle: `${song.title}`,
      });
    }
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

export async function getAllOfflinePlaylists(): Promise<OfflinePlaylistRecord[]> {
  try {
    return await offlineDb.playlists.toArray();
  } catch {
    return [];
  }
}

export async function getOfflinePlaylistTracks(playlistId: string): Promise<Song[]> {
  try {
    const pl = await offlineDb.playlists.get(String(playlistId));
    if (!pl || !pl.songIds || pl.songIds.length === 0) return [];

    const tracks: Song[] = [];
    for (const songId of pl.songIds) {
      const record = await offlineDb.tracks.get(String(songId));
      if (record && record.song) {
        if (record.audioUrl && record.audioBlob) {
          cacheBlobForUrls(record.audioUrl, record.audioBlob);
        }
        if (record.coverUrl && record.coverBlob) {
          cacheBlobForUrls(record.coverUrl, record.coverBlob);
        }
        tracks.push(record.song);
      }
    }
    return tracks;
  } catch (err) {
    console.warn('[OfflineDB] Error obteniendo pistas de playlist offline:', err);
    return [];
  }
}

export async function syncPlaylistOffline(
  playlist: { id: string | number; name: string; color?: string; description?: string; cover_path?: string },
  songs: Song[]
): Promise<boolean> {
  const pId = String(playlist.id);
  if (playlistSyncProgressSnapshot.has(pId)) return false;

  const total = songs.length;
  if (total === 0) return false;

  playlistSyncProgressSnapshot.set(pId, { current: 0, total });
  notify();

  setNotice(
    {
      status: 'downloading',
      title: `Descargando playlist...`,
      subtitle: `${playlist.name} (0/${total})`,
    },
    0
  );

  let current = 0;
  try {
    for (const song of songs) {
      const songId = String(song.id);
      if (!offlineIdsSnapshot.has(songId)) {
        await playbackPriority.waitForBandwidth();
        await downloadSongOffline(song, true);
        await new Promise((r) => setTimeout(r, 200));
      }
      current++;
      playlistSyncProgressSnapshot.set(pId, { current, total });
      setNotice(
        {
          status: 'downloading',
          title: `Sincronizando ${playlist.name}...`,
          subtitle: `${current}/${total} canciones descargadas`,
        },
        0
      );
      notify();
    }

    await offlineDb.playlists.put({
      id: pId,
      name: playlist.name,
      color: playlist.color,
      description: playlist.description,
      cover_path: playlist.cover_path,
      songIds: songs.map((s) => String(s.id)),
      syncedAt: Date.now(),
    });

    offlinePlaylistIdsSnapshot.add(pId);
    setNotice({
      status: 'completed',
      title: '¡Playlist disponible sin conexión!',
      subtitle: `${playlist.name} (${total} canciones)`,
    });
    return true;
  } catch (err) {
    console.error(`[OfflineDB] Error sincronizando playlist ${playlist.name}:`, err);
    setNotice({
      status: 'error',
      title: 'Error al sincronizar playlist',
      subtitle: playlist.name,
    });
    return false;
  } finally {
    playlistSyncProgressSnapshot.delete(pId);
    notify();
  }
}

export async function removePlaylistOffline(
  playlistId: string | number,
  deleteSongs = false
): Promise<void> {
  const pId = String(playlistId);
  try {
    const pl = await offlineDb.playlists.get(pId);
    await offlineDb.playlists.delete(pId);
    offlinePlaylistIdsSnapshot.delete(pId);

    if (deleteSongs && pl?.songIds) {
      const allOtherPlaylists = await offlineDb.playlists.toArray();
      const otherSongIds = new Set(allOtherPlaylists.flatMap((p) => p.songIds));

      for (const songId of pl.songIds) {
        if (!otherSongIds.has(songId)) {
          await removeSongOffline(songId);
        }
      }
    }

    setNotice({
      status: 'removed',
      title: 'Playlist quitada de sin conexión',
      subtitle: pl?.name || '',
    });
  } catch (err) {
    console.error('[OfflineDB] Error eliminando playlist offline:', err);
  } finally {
    notify();
  }
}

export async function syncAlbumOffline(
  albumName: string,
  songs: Song[]
): Promise<boolean> {
  const total = songs.length;
  if (total === 0) return false;

  setNotice(
    {
      status: 'downloading',
      title: `Descargando álbum...`,
      subtitle: `${albumName} (0/${total})`,
    },
    0
  );

  let current = 0;
  try {
    for (const song of songs) {
      const songId = String(song.id);
      if (!offlineIdsSnapshot.has(songId)) {
        await playbackPriority.waitForBandwidth();
        await downloadSongOffline(song, true);
        await new Promise((r) => setTimeout(r, 200));
      }
      current++;
      setNotice(
        {
          status: 'downloading',
          title: `Descargando ${albumName}...`,
          subtitle: `${current}/${total} canciones`,
        },
        0
      );
    }

    setNotice({
      status: 'completed',
      title: '¡Álbum disponible sin conexión!',
      subtitle: `${albumName} (${total} canciones)`,
    });
    return true;
  } catch (err) {
    console.error(`[OfflineDB] Error descargando álbum ${albumName}:`, err);
    setNotice({
      status: 'error',
      title: 'Error al descargar álbum',
      subtitle: albumName,
    });
    return false;
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

      await playbackPriority.waitForBandwidth();
      blob = await fetchWithPlaybackPriority(downloadUrl);
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
