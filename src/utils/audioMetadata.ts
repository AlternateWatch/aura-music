/**
 * Audio Metadata & Track Matcher Utility
 * 
 * Extrae metadatos embebidos (ID3v2 en MP3, Vorbis Comments en FLAC) y números
 * de pista desde los nombres de archivo en el navegador para emparejar automáticamente
 * y de forma precisa las pistas de un álbum.
 */

export interface AudioFileMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
}

/**
 * Parsea encabezados ID3v2 de MP3 desde un ArrayBuffer (primeros 64-128 KB del archivo).
 */
export function parseID3v2(buffer: ArrayBuffer): AudioFileMetadata | null {
  const view = new DataView(buffer);
  if (view.byteLength < 10) return null;

  // Header "ID3"
  if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
    return null;
  }

  const version = view.getUint8(3); // 3 para ID3v2.3, 4 para ID3v2.4
  const tagSize =
    ((view.getUint8(6) & 0x7f) << 21) |
    ((view.getUint8(7) & 0x7f) << 14) |
    ((view.getUint8(8) & 0x7f) << 7) |
    (view.getUint8(9) & 0x7f);

  let offset = 10;
  const max = Math.min(view.byteLength, 10 + tagSize);
  const result: AudioFileMetadata = {};

  while (offset + 10 < max) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

    // Los IDs de frames son 4 caracteres alfanuméricos en mayúsculas
    if (!/^[A-Z0-9]{4}$/.test(id)) break;

    let frameSize = 0;
    if (version === 4) {
      frameSize =
        ((view.getUint8(offset + 4) & 0x7f) << 21) |
        ((view.getUint8(offset + 5) & 0x7f) << 14) |
        ((view.getUint8(offset + 6) & 0x7f) << 7) |
        (view.getUint8(offset + 7) & 0x7f);
    } else {
      frameSize = view.getUint32(offset + 4, false);
    }

    offset += 10;
    if (frameSize <= 0 || offset + frameSize > max) break;

    // Procesar frames de texto estándar
    if (id.startsWith('T') && id !== 'TXXX' && frameSize > 1) {
      try {
        const encoding = view.getUint8(offset);
        const rawBytes = new Uint8Array(buffer, offset + 1, frameSize - 1);
        let text = '';
        if (encoding === 0) {
          text = new TextDecoder('latin1').decode(rawBytes);
        } else if (encoding === 1) {
          text = new TextDecoder('utf-16').decode(rawBytes);
        } else if (encoding === 2) {
          text = new TextDecoder('utf-16be').decode(rawBytes);
        } else if (encoding === 3) {
          text = new TextDecoder('utf-8').decode(rawBytes);
        }

        text = text.replace(/\0+$/, '').trim();

        if (id === 'TIT2' && text) result.title = text;
        if (id === 'TRCK' && text) {
          const num = parseInt(text.split('/')[0], 10);
          if (!isNaN(num) && num > 0) result.trackNumber = num;
        }
        if (id === 'TPOS' && text) {
          const disc = parseInt(text.split('/')[0], 10);
          if (!isNaN(disc) && disc > 0) result.discNumber = disc;
        }
        if (id === 'TPE1' && text) result.artist = text;
        if (id === 'TALB' && text) result.album = text;
      } catch {}
    }

    offset += frameSize;
  }

  return result;
}

/**
 * Parsea comentarios Vorbis en archivos FLAC desde un ArrayBuffer.
 */
