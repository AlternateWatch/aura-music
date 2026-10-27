import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { API_BASE } from '../utils/api';
import {
  X, Upload as UploadIcon, Music, Image as ImageIcon,
  CheckCircle2, AlertCircle, Loader2, Disc, Search,
  Layers, Check, FileAudio, ArrowLeft, RefreshCw, Calendar, User,
  ArrowUp, ArrowDown, Sparkles, ListOrdered, Trash2,
  AlertTriangle, RotateCcw, SkipForward
} from 'lucide-react';
import { matchFilesToTracks } from '../utils/audioMetadata';

interface MusicUploadProps {
  onClose: () => void;
  onUploadComplete: () => void;
}

interface ITunesTrack {
  id: string;
  trackNumber: number;
  discNumber?: number;
  globalTrackNumber: number;
  trackName: string;
  artistName: string;
  collectionName: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

interface UploadProgressState {
  percent: number;
  loadedStr: string;
  totalStr: string;
  phase: 'uploading' | 'processing';
}

interface BatchUploadProgressState {
  current: number;
  total: number;
  title: string;
  trackPercent: number;
  loadedStr: string;
  totalStr: string;
  phase: 'uploading' | 'processing';
}

interface UploadErrorPromptState {
  track: ITunesTrack;
  errorMsg: string;
  uploadedCount: number;
  totalCount: number;
  resolve: (action: 'finish' | 'skip' | 'retry') => void;
}

function uploadWithProgress(
  url: string,
  formData: FormData,
  token: string | null,
  onProgress: (percent: number, loaded: number, total: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
        onProgress(percent, event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({ ok: true });
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new Error("Tu sesión ha caducado. Vuelve a iniciar sesión."));
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error || `Fallo en la subida (código ${xhr.status})`));
        } catch {
          reject(new Error(`Fallo en la subida (código ${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Error de conexión al subir la canción."));
    xhr.ontimeout = () => reject(new Error("La subida tardó demasiado tiempo y se canceló."));
    xhr.timeout = 180000; // 3 minutos

    xhr.send(formData);
  });
}

export const MusicUpload: React.FC<MusicUploadProps> = ({ onClose, onUploadComplete }) => {
  const [mode, setMode] = useState<'single' | 'album'>('single');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // -------------------------------------------------------------
  // ESTADOS - MODO CANCIÓN INDIVIDUAL
  // -------------------------------------------------------------
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [trackNumber, setTrackNumber] = useState(0);
  const [tabsUrl, setTabsUrl] = useState(''); 
  const [videoUrl, setVideoUrl] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isLoadingCover, setIsLoadingCover] = useState(false);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------
  // ESTADOS - MODO ÁLBUM COMPLETO
  // -------------------------------------------------------------
  const [albumSearchTitle, setAlbumSearchTitle] = useState('');
  const [albumSearchArtist, setAlbumSearchArtist] = useState('');
  const [albumResults, setAlbumResults] = useState<any[]>([]);
  const [isSearchingAlbums, setIsSearchingAlbums] = useState(false);
  
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const [albumTracks, setAlbumTracks] = useState<ITunesTrack[]>([]);
  const [albumCoverFile, setAlbumCoverFile] = useState<File | null>(null);
  const [albumCoverUrl, setAlbumCoverUrl] = useState<string | null>(null);
  const [albumCoverPreview, setAlbumCoverPreview] = useState<string | null>(null);
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileAssignments, setFileAssignments] = useState<{ [trackId: string]: File | null }>({});
  const [matchStrategy, setMatchStrategy] = useState<'order' | 'smart' | 'alphabetical'>('order');
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const [singleProgress, setSingleProgress] = useState<UploadProgressState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<BatchUploadProgressState | null>(null);
  const [errorPrompt, setErrorPrompt] = useState<UploadErrorPromptState | null>(null);

  const multipleFilesRef = useRef<HTMLInputElement>(null);

  // =============================================================
  // LÓGICA MODO INDIVIDUAL
  // =============================================================
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (hasSelected || mode !== 'single') { setShowSuggestions(false); return; }
    const timer = setTimeout(async () => {
      if (title.length > 2) {
        try {
            const cleanTitle = title.replace(/\b(de|by)\b/gi, ' ').trim();
            const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle)}&media=music&entity=song&limit=8`);
            const data = await res.json();
            setSuggestions(data.results || []);
            setShowSuggestions(data.results?.length > 0);
        } catch(e) {}
      } else { setShowSuggestions(false); }
    }, 450);
    return () => clearTimeout(timer);
  }, [title, hasSelected, mode]);

  const selectSuggestion = async (track: any) => {
    setHasSelected(true);
    setTitle(track.trackName);
    setArtist(track.artistName);
    setAlbum(track.collectionName || '');
    setTrackNumber(track.trackNumber || 0);
    setShowSuggestions(false);
    if (track.artworkUrl100) {
      const highRes = track.artworkUrl100.replace('100x100bb', '600x600bb');
      setCoverPreview(highRes);
      setCoverUrl(highRes);
      setCoverFile(null);
      setIsLoadingCover(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(highRes, { signal: controller.signal });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith('image/') && blob.size > 0) {
            setCoverFile(new File([blob], "cover.jpg", { type: blob.type }));
          }
        }
      } catch (e) {
        // Si el navegador falla por CORS o ERR_CONNECTION_CLOSED, el backend la descargará con cover_url
        console.warn('El navegador no pudo precargar el blob de la carátula directamente; se descargará desde el servidor:', e);
      } finally {
        clearTimeout(timeoutId);
        setIsLoadingCover(false);
      }
    }
  };

  const handleSingleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) { setError("Selecciona un archivo MP3 o FLAC válido."); return; }

    setIsUploading(true);
    setError(null);
    setSingleProgress({
      percent: 0,
      loadedStr: '0 MB',
      totalStr: formatBytes(audioFile.size),
      phase: 'uploading'
    });

    const formData = new FormData();
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('album', album);
    formData.append('track_number', trackNumber.toString());
    formData.append('tabs_url', tabsUrl);
    formData.append('video_url', videoUrl);
    formData.append('audio', audioFile);
    if (coverFile) {
      formData.append('cover', coverFile);
    } else if (coverUrl) {
      formData.append('cover_url', coverUrl);
    }

    try {
      await uploadWithProgress(
        `${API_BASE}/api/tracks`,
        formData,
        localStorage.getItem('aura_token'),
        (percent, loaded, total) => {
          setSingleProgress({
            percent,
            loadedStr: formatBytes(loaded),
            totalStr: formatBytes(total),
            phase: percent >= 99 ? 'processing' : 'uploading'
          });
        }
      );

      setSingleProgress({
        percent: 100,
        loadedStr: formatBytes(audioFile.size),
        totalStr: formatBytes(audioFile.size),
        phase: 'processing'
      });
      setSuccess(true);
      setTimeout(() => { onUploadComplete(); onClose(); }, 1800);
    } catch (err: any) {
      setError(err?.message || "No se pudo conectar con el servidor.");
    } finally {
      setIsUploading(false);
      setSingleProgress(null);
    }
  };

  // =============================================================
  // LÓGICA MODO ÁLBUM
  // =============================================================
  const searchAlbums = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const titleQuery = albumSearchTitle.trim();
    const artistQuery = albumSearchArtist.trim();

    if (!titleQuery && !artistQuery) return;

    setIsSearchingAlbums(true);
    setError(null);
    setAlbumResults([]);

    try {
      if (artistQuery) {
        const artistRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(artistQuery)}&entity=musicArtist&limit=3`
        );
        const artistData = await artistRes.json();
        const matchedArtist = artistData.results?.[0];

        if (matchedArtist?.artistId) {
          const discogRes = await fetch(
            `https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=album&limit=100`
          );
          const discogData = await discogRes.json();
          let albums = (discogData.results || []).slice(1);

          if (titleQuery) {
            const filtered = albums.filter((a: any) =>
              a.collectionName?.toLowerCase().includes(titleQuery.toLowerCase())
            );
            if (filtered.length > 0) {
              albums = filtered;
            }
          }

          if (albums.length > 0) {
            setAlbumResults(albums);
            setIsSearchingAlbums(false);
            return;
          }
        }
      }

      const combinedTerm = [titleQuery, artistQuery].filter(Boolean).join(' ');
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(combinedTerm)}&media=music&entity=album&attribute=albumTerm&limit=50`
      );
      const data = await res.json();
      let results: any[] = data.results || [];

      if (results.length === 0) {
        const fallbackRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(combinedTerm)}&media=music&entity=album&limit=50`
        );
        const fallbackData = await fallbackRes.json();
        results = fallbackData.results || [];
      }

      if (results.length === 0) {
        setError("No se encontraron álbumes con esa información.");
      } else {
        setAlbumResults(results);
      }
    } catch (err) {
      setError("Error al conectar con la base de datos de iTunes.");
    }

    setIsSearchingAlbums(false);
  };

  const pickAlbum = async (albumItem: any) => {
    setSelectedAlbum(albumItem);
    setAlbumResults([]);
    setError(null);

    if (albumItem.artworkUrl100) {
      const highRes = albumItem.artworkUrl100.replace('100x100bb', '1000x1000bb');
      setAlbumCoverPreview(highRes);
      setAlbumCoverUrl(highRes);
      setAlbumCoverFile(null);
      try {
        const response = await fetch(highRes);
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith('image/') && blob.size > 0) {
            setAlbumCoverFile(new File([blob], "album_cover.jpg", { type: blob.type }));
          }
        }
      } catch(e) {
        console.warn('El navegador no pudo precargar la carátula del álbum directamente; se usará la URL remota:', e);
      }
    }

    try {
      // iTunes Lookup API: por defecto limita a 50 resultados si no se especifica.
      // Añadimos limit=200 para permitir álbumes extensos, compilaciones y bandas sonoras completas.
      const res = await fetch(`https://itunes.apple.com/lookup?id=${albumItem.collectionId}&entity=song&limit=200`);
      const data = await res.json();
      const songsOnly: ITunesTrack[] = (data.results || [])
        .filter((r: any) => r.wrapperType === 'track')
        .sort((a: any, b: any) => {
          const discA = a.discNumber || 1;
          const discB = b.discNumber || 1;
          if (discA !== discB) return discA - discB;
          return (a.trackNumber || 0) - (b.trackNumber || 0);
        })
        .map((r: any, idx: number) => ({
          id: r.trackId ? String(r.trackId) : `${r.discNumber || 1}_${r.trackNumber || (idx + 1)}_${idx}`,
          trackNumber: r.trackNumber || (idx + 1),
          discNumber: r.discNumber || 1,
          globalTrackNumber: idx + 1,
          trackName: r.trackName,
          artistName: r.artistName,
          collectionName: r.collectionName
        }));

      let finalTracks = songsOnly;
      if (selectedFiles.length > songsOnly.length) {
        const extraCount = selectedFiles.length - songsOnly.length;
        const lastTrackNum = songsOnly[songsOnly.length - 1]?.trackNumber || songsOnly.length;
        const extended = [...songsOnly];
        for (let idx = 0; idx < extraCount; idx++) {
          const newNum = lastTrackNum + idx + 1;
          extended.push({
            id: `extra_${newNum}_${Date.now()}_${idx}`,
            trackNumber: newNum,
            discNumber: 1,
            globalTrackNumber: extended.length + 1,
            trackName: `Pista ${newNum}`,
            artistName: albumItem.artistName || songsOnly[0]?.artistName || '',
            collectionName: albumItem.collectionName || songsOnly[0]?.collectionName || ''
          });
        }
        finalTracks = extended;
      }

      setAlbumTracks(finalTracks);

      if (selectedFiles.length > 0) {
        applyMatchingStrategy('order', selectedFiles, finalTracks);
      }
    } catch(e) {
      setError("Error al obtener las pistas del álbum.");
    }
  };

  const applyMatchingStrategy = async (
    strategy: 'order' | 'smart' | 'alphabetical',
    filesToUse: File[] = selectedFiles,
    tracksToUse: ITunesTrack[] = albumTracks
  ) => {
    if (tracksToUse.length === 0 || filesToUse.length === 0) return;
    setMatchStrategy(strategy);
    if (strategy === 'smart') {
      setIsAnalyzingAudio(true);
    }
    try {
      const assignments = await matchFilesToTracks(filesToUse, tracksToUse, strategy);
      setFileAssignments(assignments);
    } catch (err) {
      console.error('Error al emparejar pistas:', err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  const handleClearAssignments = () => {
    const empty: { [trackId: string]: File | null } = {};
    albumTracks.forEach((t) => {
      empty[t.id] = null;
    });
    setFileAssignments(empty);
  };

  const handleAssignFileToTrack = (trackId: string, fileName: string) => {
    setFileAssignments((prev) => {
      const next = { ...prev };
      if (!fileName) {
        next[trackId] = null;
        return next;
      }
      const chosenFile = selectedFiles.find((f) => f.name === fileName) || null;
      if (!chosenFile) return prev;

      const existingTrackId = Object.keys(next).find((tid) => next[tid]?.name === fileName);
      if (existingTrackId && existingTrackId !== trackId) {
        next[existingTrackId] = prev[trackId] || null;
      }
      next[trackId] = chosenFile;
      return next;
    });
  };

  const handleSwapAdjacent = (trackIndex: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? trackIndex - 1 : trackIndex + 1;
    if (targetIndex < 0 || targetIndex >= albumTracks.length) return;

    const currentTrack = albumTracks[trackIndex];
    const targetTrack = albumTracks[targetIndex];

    setFileAssignments((prev) => ({
      ...prev,
      [currentTrack.id]: prev[targetTrack.id] || null,
      [targetTrack.id]: prev[currentTrack.id] || null,
    }));
  };

  const handleMultipleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    setSelectedFiles(files);

    if (albumTracks.length > 0) {
      let currentTracks = [...albumTracks];
      if (files.length > currentTracks.length) {
        const extraCount = files.length - currentTracks.length;
        const lastTrackNum = currentTracks[currentTracks.length - 1]?.trackNumber || currentTracks.length;
        for (let idx = 0; idx < extraCount; idx++) {
          const newNum = lastTrackNum + idx + 1;
          currentTracks.push({
            id: `extra_${newNum}_${Date.now()}_${idx}`,
            trackNumber: newNum,
            discNumber: 1,
            globalTrackNumber: currentTracks.length + 1,
            trackName: `Pista ${newNum}`,
            artistName: selectedAlbum?.artistName || currentTracks[0]?.artistName || '',
            collectionName: selectedAlbum?.collectionName || currentTracks[0]?.collectionName || ''
          });
        }
        setAlbumTracks(currentTracks);
      }
      applyMatchingStrategy('order', files, currentTracks);
    }
  };

  const handleBatchUpload = async () => {
    const tracksToUpload = albumTracks.filter(t => fileAssignments[t.id] !== null && fileAssignments[t.id] !== undefined);
    if (tracksToUpload.length === 0) {
      setError("Selecciona archivos de audio para las pistas del álbum.");
      return;
    }

    setIsUploading(true);
    setError(null);

    const uploadedTrackIds: (number | string)[] = [];
    const total = tracksToUpload.length;
    let i = 0;

    while (i < total) {
      const track = tracksToUpload[i];
      const file = fileAssignments[track.id]!;

      setUploadProgress({
        current: i + 1,
        total,
        title: track.trackName,
        trackPercent: 0,
        loadedStr: '0 MB',
        totalStr: formatBytes(file.size),
        phase: 'uploading'
      });

      const formData = new FormData();
      formData.append('title', track.trackName);
      formData.append('artist', track.artistName);
      formData.append('album', track.collectionName);
      formData.append('track_number', (track.globalTrackNumber || track.trackNumber).toString());
      formData.append('audio', file);
      if (albumCoverFile) {
        formData.append('cover', albumCoverFile);
      } else if (albumCoverUrl) {
        formData.append('cover_url', albumCoverUrl);
      }

      try {
        const data = await uploadWithProgress(
          `${API_BASE}/api/tracks`,
          formData,
          localStorage.getItem('aura_token'),
          (trackPercent, loaded, totalBytes) => {
            setUploadProgress({
              current: i + 1,
              total,
              title: track.trackName,
              trackPercent,
              loadedStr: formatBytes(loaded),
              totalStr: formatBytes(totalBytes),
              phase: trackPercent >= 99 ? 'processing' : 'uploading'
            });
          }
        );

        if (data?.id && !uploadedTrackIds.includes(data.id)) {
          uploadedTrackIds.push(data.id);
        }
        i++;
      } catch(err: any) {
        // Verificar si la canción realmente se guardó en el servidor
        // (por ejemplo si el cliente experimentó timeout o corte de respuesta, pero el servidor la procesó)
        try {
          const verifyParams = new URLSearchParams({
            title: track.trackName || '',
            artist: track.artistName || '',
            album: track.collectionName || '',
            track_number: (track.globalTrackNumber || track.trackNumber || '').toString()
          });
          const verifyRes = await fetch(`${API_BASE}/api/tracks/verify?${verifyParams.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('aura_token')}` }
          });
          if (verifyRes.ok) {
            const verifyData = await verifyRes.json();
            if (verifyData.exists && verifyData.id) {
              console.log(`✅ Pista "${track.trackName}" confirmada en servidor tras aviso de error (ID ${verifyData.id}). Continuando automáticamente...`);
              if (!uploadedTrackIds.includes(verifyData.id)) {
                uploadedTrackIds.push(verifyData.id);
              }
              i++;
              continue;
            }
          }
        } catch (vErr) {
          console.warn('No se pudo verificar el estado en el servidor tras el error de subida:', vErr);
        }

        const errorMsg = err?.message || 'Error de conexión o fallo del servidor al subir el archivo.';

        // Notificar de inmediato al usuario y ofrecer las 3 opciones requeridas:
        const userChoice = await new Promise<'finish' | 'skip' | 'retry'>((resolve) => {
          setErrorPrompt({
            track,
            errorMsg,
            uploadedCount: uploadedTrackIds.length,
            totalCount: total,
            resolve: (action) => {
              setErrorPrompt(null);
              resolve(action);
            }
          });
        });

        if (userChoice === 'retry') {
          // Reintentar esta canción (mismo índice i)
          continue;
        } else if (userChoice === 'skip') {
          // Saltarte la canción e ir a la siguiente
          i++;
          continue;
        } else if (userChoice === 'finish') {
          // Subir el álbum como está tal cual (guardar lo ya subido)
          break;
        }
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (uploadedTrackIds.length > 0) {
      setSuccess(true);
      setTimeout(() => { onUploadComplete(); onClose(); }, 2200);
    } else {
      setError("No se guardó ninguna pista del álbum.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl border border-white/10 bg-[#121212] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* MODAL DE ERROR INTERACTIVO EN TIEMPO REAL */}
        <AnimatePresence>
          {errorPrompt && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[150] flex items-center justify-center bg-black/90 backdrop-blur-md p-6"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-md bg-[#161616] border border-red-500/30 rounded-3xl p-6 shadow-2xl space-y-5"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-red-500/10 text-red-400 rounded-2xl shrink-0 border border-red-500/20">
                    <AlertTriangle size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-red-400">
                      Error durante la subida
                    </span>
                    <h3 className="text-sm font-bold text-white truncate mt-0.5" title={errorPrompt.track.trackName}>
                      {errorPrompt.track.trackName}
                    </h3>
                    <p className="text-[10px] text-white/50 truncate font-medium">
                      Pista #{errorPrompt.track.globalTrackNumber || errorPrompt.track.trackNumber} · {errorPrompt.track.artistName}
                    </p>
                  </div>
                </div>

                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-3.5 space-y-1.5">
                  <p className="text-[11px] font-semibold text-red-300 leading-snug">
                    {errorPrompt.errorMsg}
                  </p>
                  <p className="text-[9px] text-white/40">
                    Progreso: <span className="font-bold text-white/70">{errorPrompt.uploadedCount}</span> de <span className="font-bold text-white/70">{errorPrompt.totalCount}</span> pistas subidas correctamente.
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  {/* OPCIÓN 1: Reintentar esta canción */}
                  <button
                    type="button"
                    onClick={() => errorPrompt.resolve('retry')}
                    className="w-full py-3 px-4 rounded-xl font-bold uppercase text-[10px] tracking-wider bg-brand-primary text-black hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                  >
                    <RotateCcw size={14} /> Reintentar esta canción
                  </button>

                  {/* OPCIÓN 2: Saltar la canción e ir a la siguiente */}
                  <button
                    type="button"
                    onClick={() => errorPrompt.resolve('skip')}
                    className="w-full py-3 px-4 rounded-xl font-bold uppercase text-[10px] tracking-wider bg-white/10 hover:bg-white/15 text-white active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/10"
                  >
                    <SkipForward size={14} /> Saltarte la canción e ir a la siguiente
                  </button>

                  {/* OPCIÓN 3: Subir el álbum como está tal cual */}
                  <button
                    type="button"
                    onClick={() => errorPrompt.resolve('finish')}
                    className="w-full py-2.5 px-4 rounded-xl font-bold uppercase text-[9px] tracking-wider bg-white/5 hover:bg-white/10 text-white/70 hover:text-white active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/5"
                  >
                    <CheckCircle2 size={13} className="text-green-400" />
                    {errorPrompt.uploadedCount > 0
                      ? `Subir el álbum como está tal cual (${errorPrompt.uploadedCount} pistas guardadas)`
                      : 'Cancelar subida del álbum (0 pistas guardadas)'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* CABECERA & SELECTOR DE PESTAÑAS */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <UploadIcon size={16} className="text-brand-primary" />
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/90">Aura Ingest</h2>
            </div>

            <div className="flex p-0.5 rounded-xl border border-white/10 bg-white/5">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  mode === 'single' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'
                }`}
              >
                Canción Suelta
              </button>
              <button
                type="button"
                onClick={() => setMode('album')}
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'album' ? 'bg-brand-primary text-black shadow-lg' : 'text-white/40 hover:text-white'
                }`}
              >
                <Disc size={12} /> Álbum Completo
              </button>
            </div>
          </div>

          <button onClick={onClose} className="text-white/20 hover:text-white cursor-pointer transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        {success ? (
          <div className="py-24 text-center">
            <CheckCircle2 size={54} className="text-green-500 mx-auto mb-4 animate-bounce" />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white">
              {mode === 'single' ? 'Pista enviada con éxito' : 'Álbum completo subido con éxito'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* =================================================== */}
            {/* MODO 1: CANCIÓN INDIVIDUAL                         */}
            {/* =================================================== */}
            {mode === 'single' && (
              <form onSubmit={handleSingleUpload} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  <div className="space-y-4">
                    <div className="relative" ref={dropdownRef}>
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Título de la pista</label>
                      <input 
                        type="text" required value={title} 
                        onFocus={() => !hasSelected && title.length > 2 && setShowSuggestions(true)} 
                        onChange={e => { setTitle(e.target.value); setHasSelected(false); }} 
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium focus:border-brand-primary transition-colors" 
                      />
                      {showSuggestions && (
                        <div className="absolute left-0 right-0 mt-2 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden z-[120] shadow-2xl max-h-60 overflow-y-auto">
                          {suggestions.map((s, i) => (
                            <div key={i} onClick={() => selectSuggestion(s)} className="flex items-center gap-3 p-3 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0">
                              <img src={s.artworkUrl60} className="w-8 h-8 rounded" alt="" />
                              <div className="truncate">
                                <p className="text-xs font-bold text-white truncate">{s.trackName}</p>
                                <p className="text-[9px] text-white/40 uppercase font-bold tracking-wider">{s.artistName}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Artista</label>
                      <input type="text" required value={artist} onChange={e => setArtist(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium focus:border-brand-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Álbum</label>
                      <input type="text" value={album} onChange={e => setAlbum(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium focus:border-brand-primary" />
                    </div>

                    {/* ENLACES EXTERNOS PERFECTAMENTE ALINEADOS Y CON COLORES DEL FORMULARIO */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="h-7 flex items-end text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold mb-2">
                          Songsterr (Opcional)
                        </label>
                        <input 
                          type="url" 
                          placeholder="https://songsterr.com/..." 
                          value={tabsUrl} 
                          onChange={e => setTabsUrl(e.target.value)} 
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white outline-none font-medium focus:border-brand-primary transition-colors" 
                        />
                      </div>
                      <div>
                        <label className="h-7 flex items-end text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold mb-2">
                          YouTube (Opcional)
                        </label>
                        <input 
                          type="url" 
                          placeholder="https://youtube.com/..." 
                          value={videoUrl} 
                          onChange={e => setVideoUrl(e.target.value)} 
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white outline-none font-medium focus:border-brand-primary transition-colors" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 h-full">
                    <div onClick={() => audioInputRef.current?.click()} className={`cursor-pointer flex flex-col items-center justify-center border-2 border-dashed rounded-2xl flex-1 min-h-[140px] transition-all ${audioFile ? 'border-brand-primary bg-brand-primary/5' : 'border-white/10 hover:border-white/20'}`}>
                      <input type="file" ref={audioInputRef} className="hidden" accept="audio/mpeg,audio/flac,audio/x-flac" onChange={e => setAudioFile(e.target.files?.[0] || null)} />
                      <Music className={`mb-2 ${audioFile ? 'text-brand-primary' : 'text-white/20'}`} size={24} />
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-center px-2 truncate w-full">{audioFile ? audioFile.name : 'Seleccionar MP3 / FLAC'}</p>
                    </div>
                    <div onClick={() => coverInputRef.current?.click()} className="relative cursor-pointer overflow-hidden flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl h-[100px] hover:border-white/20">
                      <input type="file" ref={coverInputRef} className="hidden" accept="image/*" onChange={e => { if(e.target.files?.[0]){ setCoverFile(e.target.files[0]); setCoverUrl(null); setCoverPreview(URL.createObjectURL(e.target.files[0])); } }} />
                      {coverPreview ? <img src={coverPreview} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" /> : <ImageIcon className="text-white/20" size={24} />}
                      <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] z-10">{coverFile || coverPreview ? 'Cambiar Carátula' : 'Seleccionar Carátula'}</p>
                    </div>
                  </div>
                </div>

                {error && <div className="text-red-500 text-[10px] font-bold uppercase p-3 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle size={14} className="inline mr-2" /> {error}</div>}

                {/* BARRA DE PROGRESO REAL DE SUBIDA */}
                {isUploading && singleProgress && (
                  <div className="p-4 bg-white/[0.04] border border-white/10 rounded-2xl space-y-2.5 animate-in fade-in duration-200 shadow-xl">
                    <div className="flex justify-between items-center text-xs font-bold text-white">
                      <span className="flex items-center gap-2">
                        <UploadIcon size={14} className="text-brand-primary animate-bounce" />
                        <span>
                          {singleProgress.phase === 'processing'
                            ? 'Procesando audio y metadatos...'
                            : `Subiendo pista (${singleProgress.percent}%)`}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-white/50">
                        {singleProgress.loadedStr} / {singleProgress.totalStr}
                      </span>
                    </div>

                    <div className="relative h-2.5 bg-black/40 border border-white/10 rounded-full overflow-hidden p-0.5">
                      <motion.div
                        className="h-full aura-dj-btn rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: `${singleProgress.percent}%` }}
                        transition={{ ease: "easeOut", duration: 0.15 }}
                      />
                    </div>

                    <p className="text-[10px] text-white/40 text-center font-medium">
                      {singleProgress.phase === 'processing'
                        ? 'Finalizando análisis de volumen e indexación...'
                        : 'Por favor, mantén la ventana abierta hasta completar la transferencia'}
                    </p>
                  </div>
                )}

                <button type="submit" disabled={isUploading || !audioFile} className="w-full bg-white text-black py-4 rounded-2xl font-bold uppercase text-[10px] tracking-[0.3em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg">
                  {isUploading ? (
                    <span className="font-mono">
                      {singleProgress
                        ? singleProgress.phase === 'processing'
                          ? 'PROCESANDO PISTA...'
                          : `SUBIENDO ${singleProgress.percent}%`
                        : 'SUBIENDO...'}
                    </span>
                  ) : (
                    'Subir pista'
                  )}
                </button>
              </form>
            )}

            {/* =================================================== */}
            {/* MODO 2: ÁLBUM COMPLETO                             */}
            {/* =================================================== */}
            {mode === 'album' && (
              <div className="space-y-6">
                {!selectedAlbum ? (
                  <div className="space-y-4">
                    <form onSubmit={searchAlbums} className="space-y-3 bg-white/[0.02] p-4 rounded-2xl border border-white/5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1.5 flex items-center gap-1.5">
                            <Disc size={12} className="text-brand-primary" /> Nombre del Álbum
                          </label>
                          <input
                            type="text"
                            placeholder="ej: American Idiot"
                            value={albumSearchTitle}
                            onChange={e => setAlbumSearchTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-xs text-white outline-none font-medium focus:border-brand-primary transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1.5 flex items-center gap-1.5">
                            <User size={12} className="text-brand-primary" /> Artista
                          </label>
                          <input
                            type="text"
                            placeholder="ej: Green Day"
                            value={albumSearchArtist}
                            onChange={e => setAlbumSearchArtist(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-xs text-white outline-none font-medium focus:border-brand-primary transition-colors"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isSearchingAlbums || (!albumSearchTitle.trim() && !albumSearchArtist.trim())}
                        className="w-full bg-brand-primary text-black py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSearchingAlbums ? <Loader2 size={14} className="animate-spin" /> : <><Search size={14} /> Buscar Álbum Oficial</>}
                      </button>
                    </form>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[340px] overflow-y-auto pr-1">
                      {albumResults.map((alb) => {
                        const releaseYear = alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null;
                        return (
                          <div
                            key={alb.collectionId}
                            onClick={() => pickAlbum(alb)}
                            className="group p-2.5 bg-white/5 border border-white/5 rounded-2xl hover:border-brand-primary/40 cursor-pointer transition-all flex flex-col items-center text-center"
                          >
                            <img
                              src={alb.artworkUrl100.replace('100x100bb', '300x300bb')}
                              alt={alb.collectionName}
                              className="w-full aspect-square rounded-xl object-cover mb-2 group-hover:scale-105 transition-transform"
                            />
                            <p className="text-[11px] font-bold text-white truncate w-full" title={alb.collectionName}>{alb.collectionName}</p>
                            <p className="text-[9px] text-white/40 uppercase font-semibold truncate w-full mt-0.5">{alb.artistName}</p>
                            
                            <div className="flex items-center justify-between w-full mt-2 pt-2 border-t border-white/5 text-[8px] text-white/30 font-mono">
                              <span>{alb.trackCount} temas</span>
                              {releaseYear && <span>{releaseYear}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <img src={albumCoverPreview || selectedAlbum.artworkUrl100} className="w-14 h-14 rounded-xl object-cover border border-white/10" alt="" />
                        <div>
                          <p className="text-xs font-bold text-white leading-tight">{selectedAlbum.collectionName}</p>
                          <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mt-0.5">{selectedAlbum.artistName}</p>
                          <span className="text-[9px] text-brand-primary font-bold">{albumTracks.length} pistas oficiales</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedAlbum(null); setAlbumTracks([]); setFileAssignments({}); setSelectedFiles([]); }}
                        className="text-[9px] font-bold uppercase text-white/40 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 cursor-pointer"
                      >
                        Cambiar Disco
                      </button>
                    </div>

                    <div
                      onClick={() => multipleFilesRef.current?.click()}
                      className={`cursor-pointer p-4 border-2 border-dashed rounded-2xl text-center transition-all ${
                        selectedFiles.length > 0 ? 'border-brand-primary bg-brand-primary/5' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <input
                        type="file"
                        ref={multipleFilesRef}
                        multiple
                        className="hidden"
                        accept="audio/mpeg,audio/flac,audio/x-flac"
                        onChange={handleMultipleFilesChange}
                      />
                      <FileAudio size={24} className={`mx-auto mb-1.5 ${selectedFiles.length > 0 ? 'text-brand-primary' : 'text-white/20'}`} />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white">
                        {selectedFiles.length > 0 ? `${selectedFiles.length} archivos de audio cargados` : 'Selecciona o arrastra los MP3 / FLAC del disco'}
                      </p>
                      <p className="text-[8px] text-white/30 uppercase mt-0.5">Se asignarán en el orden exacto en que los selecciones</p>
                    </div>

                    {/* BARRA DE HERRAMIENTAS Y ESTRATEGIAS */}
                    {selectedFiles.length > 0 && (
                      <div className="space-y-2 p-3 bg-white/[0.03] border border-white/10 rounded-2xl">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">
                              Asignación:
                            </span>
                            <span className="text-[10px] font-mono font-bold text-brand-primary">
                              {Object.values(fileAssignments).filter(Boolean).length} / {albumTracks.length} asignadas
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => applyMatchingStrategy('order')}
                              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                                matchStrategy === 'order'
                                  ? 'bg-brand-primary text-black shadow-md'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                              title="Asigna los archivos según el orden exacto en el que los seleccionaste"
                            >
                              <ListOrdered size={12} /> En orden
                            </button>

                            <button
                              type="button"
                              onClick={() => applyMatchingStrategy('smart')}
                              disabled={isAnalyzingAudio}
                              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                                matchStrategy === 'smart'
                                  ? 'bg-brand-primary text-black shadow-md'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                              title="Lee metadatos ID3/FLAC y números en los nombres de archivo para emparejar inteligentemente"
                            >
                              {isAnalyzingAudio ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Auto-detectar
                            </button>

                            <button
                              type="button"
                              onClick={() => applyMatchingStrategy('alphabetical')}
                              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                                matchStrategy === 'alphabetical'
                                  ? 'bg-brand-primary text-black shadow-md'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                              title="Ordena los archivos alfabéticamente de la A a la Z"
                            >
                              A-Z
                            </button>

                            <button
                              type="button"
                              onClick={handleClearAssignments}
                              className="px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center gap-1 cursor-pointer"
                              title="Quitar asignación de todas las pistas"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <p className="text-[8px] text-white/40 leading-relaxed">
                          💡 Puedes cambiar el archivo de cada pista con su desplegable o moverlos arriba/abajo con las flechas <span className="text-white/70">▲ ▼</span>.
                        </p>
                      </div>
                    )}

                    {/* LISTA DE PISTAS CON ASIGNACIÓN Y CONTROLES INTERACTIVOS */}
                    <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1">
                      {albumTracks.map((track, idx) => {
                        const assigned = fileAssignments[track.id];
                        return (
                          <div
                            key={track.id}
                            className={`p-2.5 rounded-xl border text-xs transition-all ${
                              assigned
                                ? 'bg-white/[0.03] border-white/10 hover:border-white/20'
                                : 'bg-red-500/5 border-red-500/15'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className="text-[10px] font-mono font-bold text-white/40 w-6 shrink-0 text-center bg-white/5 rounded px-1 py-0.5">
                                  {track.discNumber && albumTracks.some(t => (t.discNumber || 1) > 1)
                                    ? `D${track.discNumber}:${track.trackNumber}`
                                    : `#${track.globalTrackNumber}`}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold text-white truncate" title={track.trackName}>
                                    {track.trackName}
                                  </p>
                                </div>
                              </div>

                              {/* Flechas de reordenación arriba / abajo y desasignar */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleSwapAdjacent(idx, 'up')}
                                  disabled={idx === 0}
                                  title="Mover archivo a la pista anterior"
                                  className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-white/5 text-white/70 hover:text-white flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-colors"
                                >
                                  <ArrowUp size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSwapAdjacent(idx, 'down')}
                                  disabled={idx === albumTracks.length - 1}
                                  title="Mover archivo a la pista siguiente"
                                  className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-white/5 text-white/70 hover:text-white flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-colors"
                                >
                                  <ArrowDown size={11} />
                                </button>
                                {assigned && (
                                  <button
                                    type="button"
                                    onClick={() => handleAssignFileToTrack(track.id, '')}
                                    title="Desasignar archivo de esta pista"
                                    className="w-6 h-6 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center cursor-pointer transition-colors"
                                  >
                                    <X size={11} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Desplegable interactivo para elegir archivo */}
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1 min-w-0">
                                <select
                                  value={assigned ? assigned.name : ''}
                                  onChange={(e) => handleAssignFileToTrack(track.id, e.target.value)}
                                  className={`w-full text-[10px] font-mono rounded-lg py-1 px-2 border outline-none cursor-pointer transition-colors ${
                                    assigned
                                      ? 'bg-black/60 text-brand-primary border-white/10 focus:border-brand-primary'
                                      : 'bg-red-500/10 text-red-300 border-red-500/20 focus:border-red-400'
                                  }`}
                                >
                                  <option value="" className="bg-[#181818] text-white/50">
                                    -- Ningún archivo seleccionado --
                                  </option>
                                  {selectedFiles.map((f, fIdx) => {
                                    const assignedToTrack = albumTracks.find(
                                      (t) => t.id !== track.id && fileAssignments[t.id]?.name === f.name
                                    );
                                    return (
                                      <option
                                        key={`${f.name}-${fIdx}`}
                                        value={f.name}
                                        className="bg-[#181818] text-white"
                                      >
                                        #{fIdx + 1}: {f.name} {assignedToTrack ? `(en pista #${assignedToTrack.globalTrackNumber})` : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>

                              <div className="shrink-0 flex items-center">
                                {assigned ? (
                                  <span title="Archivo asignado correctamente">
                                    <Check size={14} className="text-green-400" />
                                  </span>
                                ) : (
                                  <span title="Sin archivo asignado">
                                    <AlertCircle size={14} className="text-red-400" />
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {uploadProgress && (
                  <div className="p-4 bg-white/[0.04] border border-white/10 rounded-2xl space-y-3 animate-in fade-in shadow-xl">
                    <div className="flex justify-between items-center text-xs font-bold text-white">
                      <span className="flex items-center gap-2 truncate">
                        <UploadIcon size={14} className="text-brand-primary animate-bounce shrink-0" />
                        <span className="truncate">
                          {uploadProgress.phase === 'processing'
                            ? `Procesando ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.title}`
                            : `Subiendo ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.title}`}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-white/50 shrink-0 ml-2">
                        {uploadProgress.trackPercent}%
                      </span>
                    </div>

                    {/* Barra de progreso en bytes de la pista actual */}
                    <div className="relative h-2.5 bg-black/40 border border-white/10 rounded-full overflow-hidden p-0.5">
                      <motion.div
                        className="h-full aura-dj-btn rounded-full"
                        animate={{ width: `${uploadProgress.trackPercent}%` }}
                        transition={{ ease: "easeOut", duration: 0.15 }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-white/40">
                      <span>{uploadProgress.loadedStr} / {uploadProgress.totalStr}</span>
                      <span>Pistas: {uploadProgress.current} de {uploadProgress.total}</span>
                    </div>

                    {/* Barra global del progreso del álbum */}
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-brand-primary transition-all duration-300"
                        style={{ width: `${((uploadProgress.current - 1 + (uploadProgress.trackPercent / 100)) / uploadProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {error && <div className="text-red-500 text-[10px] font-bold uppercase p-3 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle size={14} className="inline mr-2" /> {error}</div>}

                {selectedAlbum && (
                  <button
                    type="button"
                    onClick={handleBatchUpload}
                    disabled={isUploading || Object.values(fileAssignments).filter(Boolean).length === 0}
                    className="w-full bg-brand-primary text-black py-4 rounded-2xl font-bold uppercase text-[10px] tracking-[0.3em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isUploading ? (
                      <span className="font-mono">
                        {uploadProgress ? `SUBIENDO ${uploadProgress.current}/${uploadProgress.total} (${uploadProgress.trackPercent}%)` : 'SUBIENDO ÁLBUM...'}
                      </span>
                    ) : (
                      `Subir Álbum (${Object.values(fileAssignments).filter(Boolean).length} de ${albumTracks.length} pistas listas)`
                    )}
                  </button>
                )}
              </div>
            )}

          </div>
        )}
      </motion.div>
    </div>
  );
};