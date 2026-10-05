import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Upload as UploadIcon, Music, Image as ImageIcon,
  CheckCircle2, AlertCircle, Loader2, Disc, Search,
  Layers, Check, FileAudio, ArrowLeft, RefreshCw, Calendar, User
} from 'lucide-react';

interface MusicUploadProps {
  onClose: () => void;
  onUploadComplete: () => void;
}

interface ITunesTrack {
  trackNumber: number;
  trackName: string;
  artistName: string;
  collectionName: string;
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
  const [albumCoverPreview, setAlbumCoverPreview] = useState<string | null>(null);
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileAssignments, setFileAssignments] = useState<{ [trackNumber: number]: File | null }>({});
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; title: string } | null>(null);

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
      try {
        const response = await fetch(highRes);
        const blob = await response.blob();
        setCoverFile(new File([blob], "cover.jpg", { type: "image/jpeg" }));
      } catch(e) {}
    }
  };

  const handleSingleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) { setError("Selecciona un archivo MP3 o FLAC válido."); return; }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('album', album);
    formData.append('track_number', trackNumber.toString());
    formData.append('tabs_url', tabsUrl);
    formData.append('video_url', videoUrl);
    formData.append('audio', audioFile);
    if (coverFile) formData.append('cover', coverFile);

    try {
      const response = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('aura_token')}` },
        body: formData
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => { onUploadComplete(); onClose(); }, 1800);
      } else {
        const data = await response.json();
        setError(data.error || "Fallo en la subida.");
      }
    } catch (err) { setError("No se pudo conectar con el servidor."); }
    setIsUploading(false);
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
      try {
        const response = await fetch(highRes);
        const blob = await response.blob();
        setAlbumCoverFile(new File([blob], "album_cover.jpg", { type: "image/jpeg" }));
      } catch(e) {}
    }

    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${albumItem.collectionId}&entity=song`);
      const data = await res.json();
      const songsOnly: ITunesTrack[] = (data.results || [])
        .filter((r: any) => r.wrapperType === 'track')
        .map((r: any) => ({
          trackNumber: r.trackNumber,
          trackName: r.trackName,
          artistName: r.artistName,
          collectionName: r.collectionName
        }))
        .sort((a: ITunesTrack, b: ITunesTrack) => a.trackNumber - b.trackNumber);

      setAlbumTracks(songsOnly);

      if (selectedFiles.length > 0) {
        autoMatchFiles(selectedFiles, songsOnly);
      }
    } catch(e) {
      setError("Error al obtener las pistas del álbum.");
    }
  };

  const autoMatchFiles = (files: File[], tracks: ITunesTrack[]) => {
    const sortedFiles = [...files].sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    const assignments: { [trackNumber: number]: File | null } = {};
    tracks.forEach((track, index) => {
      assignments[track.trackNumber] = sortedFiles[index] || null;
    });

    setFileAssignments(assignments);
  };

  const handleMultipleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    setSelectedFiles(files);

    if (albumTracks.length > 0) {
      autoMatchFiles(files, albumTracks);
    }
  };

  const handleBatchUpload = async () => {
    const tracksToUpload = albumTracks.filter(t => fileAssignments[t.trackNumber] !== null);
    if (tracksToUpload.length === 0) {
      setError("Selecciona archivos de audio para las pistas del álbum.");
      return;
    }

    setIsUploading(true);
    setError(null);

    const uploadedTrackIds: (number | string)[] = [];
    const total = tracksToUpload.length;

    for (let i = 0; i < total; i++) {
      const track = tracksToUpload[i];
      const file = fileAssignments[track.trackNumber]!;

      setUploadProgress({
        current: i + 1,
        total,
        title: track.trackName
      });

      const formData = new FormData();
      formData.append('title', track.trackName);
      formData.append('artist', track.artistName);
      formData.append('album', track.collectionName);
      formData.append('track_number', track.trackNumber.toString());
      formData.append('audio', file);
      if (albumCoverFile) formData.append('cover', albumCoverFile);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      try {
        const response = await fetch('/api/tracks', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('aura_token')}` },
          body: formData,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`El servidor respondió con error ${response.status}`);
        }

        const data = await response.json().catch(() => ({}));
        if (data.id) {
          uploadedTrackIds.push(data.id);
        }
      } catch(err: any) {
        clearTimeout(timeoutId);
        const isTimeout = err.name === 'AbortError';
        const failMsg = isTimeout 
          ? `La pista ${track.trackNumber} ("${track.trackName}") se quedó atascada (tiempo agotado).`
          : `Error al subir pista ${track.trackNumber} ("${track.trackName}"): ${err.message || 'Fallo de red'}.`;

        if (uploadedTrackIds.length > 0) {
          setError(`${failMsg} Limpiando y cancelando las ${uploadedTrackIds.length} pistas anteriores...`);
          for (const id of uploadedTrackIds) {
            try {
              await fetch(`/api/tracks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('aura_token')}` }
              });
            } catch(e) {}
          }
        }

        setError(`${failMsg} Subida cancelada por completo para no dejar el álbum a medias.`);
        setIsUploading(false);
        setUploadProgress(null);
        return;
      }
    }

    setIsUploading(false);
    setUploadProgress(null);
    setSuccess(true);
    setTimeout(() => { onUploadComplete(); onClose(); }, 2200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl border border-white/10 bg-[#121212] shadow-2xl overflow-hidden flex flex-col"
      >
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
                      <input type="file" ref={coverInputRef} className="hidden" accept="image/*" onChange={e => { if(e.target.files?.[0]){ setCoverFile(e.target.files[0]); setCoverPreview(URL.createObjectURL(e.target.files[0])); } }} />
                      {coverPreview ? <img src={coverPreview} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" /> : <ImageIcon className="text-white/20" size={24} />}
                      <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] z-10">{coverFile || coverPreview ? 'Cambiar Carátula' : 'Seleccionar Carátula'}</p>
                    </div>
                  </div>
                </div>

                {error && <div className="text-red-500 text-[10px] font-bold uppercase p-3 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle size={14} className="inline mr-2" /> {error}</div>}

                <button type="submit" disabled={isUploading || !audioFile} className="w-full bg-white text-black py-4 rounded-2xl font-bold uppercase text-[10px] tracking-[0.3em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer">
                  {isUploading ? <Loader2 className="animate-spin" size={16} /> : 'Subir pista'}
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
                      <p className="text-[8px] text-white/30 uppercase mt-0.5">Se auto-ordenarán automáticamente por número</p>
                    </div>

                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                      {albumTracks.map((track) => {
                        const assigned = fileAssignments[track.trackNumber];
                        return (
                          <div
                            key={track.trackNumber}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${
                              assigned ? 'bg-white/[0.03] border-white/5' : 'bg-red-500/5 border-red-500/10 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                              <span className="text-[10px] font-mono font-bold text-white/30 w-5">{track.trackNumber}</span>
                              <p className="text-[11px] font-semibold text-white truncate">{track.trackName}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[9px] font-mono text-brand-primary truncate max-w-[150px]">
                                {assigned ? assigned.name : 'Sin archivo'}
                              </span>
                              {assigned ? <Check size={14} className="text-green-400" /> : <AlertCircle size={14} className="text-red-400" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {uploadProgress && (
                  <div className="p-3 bg-brand-primary/10 border border-brand-primary/20 rounded-xl space-y-1.5">
                    <div className="flex justify-between text-[10px] font-bold text-white uppercase tracking-wider">
                      <span>Subiendo: {uploadProgress.title}</span>
                      <span>{uploadProgress.current} / {uploadProgress.total}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-brand-primary transition-all duration-300"
                        style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
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
                    {isUploading ? <Loader2 className="animate-spin" size={16} /> : `Subir Álbum (${Object.values(fileAssignments).filter(Boolean).length} pistas listas)`}
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