export function parseFLAC(buffer: ArrayBuffer): AudioFileMetadata | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return null;

  // Header "fLaC"
  if (
    view.getUint8(0) !== 0x66 ||
    view.getUint8(1) !== 0x4c ||
    view.getUint8(2) !== 0x61 ||
    view.getUint8(3) !== 0x43
  ) {
    return null;
  }

  let offset = 4;
  const result: AudioFileMetadata = {};

  while (offset + 4 < view.byteLength) {
    const header = view.getUint8(offset);
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const length =
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);

    offset += 4;
    if (offset + length > view.byteLength) break;

    // Block type 4 = VORBIS_COMMENT
    if (blockType === 4) {
      try {
        let cur = offset;
        const vendorLen = view.getUint32(cur, true);
        cur += 4 + vendorLen;
        if (cur + 4 <= offset + length) {
          const commentCount = view.getUint32(cur, true);
          cur += 4;
          for (let i = 0; i < commentCount && cur + 4 <= offset + length; i++) {
            const cLen = view.getUint32(cur, true);
            cur += 4;
            if (cur + cLen <= offset + length) {
              const comment = new TextDecoder('utf-8').decode(new Uint8Array(buffer, cur, cLen));
              const eqIdx = comment.indexOf('=');
              if (eqIdx !== -1) {
                const k = comment.slice(0, eqIdx).toUpperCase();
                const v = comment.slice(eqIdx + 1).trim();
                if (k === 'TITLE') result.title = v;
                if (k === 'TRACKNUMBER') {
                  const n = parseInt(v.split('/')[0], 10);
                  if (!isNaN(n) && n > 0) result.trackNumber = n;
                }
                if (k === 'DISCNUMBER') {
                  const d = parseInt(v.split('/')[0], 10);
                  if (!isNaN(d) && d > 0) result.discNumber = d;
                }
                if (k === 'ARTIST') result.artist = v;
                if (k === 'ALBUM') result.album = v;
              }
            }
            cur += cLen;
          }
        }
      } catch {}
      break;
    }

    if (isLast) break;
    offset += length;
  }

  return result;
}

/**
 * Lee los primeros 128 KB de un archivo de audio y extrae metadatos embebidos si existen.
 */
export async function parseAudioFileMetadata(file: File): Promise<AudioFileMetadata> {
  try {
    const slice = file.slice(0, 128 * 1024);
    const buffer = await slice.arrayBuffer();

    const id3 = parseID3v2(buffer);
    if (id3 && (id3.title || id3.trackNumber)) {
      return id3;
    }

    const flac = parseFLAC(buffer);
    if (flac && (flac.title || flac.trackNumber)) {
      return flac;
    }
  } catch {}

  return {};
}

/**
 * Extrae el número de pista a partir del nombre del archivo si tiene un formato estándar:
 * - '01 - Cancion.mp3'
 * - '01. Cancion.mp3'
 * - '01 Cancion.mp3'
 * - '1-02 Cancion.mp3' (disco 1, pista 2)
 * - 'Track 03 - Cancion.mp3'
 * - '[04] Cancion.mp3'
 */
