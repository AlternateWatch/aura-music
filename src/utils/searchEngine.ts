import Fuse, { type IFuseOptions } from 'fuse.js';
import { useMemo } from 'react';
import type { Song } from '../constants';

export interface AlbumSearchResult {
  title: string;
  artist: string;
  coverUrl: string;
  trackCount: number;
  tracks: Song[];
  formats: Set<string>;
}

export interface ArtistSearchResult {
  name: string;
  coverUrl: string;
  trackCount: number;
  albumCount: number;
}

/**
 * Normaliza una cadena de texto para búsqueda:
 * - Elimina acentos y diacríticos (ej. "canción" -> "cancion", "Héroes" -> "heroes")
 * - Convierte a minúsculas y elimina espacios sobrantes
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Función getFn para Fuse.js que normaliza diacríticos automáticamente al indexar
 */
const customFuseGetFn = (obj: any, path: string | string[]) => {
  const value = Fuse.config.getFn(obj, path);
  if (typeof value === 'string') {
    return normalizeSearchText(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => (typeof v === 'string' ? normalizeSearchText(v) : v));
  }
  return value;
};

// ==========================================
// 1. MOTOR DE BÚSQUEDA DE CANCIONES
// ==========================================
const songFuseOptions: IFuseOptions<Song> = {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'artist', weight: 0.35 },
    { name: 'album', weight: 0.15 },
  ],
  threshold: 0.35, // Balance ideal entre tolerancia a erratas ("nirvna") y precisión
  ignoreLocation: true,
  minMatchCharLength: 1,
  includeScore: true,
  shouldSort: true,
  getFn: customFuseGetFn,
};

export function searchSongsWithFuse(fuse: Fuse<Song>, rawQuery: string, allSongs: Song[]): Song[] {
  const q = normalizeSearchText(rawQuery);
  if (!q) return allSongs;

  // 1. Búsqueda directa difusa con Fuse
  const directResults = fuse.search(q);
  if (directResults.length > 0) {
    return directResults.map(r => r.item);
  }

  // 2. Si la consulta tiene múltiples palabras (ej. "queen bohem"), buscar que contenga todas
  const words = q.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 1) {
    try {
      const multiWordResults = fuse.search({
        $and: words.map(w => ({
          $or: [
            { title: w },
            { artist: w },
            { album: w },
          ]
        }))
      });
      if (multiWordResults.length > 0) {
        return multiWordResults.map(r => r.item);
      }
    } catch {
      // En caso de que falle la expresión extendida, continuar
    }
  }

  // 3. Fallback simple por inclusión si Fuse no encontró nada
  return allSongs.filter(s => {
    const titleNorm = normalizeSearchText(s.title);
    const artistNorm = normalizeSearchText(s.artist);
    const albumNorm = normalizeSearchText(s.album);
    return titleNorm.includes(q) || artistNorm.includes(q) || albumNorm.includes(q);
  });
}

// ==========================================
// 2. MOTOR DE BÚSQUEDA DE ÁLBUMES
// ==========================================
const albumFuseOptions: IFuseOptions<AlbumSearchResult> = {
  keys: [
    { name: 'title', weight: 0.65 },
    { name: 'artist', weight: 0.35 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 1,
  includeScore: true,
  shouldSort: true,
  getFn: customFuseGetFn,
};

export function searchAlbumsWithFuse(
  fuse: Fuse<AlbumSearchResult>,
  rawQuery: string,
  allAlbums: AlbumSearchResult[]
): AlbumSearchResult[] {
  const q = normalizeSearchText(rawQuery);
  if (!q) return allAlbums;

  const directResults = fuse.search(q);
  if (directResults.length > 0) {
    return directResults.map(r => r.item);
  }

  const words = q.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 1) {
    try {
      const multiWordResults = fuse.search({
        $and: words.map(w => ({
          $or: [
            { title: w },
            { artist: w },
          ]
        }))
      });
      if (multiWordResults.length > 0) {
        return multiWordResults.map(r => r.item);
      }
    } catch {}
  }

  return allAlbums.filter(a => {
    const titleNorm = normalizeSearchText(a.title);
    const artistNorm = normalizeSearchText(a.artist);
    return titleNorm.includes(q) || artistNorm.includes(q);
  });
}

// ==========================================
// 3. MOTOR DE BÚSQUEDA DE ARTISTAS
// ==========================================
const artistFuseOptions: IFuseOptions<ArtistSearchResult> = {
  keys: [
    { name: 'name', weight: 1.0 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 1,
  includeScore: true,
  shouldSort: true,
  getFn: customFuseGetFn,
};

export function searchArtistsWithFuse(
  fuse: Fuse<ArtistSearchResult>,
  rawQuery: string,
  allArtists: ArtistSearchResult[]
): ArtistSearchResult[] {
  const q = normalizeSearchText(rawQuery);
  if (!q) return allArtists;

  const directResults = fuse.search(q);
  if (directResults.length > 0) {
    return directResults.map(r => r.item);
  }

  return allArtists.filter(a => normalizeSearchText(a.name).includes(q));
}

// ==========================================
// 4. REACT HOOKS
// ==========================================
export function useSongFuseIndex(songs: Song[]) {
  return useMemo(() => new Fuse(songs, songFuseOptions), [songs]);
}

export function useAlbumFuseIndex(albums: AlbumSearchResult[]) {
  return useMemo(() => new Fuse(albums, albumFuseOptions), [albums]);
}

export function useArtistFuseIndex(artists: ArtistSearchResult[]) {
  return useMemo(() => new Fuse(artists, artistFuseOptions), [artists]);
}
