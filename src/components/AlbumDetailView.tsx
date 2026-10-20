import React, { useState, useSyncExternalStore, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, Pause, Shuffle, Download, CheckCircle2, Loader2, 
  ChevronLeft, Disc, Heart, MoreVertical, ListPlus, ListMusic, 
  Guitar, Trash2, Edit2, User, Music2, Check
} from 'lucide-react';
import { type Song } from '../constants';
import { useFileUrl } from '../hooks/useFileUrl';
import { DEFAULT_COVER, getResponsiveCoverSrcSet, getThumbnailUrl } from '../utils/api';
import {
  subscribeOfflineStore,
  getOfflineIdsSnapshot,
  getDownloadingIdsSnapshot,
  syncAlbumOffline,
  getCachedOfflineBlobUrl,
} from '../utils/offlineDb';
import { hapticImpact } from '../utils/haptics';

interface AlbumDetailViewProps {
  albumName: string;
  songs: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  likedIds: string[];
  playlists?: any[];
  userRole?: string;
  onPlaySong: (song: Song) => void;
  onPlayAll: (tracks: Song[]) => void;
  onShuffleAll: (tracks: Song[]) => void;
  onBack: () => void;
  onOpenArtist: (artistName: string) => void;
  onToggleLike: (songId: string) => void;
  onAddToPlaylist: (songId: string, playlistId: string) => void;
  onPlayNext: (song: Song) => void;
  onAddToQueue: (song: Song) => void;
  onEditSong: (song: Song) => void;
  onDeleteSong: (songId: string) => void;
  onOpenTabs: (song: Song) => void;
}

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({
  albumName,
  songs,
  currentSong,
  isPlaying,
  likedIds,
  playlists = [],
  userRole,
  onPlaySong,
  onPlayAll,
  onShuffleAll,
  onBack,
  onOpenArtist,
  onToggleLike,
  onAddToPlaylist,
  onPlayNext,
  onAddToQueue,
  onEditSong,
  onDeleteSong,
  onOpenTabs,
}) => {
  const [activeMenuSongId, setActiveMenuSongId] = useState<string | null>(null);
  const [playlistSubmenuSongId, setPlaylistSubmenuSongId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
    isMobile: boolean;
  } | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const handleToggleTrackMenu = (e: React.MouseEvent, track: Song) => {
    e.stopPropagation();
    if (activeMenuSongId === track.id) {
      setActiveMenuSongId(null);
      setPlaylistSubmenuSongId(null);
      setMenuPlacement(null);
      return;
    }

    const isMobile = window.innerWidth < 640;
    if (isMobile) {
      setMenuPlacement({
        left: 0,
        maxHeight: window.innerHeight * 0.82,
        isMobile: true,
      });
      setActiveMenuSongId(track.id);
      setPlaylistSubmenuSongId(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MENU_WIDTH = 240;
    const PADDING = 12;

    let left = rect.right - MENU_WIDTH;
    if (left < PADDING) {
      left = Math.max(PADDING, rect.left);
    }
    if (left + MENU_WIDTH > vw - PADDING) {
      left = Math.max(PADDING, vw - MENU_WIDTH - PADDING);
    }

    const spaceBelow = vh - rect.bottom - PADDING;
    const spaceAbove = rect.top - PADDING;
    const prefersDown = spaceBelow >= 300 || spaceBelow >= spaceAbove;

    let top: number | undefined;
    let bottom: number | undefined;
    let maxHeight: number;

    if (prefersDown) {
      top = rect.bottom + 6;
      maxHeight = Math.min(spaceBelow, 440);
    } else {
      bottom = vh - rect.top + 6;
      maxHeight = Math.min(spaceAbove, 440);
    }

    setMenuPlacement({
      top,
      bottom,
      left,
      maxHeight,
      isMobile: false,
    });
    setActiveMenuSongId(track.id);
    setPlaylistSubmenuSongId(null);
  };

  useEffect(() => {
    if (!activeMenuSongId) return;

    const handleScroll = (e: Event) => {
      if (menuContainerRef.current && e.target instanceof Node && menuContainerRef.current.contains(e.target)) {
        return;
      }
      setActiveMenuSongId(null);
      setPlaylistSubmenuSongId(null);
      setMenuPlacement(null);
    };

    const handleResize = () => {
      setActiveMenuSongId(null);
      setPlaylistSubmenuSongId(null);
      setMenuPlacement(null);
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeMenuSongId]);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  const offlineIds = useSyncExternalStore(subscribeOfflineStore, getOfflineIdsSnapshot, getOfflineIdsSnapshot);
  const downloadingIds = useSyncExternalStore(subscribeOfflineStore, getDownloadingIdsSnapshot, getDownloadingIdsSnapshot);

  // Ordenar pistas por número de pista (track_number)
  const sortedTracks = React.useMemo(() => {
    return [...songs].sort((a, b) => {
      const numA = Number(a.track_number);
      const numB = Number(b.track_number);
      if (numA && numB) return numA - numB;
      if (numA && !numB) return -1;
      if (!numA && numB) return 1;
      return parseInt(a.id) - parseInt(b.id);
    });
  }, [songs]);

  // Artista principal del álbum
  const primaryArtist = React.useMemo(() => {
    if (sortedTracks.length === 0) return 'Artista Desconocido';
    // Contar el artista más frecuente entre las pistas del álbum
    const counts = new Map<string, number>();
    sortedTracks.forEach(t => {
      const art = t.artist || 'Desconocido';
      counts.set(art, (counts.get(art) || 0) + 1);
    });
    let maxArtist = sortedTracks[0].artist;
    let maxCount = 0;
    counts.forEach((cnt, art) => {
      if (cnt > maxCount) {
        maxCount = cnt;
        maxArtist = art;
      }
    });
    return maxArtist;
  }, [sortedTracks]);

  // Portada representativa del álbum
  const coverUrlCandidate = React.useMemo(() => {
    const trackWithCover = sortedTracks.find(t => t.coverUrl && !t.coverUrl.includes('default-cover') && !t.coverUrl.includes('default_cover'));
    return trackWithCover?.coverUrl || sortedTracks[0]?.coverUrl || DEFAULT_COVER;
  }, [sortedTracks]);

  const resolvedCover = useFileUrl(coverUrlCandidate);

  // Formatos presentes en el álbum (FLAC, MP3)
  const formatsPresent = React.useMemo(() => {
    const fmts = new Set<string>();
    sortedTracks.forEach(t => {
      if (t.format) fmts.add(t.format.toUpperCase());
    });
    return Array.from(fmts);
  }, [sortedTracks]);

  // Estadísticas offline del álbum
  const downloadedCount = sortedTracks.filter(s => offlineIds.has(String(s.id))).length;
  const isAllOffline = sortedTracks.length > 0 && downloadedCount === sortedTracks.length;
  const isSyncingAny = sortedTracks.some(s => downloadingIds.has(String(s.id)));

  const handleDownloadAlbum = () => {
    if (isSyncingAny || isAllOffline || sortedTracks.length === 0) return;
    hapticImpact('medium');
    void syncAlbumOffline(albumName, sortedTracks);
  };

  const handleTrackActionFeedback = (type: 'queue' | 'next', songId: string) => {
    hapticImpact('light');
    setCopiedNotification(songId);
    setTimeout(() => setCopiedNotification(null), 1500);
  };

  return (
    <section className="space-y-8 animate-in fade-in duration-300">
      {/* 1. BOTÓN VOLVER SUPERIOR */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all text-xs font-bold uppercase tracking-wider cursor-pointer"
        >
          <ChevronLeft size={16} />
          <span>Volver a la Biblioteca</span>
        </button>
      </div>

      {/* 2. HERO CABECERA DEL ÁLBUM */}
      <div className="relative p-6 sm:p-8 md:p-10 rounded-[32px] md:rounded-[40px] bg-white/[0.03] border border-white/10 overflow-hidden shadow-2xl flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-10">
        {/* Glow de fondo difuminado basado en la portada */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-primary/10 rounded-full blur-3xl pointer-events-none" />

        {/* Portada en alta resolución con soporte responsive */}
        <div className="relative w-44 h-44 sm:w-56 sm:h-56 md:w-64 md:h-64 rounded-2xl md:rounded-3xl overflow-hidden shrink-0 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/10 bg-white/5">
          <img
            src={getCachedOfflineBlobUrl(coverUrlCandidate) || getThumbnailUrl(resolvedCover || coverUrlCandidate, 600) || DEFAULT_COVER}
            srcSet={getResponsiveCoverSrcSet(resolvedCover || coverUrlCandidate, 800)}
            sizes="(max-width: 640px) 176px, (max-width: 768px) 224px, 256px"
            loading="eager"
            fetchPriority="high"
            decoding="sync"
            alt={albumName}
            onError={(e) => {
              if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                e.currentTarget.src = DEFAULT_COVER;
                e.currentTarget.removeAttribute('srcset');
              }
            }}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Metadatos y acciones */}
        <div className="flex-1 text-center md:text-left space-y-3 min-w-0 z-10 w-full">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <Disc size={13} className="text-brand-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-primary">
              {sortedTracks.length <= 3 ? 'Single / EP' : 'Álbum Oficial'}
            </span>
            {formatsPresent.map(fmt => (
              <span
                key={fmt}
                className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-white/10 text-white/80 border border-white/10"
              >
                {fmt === 'FLAC' ? 'Hi-Res Lossless' : fmt}
              </span>
            ))}
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-serif italic font-bold text-white tracking-tight leading-tight truncate" title={albumName}>
            {albumName}
          </h1>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-white/70">
            <button
              onClick={() => onOpenArtist(primaryArtist)}
              className="font-semibold text-white hover:text-brand-primary transition-colors flex items-center gap-1.5 cursor-pointer underline-offset-4 hover:underline"
            >
              <User size={14} className="text-white/40" />
              <span>{primaryArtist}</span>
            </button>
            <span className="text-white/30">•</span>
            <span className="text-white/50 text-xs font-mono">
              {sortedTracks.length} {sortedTracks.length === 1 ? 'canción' : 'canciones'}
            </span>
            {isAllOffline && (
              <>
                <span className="text-white/30">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 size={12} />
                  <span>Disponible offline</span>
                </span>
              </>
            )}
          </div>

          {/* Botonera de control de reproducción */}
          <div className="pt-3 flex flex-wrap items-center justify-center md:justify-start gap-3">
            <button
              onClick={() => onPlayAll(sortedTracks)}
              className="px-7 py-3 rounded-full bg-brand-primary text-black font-bold text-xs uppercase tracking-wider hover:scale-105 active:scale-95 transition-all shadow-xl cursor-pointer flex items-center gap-2.5"
            >
              <Play size={16} fill="black" />
              <span>Reproducir Álbum</span>
            </button>

            <button
              onClick={() => onShuffleAll(sortedTracks)}
              className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold text-xs uppercase tracking-wider hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-2"
            >
              <Shuffle size={14} />
              <span>Aleatorio</span>
            </button>

            <button
              onClick={handleDownloadAlbum}
              disabled={isSyncingAny || sortedTracks.length === 0}
              className={`px-4 py-3 rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer border ${
                isSyncingAny
                  ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/30'
                  : isAllOffline
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border-white/10'
              }`}
              title={isAllOffline ? 'Álbum descargado' : 'Descargar álbum para escuchar sin conexión'}
            >
              {isSyncingAny ? (
                <>
                  <Loader2 size={14} className="animate-spin text-brand-primary" />
                  <span>Descargando...</span>
                </>
              ) : isAllOffline ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span>Descargado ({sortedTracks.length})</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Descargar Álbum ({downloadedCount}/{sortedTracks.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 3. TRACKLIST EN LISTA VERTICAL */}
      <div className="p-4 sm:p-6 md:p-8 rounded-[28px] md:rounded-[36px] bg-white/[0.02] border border-white/5 space-y-2">
        {/* Cabecera de columnas para pantallas medianas/grandes */}
        <div className="hidden md:grid grid-cols-[3rem_1fr_6rem_5rem] items-center px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 mb-2">
          <span className="text-center">#</span>
          <span>Título</span>
          <span className="text-center">Formato</span>
          <span className="text-right pr-2">Acciones</span>
        </div>

        {/* Filas de canciones */}
        <div className="space-y-1">
          {sortedTracks.map((track, idx) => {
            const isCurrentTrack = currentSong?.id === track.id;
            const isTrackPlaying = isCurrentTrack && isPlaying;
            const isLiked = likedIds.some(id => String(id) === String(track.id));
            const isTrackOffline = offlineIds.has(String(track.id));
            const isTrackDownloading = downloadingIds.has(String(track.id));
            const trackNum = track.track_number ?? (idx + 1);
            const isMenuOpen = activeMenuSongId === track.id;
            const isSubmenuOpen = playlistSubmenuSongId === track.id;

            return (
              <div
                key={track.id}
                className={`group relative flex items-center justify-between md:grid md:grid-cols-[3rem_1fr_6rem_5rem] px-3 sm:px-4 py-3 rounded-2xl transition-all cursor-pointer ${
                  isCurrentTrack
                    ? 'bg-brand-primary/10 border border-brand-primary/30'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => onPlaySong(track)}
              >
                {/* 1. NÚMERO DE PISTA / ICONO PLAY O EQUALIZER */}
                <div className="w-10 sm:w-12 shrink-0 md:w-auto flex items-center justify-center text-sm font-mono text-white/40">
                  {isTrackPlaying ? (
                    <div className="flex items-end justify-center gap-0.5 h-4 w-4">
                      <span className="w-1 bg-brand-primary rounded-full animate-bounce [animation-delay:-0.3s] h-full" />
                      <span className="w-1 bg-brand-primary rounded-full animate-bounce [animation-delay:-0.15s] h-2/3" />
                      <span className="w-1 bg-brand-primary rounded-full animate-bounce h-4/5" />
                    </div>
                  ) : isCurrentTrack ? (
                    <Play size={14} className="text-brand-primary fill-brand-primary" />
                  ) : (
                    <>
                      <span className="group-hover:hidden tabular-nums font-bold text-xs">
                        {String(trackNum).padStart(2, '0')}
                      </span>
                      <Play size={13} className="hidden group-hover:block text-white" />
                    </>
                  )}
                </div>

                {/* 2. TÍTULO Y ARTISTA */}
                <div className="flex-1 min-w-0 pr-3 sm:pr-4">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm sm:text-base font-bold truncate leading-tight ${
                        isCurrentTrack ? 'text-brand-primary' : 'text-white'
                      }`}
                    >
                      {track.title}
                    </p>
                    {isTrackOffline && (
                      <CheckCircle2 size={12} className="text-emerald-400 shrink-0" title="Guardado offline" />
                    )}
                    {isTrackDownloading && (
                      <Loader2 size={12} className="animate-spin text-brand-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-white/40 truncate mt-0.5">
                    {track.artist}
                  </p>
                </div>

                {/* 3. FORMATO / CALIDAD */}
                <div className="hidden md:flex items-center justify-center">
                  <span
                    className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${
                      track.format === 'flac'
                        ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30'
                        : 'bg-white/5 text-white/40 border-white/5'
                    }`}
                  >
                    {track.format?.toUpperCase() || 'MP3'}
                  </span>
                </div>

                {/* 4. ACCIONES (LIKE Y MENÚ CONTEXTUAL) */}
                <div
                  className="flex items-center justify-end gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Botón Like */}
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpact('light');
                      onToggleLike(String(track.id));
                    }}
                    className={`p-2 rounded-full transition-colors cursor-pointer ${
                      isLiked ? 'text-red-500' : 'text-white/20 hover:text-white/60'
                    }`}
                    title={isLiked ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                  >
                    <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
                  </button>

                  {/* Menú de opciones */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => handleToggleTrackMenu(e, track)}
                      className={`p-2 rounded-full transition-colors cursor-pointer outline-none ${
                        activeMenuSongId === track.id ? 'bg-brand-primary text-black' : 'text-white/30 hover:text-white hover:bg-white/10'
                      }`}
                      title="Más opciones"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PORTAL DEL MENÚ DESPLEGABLE (EVITA CLIPPING POR OVERFLOW-HIDDEN O BORDES) */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {activeMenuSongId && menuPlacement && (() => {
            const activeTrack = sortedTracks.find(t => t.id === activeMenuSongId);
            if (!activeTrack) return null;
            const isSubmenuOpen = playlistSubmenuSongId === activeTrack.id;
            const isTrackLiked = likedIds.some(id => String(id) === String(activeTrack.id));

            const renderTrackActions = (isMobile: boolean) => {
              const itemPadding = isMobile ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-xs';
              const iconSize = isMobile ? 18 : 14;

              return (
                <>
                  {/* Like / Favoritos */}
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpact('light');
                      onToggleLike(String(activeTrack.id));
                      setActiveMenuSongId(null);
                      setMenuPlacement(null);
                    }}
                    className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
                  >
                    <Heart size={iconSize} fill={isTrackLiked ? "currentColor" : "none"} className={isTrackLiked ? "text-red-500" : ""} />
                    <span>{isTrackLiked ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}</span>
                  </button>

                  {/* Reproducir siguiente */}
                  <button
                    type="button"
                    onClick={() => {
                      onPlayNext(activeTrack);
                      handleTrackActionFeedback('next', activeTrack.id);
                      setActiveMenuSongId(null);
                      setMenuPlacement(null);
                    }}
                    className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
                  >
                    {copiedNotification === activeTrack.id ? <Check size={iconSize} className="text-emerald-400" /> : <ListMusic size={iconSize} />}
                    <span>Reproducir siguiente</span>
                  </button>

                  {/* Añadir a la cola */}
                  <button
                    type="button"
                    onClick={() => {
                      onAddToQueue(activeTrack);
                      handleTrackActionFeedback('queue', activeTrack.id);
                      setActiveMenuSongId(null);
                      setMenuPlacement(null);
                    }}
                    className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
                  >
                    <ListPlus size={iconSize} />
                    <span>Añadir a la cola</span>
                  </button>

                  {/* Ver Tabs / Acordes */}
                  {activeTrack.tabs_url && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenTabs(activeTrack);
                        setActiveMenuSongId(null);
                        setMenuPlacement(null);
                      }}
                      className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer text-left`}
                    >
                      <Guitar size={iconSize} />
                      <span>Ver Acordes / Tabs</span>
                    </button>
                  )}

                  {/* Añadir a Playlist */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setPlaylistSubmenuSongId(isSubmenuOpen ? null : activeTrack.id)}
                      className={`w-full flex items-center justify-between ${itemPadding} rounded-xl font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
                    >
                      <div className="flex items-center gap-3">
                        <ListPlus size={iconSize} />
                        <span>Añadir a Playlist</span>
                      </div>
                      <span className="text-[10px] text-white/40">{isSubmenuOpen ? '▲' : '▼'}</span>
                    </button>

                    {isSubmenuOpen && (
                      <div className={`${isMobile ? 'max-h-44' : 'max-h-32'} overflow-y-auto pl-6 pr-2 py-1 space-y-1 bg-black/40 rounded-xl my-1 border border-white/5`}>
                        {playlists.length > 0 ? (
                          playlists.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                onAddToPlaylist(activeTrack.id, p.id.toString());
                                setActiveMenuSongId(null);
                                setPlaylistSubmenuSongId(null);
                                setMenuPlacement(null);
                              }}
                              className={`w-full text-left py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-[11px]'} font-medium text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer truncate`}
                            >
                              {p.name}
                            </button>
                          ))
                        ) : (
                          <p className="py-2 text-[10px] text-white/30 text-center">No hay playlists</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Opciones de Moderación / Edición */}
                  {(userRole === 'admin' || userRole === 'moderator') && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onEditSong(activeTrack);
                          setActiveMenuSongId(null);
                          setMenuPlacement(null);
                        }}
                        className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left border-t border-white/5 mt-1`}
                      >
                        <Edit2 size={iconSize} />
                        <span>Editar metadatos</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onDeleteSong(activeTrack.id);
                          setActiveMenuSongId(null);
                          setMenuPlacement(null);
                        }}
                        className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer text-left`}
                      >
                        <Trash2 size={iconSize} />
                        <span>Eliminar pista</span>
                      </button>
                    </>
                  )}
                </>
              );
            };

            return menuPlacement.isMobile ? (
              <div className="fixed inset-0 z-[600] flex flex-col justify-end">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenuSongId(null);
                    setPlaylistSubmenuSongId(null);
                    setMenuPlacement(null);
                  }}
                />
                <motion.div 
                  ref={menuContainerRef}
                  initial={{ y: "100%", opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "100%", opacity: 0 }}
                  transition={{ type: "spring", damping: 28, stiffness: 320 }}
                  className="relative z-[601] w-full max-h-[82vh] bg-[#161616] border-t border-white/10 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="w-10 h-1 bg-white/20 rounded-full mx-auto my-3 shrink-0" />
                  <div className="px-5 pb-3 flex items-center gap-3 border-b border-white/5 shrink-0">
                    <img
                      src={resolvedCover || DEFAULT_COVER}
                      alt={activeTrack.title}
                      onError={(e) => {
                        if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                          e.currentTarget.src = DEFAULT_COVER;
                        }
                      }}
                      className="w-11 h-11 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-white truncate">{activeTrack.title}</h4>
                      <p className="text-xs text-white/50 truncate font-medium mt-0.5">{activeTrack.artist || primaryArtist}</p>
                    </div>
                  </div>
                  <div className="overflow-y-auto px-3 py-2 space-y-1 overscroll-contain">
                    {renderTrackActions(true)}
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="fixed inset-0 z-[550]">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenuSongId(null);
                    setPlaylistSubmenuSongId(null);
                    setMenuPlacement(null);
                  }}
                />
                <motion.div 
                  ref={menuContainerRef}
                  initial={{ opacity: 0, scale: 0.94, y: menuPlacement.top !== undefined ? -8 : 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: menuPlacement.top !== undefined ? -8 : 8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: 'fixed',
                    left: `${menuPlacement.left}px`,
                    top: menuPlacement.top !== undefined ? `${menuPlacement.top}px` : undefined,
                    bottom: menuPlacement.bottom !== undefined ? `${menuPlacement.bottom}px` : undefined,
                    maxHeight: `${menuPlacement.maxHeight}px`,
                    width: '240px',
                  }}
                  className="bg-[#141416]/95 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-y-auto z-[551] shadow-2xl p-1.5 text-xs text-white select-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderTrackActions(false)}
                </motion.div>
              </div>
            );
          })()}
        </AnimatePresence>,
        document.body
      )}
    </section>
  );
};