export function extractTrackNumberFromFilename(filename: string): number | null {
  const clean = filename.replace(/\.[^/.]+$/, '').trim();

  // 1. Patrón Disco-Pista: '1-02', '1.02', '1_02'
  const discTrack = clean.match(/^(?:disc\s*\d+[\s_-]*)?(\d{1,2})[-._](\d{1,3})(?:[\s._-]+|$)/i);
  if (discTrack) {
    const num = parseInt(discTrack[2], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2. Número inicial estándar: '01 - Nombre', '01. Nombre', '01 Nombre', 'Track 01'
  const leading = clean.match(/^(?:track[\s_-]*)?(\d{1,3})(?:[\s._-]+|$)/i);
  if (leading) {
    const num = parseInt(leading[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 3. Número entre corchetes o paréntesis al inicio: '[01] Nombre', '(01) Nombre'
  const bracketed = clean.match(/^[\[\(](\d{1,3})[\]\)]/);
  if (bracketed) {
    const num = parseInt(bracketed[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

/**
 * Normaliza un texto para comparaciones (minúsculas, sin tildes, sin puntuación ni extensiones).
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[_\-+.]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula la puntuación de coincidencia (0.0 a 1.0) entre el nombre del archivo y el título de una canción.
 */
export function calculateTitleSimilarity(filename: string, trackTitle: string): number {
  const normFile = normalizeText(filename);
  const normTitle = normalizeText(trackTitle);

  if (!normTitle || !normFile) return 0;
  if (normFile === normTitle) return 1.0;
  if (normFile.includes(normTitle)) return 0.95;

  const titleWords = normTitle.split(' ').filter((w) => w.length > 2);
  if (titleWords.length === 0) return 0;

  let matches = 0;
  for (const w of titleWords) {
    if (normFile.includes(w)) matches++;
  }

  return matches / titleWords.length;
}

export interface MatchableTrack {
  id: string;
  trackNumber: number;
  trackName: string;
  artistName?: string;
  discNumber?: number;
}

/**
 * Empareja archivos con pistas según la estrategia solicitada:
 * - 'order': Según el orden exacto en que se subieron los archivos (archivo 1 -> pista 1, etc.).
 * - 'smart': Extrae etiquetas ID3/FLAC, números de pista en el nombre y similitud de títulos.
 * - 'alphabetical': Ordena los archivos por nombre de archivo (A-Z con números naturales).
 */
export async function matchFilesToTracks(
  files: File[],
  tracks: MatchableTrack[],
  strategy: 'order' | 'smart' | 'alphabetical' = 'order'
): Promise<{ [trackId: string]: File | null }> {
  const assignments: { [trackId: string]: File | null } = {};
  tracks.forEach((t) => {
    assignments[t.id] = null;
  });

  if (files.length === 0 || tracks.length === 0) return assignments;

  // 1. ESTRATEGIA: ORDEN DE SUBIDA (Petición directa del usuario)
  if (strategy === 'order') {
    tracks.forEach((track, index) => {
      assignments[track.id] = files[index] || null;
    });
    return assignments;
  }

  // 2. ESTRATEGIA: ALFABÉTICO POR NOMBRE DE ARCHIVO
  if (strategy === 'alphabetical') {
    const sortedFiles = [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    tracks.forEach((track, index) => {
      assignments[track.id] = sortedFiles[index] || null;
    });
    return assignments;
  }

  // 3. ESTRATEGIA: INTELIGENTE (ID3 Tags + Número en nombre de archivo + Similitud de título)
  const filesWithMeta = await Promise.all(
    files.map(async (file) => {
      const meta = await parseAudioFileMetadata(file);
      const filenameTrackNum = extractTrackNumberFromFilename(file.name);
      return {
        file,
        metaTrackNum: meta.trackNumber ?? filenameTrackNum,
        metaTitle: meta.title,
        discNum: meta.discNumber,
      };
    })
  );

  const usedFiles = new Set<File>();

  // Paso 1: Coincidencia exacta por número de pista (ID3 o nombre)
  for (const track of tracks) {
    const found = filesWithMeta.find((f) => {
      if (usedFiles.has(f.file)) return false;
      if (track.discNumber && f.discNum && track.discNumber !== f.discNum) return false;
      return f.metaTrackNum === track.trackNumber;
    });

    if (found) {
      assignments[track.id] = found.file;
      usedFiles.add(found.file);
    }
  }

  // Paso 2: Coincidencia por similitud de título en las pistas aún sin asignar
  for (const track of tracks) {
    if (assignments[track.id]) continue;

    let bestScore = 0.65; // Umbral mínimo de confianza
    let bestFile: File | null = null;

    for (const item of filesWithMeta) {
      if (usedFiles.has(item.file)) continue;

      // Comprobar tanto título de metadatos como el propio nombre del archivo
      const scoreFilename = calculateTitleSimilarity(item.file.name, track.trackName);
      const scoreMeta = item.metaTitle
        ? calculateTitleSimilarity(item.metaTitle, track.trackName)
        : 0;
      const score = Math.max(scoreFilename, scoreMeta);

      if (score > bestScore) {
        bestScore = score;
        bestFile = item.file;
      }
    }

    if (bestFile) {
      assignments[track.id] = bestFile;
      usedFiles.add(bestFile);
    }
  }

  // Paso 3: Rellenar pistas restantes con los archivos que quedan en su orden original
  const remainingFiles = files.filter((f) => !usedFiles.has(f));
  let remIdx = 0;
  for (const track of tracks) {
    if (!assignments[track.id] && remIdx < remainingFiles.length) {
      assignments[track.id] = remainingFiles[remIdx++];
    }
  }

  return assignments;
}
