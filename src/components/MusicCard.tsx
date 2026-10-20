import React, { useState, useSyncExternalStore, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, Pause, ListPlus, Guitar, Trash2, 
  Edit2, ListMusic, Heart, MoreVertical, Youtube, Check, Download, Loader2, HardDriveDownload,
  Disc, User
} from 'lucide-react';
import { type Song } from '../constants';
import { hapticImpact } from '../utils/haptics';
import {
  subscribeOfflineStore,
  getOfflineIdsSnapshot,
  getDownloadingIdsSnapshot,
  getDiskDownloadedIdsSnapshot,
  getDiskDownloadingIdsSnapshot,
  toggleSongOffline,
  downloadSongToDisk,
} from '../utils/offlineDb';
import { useFileUrl } from '../hooks/useFileUrl';
import { DEFAULT_COVER, getResponsiveCoverSrcSet, getThumbnailUrl } from '../utils/api';

interface MusicCardProps {
  song: Song;
  isActive: boolean;
  isPlaying: boolean;
  playlists?: any[];
  userRole?: string;
  isLiked?: boolean;
  onToggleLike: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onRemoveFromPlaylist?: () => void;
  onOpenTabs: () => void;
  onDelete: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onEdit: () => void;
  onOpenAlbum?: (albumName: string) => void;
  onOpenArtist?: (artistName: string) => void;
  /** Si estamos en una sesión colaborativa, muestra "Proponer para votación". */
  onClick: () => void;

  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  isDragging?: boolean;
  priority?: boolean;
}

export const MusicCard: React.FC<MusicCardProps> = ({ 
  song, isActive, isPlaying, playlists = [], userRole, isLiked, onToggleLike,
  onAddToPlaylist, onRemoveFromPlaylist, onOpenTabs, onDelete, onPlayNext, onAddToQueue, onEdit, onOpenAlbum, onOpenArtist, onClick, onDragStart,
  onDragOver, onDrop, isDragging, priority
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);

  const [menuPlacement, setMenuPlacement] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
    isMobile: boolean;
  } | null>(null);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setShowMenu(false);
    setShowPlaylistSubmenu(false);
    setMenuPlacement(null);
  };

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showMenu) {
      closeMenu();
      return;
    }

    const isMobile = window.innerWidth < 640;
    if (isMobile) {
      setMenuPlacement({
        left: 0,
        maxHeight: window.innerHeight * 0.82,
        isMobile: true,
      });
      setShowMenu(true);
      setShowPlaylistSubmenu(false);
      return;
    }

    if (menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const MENU_WIDTH = 260;
      const PADDING = 12;

      // Horizontal: alinear a la derecha del botón por defecto, protegiendo contra corte izquierdo y derecho
      let left = rect.right - MENU_WIDTH;
      if (left < PADDING) {
        left = Math.max(PADDING, rect.left);
      }
      if (left + MENU_WIDTH > vw - PADDING) {
        left = Math.max(PADDING, vw - MENU_WIDTH - PADDING);
      }

      // Vertical: calcular espacio disponible arriba y abajo
      const spaceBelow = vh - rect.bottom - PADDING;
      const spaceAbove = rect.top - PADDING;
      const prefersDown = spaceBelow >= 340 || spaceBelow >= spaceAbove;

      let top: number | undefined;
      let bottom: number | undefined;
      let maxHeight: number;

      if (prefersDown) {
        top = rect.bottom + 6;
        maxHeight = Math.min(spaceBelow, 480);
      } else {
        bottom = vh - rect.top + 6;
        maxHeight = Math.min(spaceAbove, 480);
      }

      setMenuPlacement({
        top,
        bottom,
        left,
        maxHeight,
        isMobile: false,
      });
      setShowMenu(true);
      setShowPlaylistSubmenu(false);
    }
  };

  useEffect(() => {
    if (!showMenu) return;

    const handleScroll = (e: Event) => {
      if (menuContainerRef.current && e.target instanceof Node && menuContainerRef.current.contains(e.target)) {
        return;
      }
      closeMenu();
    };

    const handleResize = () => {
      closeMenu();
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [showMenu]);


  // Feedback visual al añadir a la cola o reproducir siguiente
  const [addedToQueue, setAddedToQueue] = useState(false);
  const [playedNext, setPlayedNext] = useState(false);

  // La portada aparece con un fundido suave en vez de "reventar" de golpe
  // en cuanto llega. El fondo (bg-white/5) ya hace de placeholder mientras
  // tanto, así que esto no cambia el aspecto final, solo cómo se presenta
  // la carátula mientras carga.
  const [coverLoaded, setCoverLoaded] = useState(false);

  const offlineIds = useSyncExternalStore(subscribeOfflineStore, getOfflineIdsSnapshot, getOfflineIdsSnapshot);
  const downloadingIds = useSyncExternalStore(subscribeOfflineStore, getDownloadingIdsSnapshot, getDownloadingIdsSnapshot);
  const diskDownloadedIds = useSyncExternalStore(subscribeOfflineStore, getDiskDownloadedIdsSnapshot, getDiskDownloadedIdsSnapshot);
  const diskDownloadingIds = useSyncExternalStore(subscribeOfflineStore, getDiskDownloadingIdsSnapshot, getDiskDownloadingIdsSnapshot);

  const isOffline = offlineIds.has(String(song.id));
  const isDownloading = downloadingIds.has(String(song.id));
  const isDiskDownloaded = diskDownloadedIds.has(String(song.id));
  const isDiskDownloading = diskDownloadingIds.has(String(song.id));
  const anyDownloading = isDownloading || isDiskDownloading;
  const anyDownloaded = isOffline || isDiskDownloaded;
  const resolvedCoverUrl = useFileUrl(song.coverUrl);

  // FUNCIÓN UNIVERSAL PARA ABRIR ENLACES EN EL NAVEGADOR (ESCRITORIO Y WEB)
  const openExternalLink = async (url: string | undefined | null) => {
    if (!url || !url.trim()) return;
    const cleanUrl = url.trim();

    // 1. Intento con función global inyectada en Tauri
    if (typeof (window as any).__TAURI_OPEN_URL__ === 'function') {
      try {
        (window as any).__TAURI_OPEN_URL__(cleanUrl);
        return;
      } catch (e) {}
    }

    // 2. Intento con el plugin oficial de apertura de Tauri v2
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(cleanUrl);
      return;
    } catch (e) {}

    // 3. Intento directo con el canal IPC interno de Tauri
    try {
      if ((window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: cleanUrl });
        return;
      }
    } catch (e) {}

    // 4. Si estamos en navegador normal (Chrome/Firefox/Safari/móvil):
    const a = document.createElement('a');
    a.href = cleanUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleQueueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToQueue();
    setAddedToQueue(true);
    setTimeout(() => setAddedToQueue(false), 1500);
  };

  const handlePlayNextClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlayNext();
    setPlayedNext(true);
    setTimeout(() => setPlayedNext(false), 1500);
  };

  const handleOpenVideo = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const videoUrl = (song as any).video_url;
    if (videoUrl && videoUrl.trim()) {
      openExternalLink(videoUrl);
    } else {
      alert("Esta canción aún no tiene un vídeo oficial vinculado. Puedes añadirlo editando los metadatos.");
    }
  };

  const hasVideo = Boolean((song as any).video_url && (song as any).video_url.trim());
  const hasTabs = Boolean((song as any).tabs_url && (song as any).tabs_url.trim());

  const renderMenuActions = (isMobile: boolean) => {
    const itemPadding = isMobile ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-xs';
    const iconSize = isMobile ? 18 : 15;

    return (
      <>
        {/* 1. LIKE / FAVORITOS */}
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onToggleLike(); closeMenu(); }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
        >
          <Heart size={iconSize} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "text-red-500" : ""} />
          <span>{isLiked ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}</span>
        </button>

        {/* 1.5 DESCARGAR MODO SIN CONEXIÓN */}
        <button
          type="button"
          disabled={isDownloading}
          onClick={() => {
            hapticImpact('light');
            void toggleSongOffline(song);
            closeMenu();
          }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left disabled:opacity-50`}
        >
          {isDownloading ? (
            <Loader2 size={iconSize} className="text-brand-primary animate-spin" />
          ) : (
            <Download size={iconSize} className={isOffline ? "text-emerald-400" : ""} />
          )}
          <span>
            {isDownloading
              ? 'Descargando...'
              : isOffline
                ? 'Quitar descarga offline'
                : 'Descargar sin conexión'}
          </span>
        </button>

        {/* 1.6 GUARDAR ARCHIVO EN DISCO DURO */}
        <button
          type="button"
          disabled={isDiskDownloading}
          onClick={() => {
            hapticImpact('light');
            void downloadSongToDisk(song);
            closeMenu();
          }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left disabled:opacity-50`}
        >
          {isDiskDownloading ? (
            <Loader2 size={iconSize} className="text-brand-primary animate-spin" />
          ) : isDiskDownloaded ? (
            <Check size={iconSize} className="text-emerald-400" />
          ) : (
            <HardDriveDownload size={iconSize} />
          )}
          <span className={isDiskDownloaded ? "text-emerald-400" : ""}>
            {isDiskDownloading
              ? 'Descargando al disco...'
              : isDiskDownloaded
                ? 'Descargada en disco (guardar copia)'
                : 'Descargar archivo al disco'}
          </span>
        </button>

        {/* 2. VER TABS / ACORDES */}
        <button
          type="button"
          onClick={() => { 
            closeMenu();
            const tabsUrl = (song as any).tabs_url;
            if (tabsUrl && tabsUrl.trim()) {
              openExternalLink(tabsUrl);
            } else {
              onOpenTabs();
            }
          }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold transition-colors cursor-pointer text-left ${
            hasTabs ? 'text-white/70 hover:text-brand-primary hover:bg-white/10' : 'text-white/30 hover:text-white/50 hover:bg-white/5'
          }`}
        >
          <Guitar size={iconSize} />
          <span>{hasTabs ? 'Ver Acordes / Tabs' : 'Sin acordes / tabs'}</span>
        </button>

        {/* 3. VÍDEO OFICIAL YOUTUBE */}
        <button
          type="button"
          onClick={() => { closeMenu(); handleOpenVideo(); }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold transition-colors cursor-pointer text-left ${
            hasVideo ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' : 'text-white/30 hover:text-white/50 hover:bg-white/5'
          }`}
        >
          <Youtube size={iconSize} />
          <span>{hasVideo ? 'Vídeo Oficial (YouTube)' : 'Sin vídeo oficial'}</span>
        </button>

        {/* IR AL ÁLBUM */}
        {song.album && onOpenAlbum && (
          <button
            type="button"
            onClick={() => {
              closeMenu();
              onOpenAlbum(song.album);
            }}
            className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
          >
            <Disc size={iconSize} />
            <span className="truncate">Ir al álbum</span>
          </button>
        )}

        {/* IR AL ARTISTA */}
        {song.artist && onOpenArtist && (
          <button
            type="button"
            onClick={() => {
              closeMenu();
              onOpenArtist(song.artist);
            }}
            className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
          >
            <User size={iconSize} />
            <span className="truncate">Ir al artista</span>
          </button>
        )}

        {/* 4. REPRODUCIR SIGUIENTE */}
        <button
          type="button"
          onClick={(e) => {
            handlePlayNextClick(e);
            closeMenu();
          }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
        >
          {playedNext ? <Check size={iconSize} className="text-green-400" /> : <ListMusic size={iconSize} />}
          <span>{playedNext ? '¡Se reproducirá siguiente!' : 'Reproducir siguiente'}</span>
        </button>

        {/* 5. AÑADIR A LA COLA */}
        <button
          type="button"
          onClick={(e) => { 
            handleQueueClick(e);
            closeMenu(); 
          }}
          className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
        >
          {addedToQueue ? <Check size={iconSize} className="text-green-400" /> : <ListPlus size={iconSize} />}
          <span>{addedToQueue ? '¡Añadida a la cola!' : 'Añadir a la cola'}</span>
        </button>

        {/* 6. AÑADIR A PLAYLIST */}
        <div>
          <button
            type="button"
            onClick={() => setShowPlaylistSubmenu(!showPlaylistSubmenu)}
            className={`w-full flex items-center justify-between ${itemPadding} rounded-xl font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left`}
          >
            <div className="flex items-center gap-3">
              <ListPlus size={iconSize} />
              <span>Añadir a Playlist</span>
            </div>
            <span className="text-[10px] text-white/30">{showPlaylistSubmenu ? '▲' : '▼'}</span>
          </button>

          {showPlaylistSubmenu && (
            <div className={`${isMobile ? 'max-h-48' : 'max-h-36'} overflow-y-auto pl-8 pr-2 py-1 space-y-1 bg-black/40 rounded-xl my-1 border border-white/5`}>
              {playlists.length > 0 ? (
                playlists.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onAddToPlaylist(p.id.toString());
                      closeMenu();
                    }}
                    className={`w-full text-left py-2 px-2.5 ${isMobile ? 'text-xs' : 'text-[11px]'} font-medium text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer truncate`}
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

        {/* 7. QUITAR DE LA PLAYLIST Y DE TODO */}
        {onRemoveFromPlaylist && (
          <button
            type="button"
            onClick={() => { onRemoveFromPlaylist(); closeMenu(); }}
            className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer text-left border-t border-white/5 mt-1`}
          >
            <Trash2 size={iconSize} />
            <span>Quitar de esta lista</span>
          </button>
        )}

        {/* 8. OPCIONES DE ADMINISTRACIÓN */}
        {(userRole === 'admin' || userRole === 'moderator') && (
          <button
            type="button"
            onClick={() => { onEdit(); closeMenu(); }}
            className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left border-t border-white/5 mt-1`}
          >
            <Edit2 size={iconSize} />
            <span>Editar metadatos</span>
          </button>
        )}

        {userRole === 'admin' && (
          <button
            type="button"
            onClick={() => { hapticImpact('heavy'); onDelete(); closeMenu(); }}
            className={`w-full flex items-center gap-3 ${itemPadding} rounded-xl font-semibold text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left`}
          >
            <Trash2 size={iconSize} />
            <span>Eliminar canción</span>
          </button>
        )}
      </>
    );
  };

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (onDragOver) {
          e.preventDefault();
          e.stopPropagation();
          onDragOver(e);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop?.();
      }}
      className={`group relative p-2.5 sm:p-3 md:p-4 rounded-2xl md:rounded-3xl transition-all duration-300 flex flex-col justify-between ${
        showMenu ? 'z-30' : 'z-0'
      } ${
        isDragging
          ? 'opacity-30 scale-95'
          : isActive
            ? 'bg-white/10 ring-1 ring-[#F27D26]/40 shadow-[0_8px_24px_rgba(242,125,38,0.2)]'
            : 'bg-white/5 hover:bg-white/[0.08]'
      } ${
        onDragStart ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* PORTADA LIMPIA */}
      <div onClick={onClick} className="relative aspect-square rounded-xl md:rounded-2xl overflow-hidden mb-2.5 sm:mb-3 cursor-pointer shrink-0 bg-white/5 shadow-md">
        <img
          ref={(el) => {
            if (el?.complete && !coverLoaded) {
              setCoverLoaded(true);
            }
          }}
          src={getThumbnailUrl(resolvedCoverUrl || song.coverUrl, 300) || DEFAULT_COVER}
          srcSet={getResponsiveCoverSrcSet(resolvedCoverUrl || song.coverUrl, 600)}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 20vw"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding={priority ? "sync" : "async"}
          className={`w-full h-full object-cover transition-transform duration-700 ${isActive && isPlaying ? 'scale-110' : 'md:group-hover:scale-105'}`}
          alt={song.title}
          draggable={false}
          onLoad={() => setCoverLoaded(true)}
          onError={(e) => {
            if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
              e.currentTarget.src = DEFAULT_COVER;
              e.currentTarget.removeAttribute('srcset');
            } else {
              setCoverLoaded(true);
            }
          }}
        />
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'}`}>
          {isPlaying && isActive ? (
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-tr from-amber-500 to-[#F27D26] flex items-center justify-center shadow-lg shadow-orange-500/30 scale-100 transition-transform">
              <Pause size={20} className="md:w-5 md:h-5 text-black" fill="black" />
            </div>
          ) : (
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-tr from-amber-500 to-[#F27D26] flex items-center justify-center shadow-lg shadow-orange-500/30 scale-95 hover:scale-105 transition-transform">
              <Play size={20} className="ml-0.5 md:w-5 md:h-5 text-black" fill="black" />
            </div>
          )}
        </div>
      </div>

      {/* FILA INFERIOR: INFORMACIÓN + BOTÓN DE 3 PUNTOS */}
      <div className="flex items-end justify-between gap-2 min-w-0 w-full pt-0.5">
        
        {/* TÍTULO Y ARTISTA */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm md:text-sm font-semibold md:font-bold text-white truncate leading-tight tracking-tight" title={song.title}>
              {song.title}
            </h3>
            {isDownloading ? (
              <Loader2 size={12} className="text-brand-primary animate-spin shrink-0" title="Descargando para modo sin conexión..." />
            ) : isOffline ? (
              <Download size={12} className="text-emerald-400 shrink-0" title="Disponible sin conexión" />
            ) : null}
          </div>
          <p className="text-xs md:text-[10px] text-white/50 uppercase font-bold tracking-wider truncate" title={song.artist}>
            {song.artist}
          </p>
        </div>

        {/* MENÚ DE 3 PUNTOS */}
        <div className="relative flex items-center shrink-0">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={handleToggleMenu}
            className={`p-1.5 sm:p-2 rounded-full border transition-all cursor-pointer outline-none ${
              showMenu 
                ? 'bg-brand-primary text-black border-brand-primary shadow-lg' 
                : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white border-white/5'
            }`}
            title="Opciones de la canción"
          >
            <MoreVertical size={16} className="md:w-4 md:h-4" />
          </button>
        </div>

      </div>

      {/* PORTAL DEL MENÚ DESPLEGABLE (EVITA CLIPPING POR OVERFLOW-HIDDEN O BORDES) */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showMenu && menuPlacement && (
            menuPlacement.isMobile ? (
              <div className="fixed inset-0 z-[600] flex flex-col justify-end">
                {/* Backdrop */}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeMenu();
                  }}
                />
                {/* Bottom Sheet */}
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
                  
                  {/* Cabecera de la pista */}
                  <div className="px-5 pb-3 flex items-center gap-3 border-b border-white/5 shrink-0">
                    <img
                      src={resolvedCoverUrl || song.coverUrl || DEFAULT_COVER}
                      alt={song.title}
                      className="w-11 h-11 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-white truncate">{song.title}</h4>
                      <p className="text-xs text-white/50 truncate font-medium mt-0.5">{song.artist}</p>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="overflow-y-auto px-3 py-2 space-y-1 overscroll-contain">
                    {renderMenuActions(true)}
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="fixed inset-0 z-[550]">
                {/* Backdrop invisible para cerrar al hacer clic fuera */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeMenu();
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
                    width: '260px',
                  }}
                  className="bg-[#161616]/95 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-y-auto z-[551] shadow-2xl p-1.5 text-xs select-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderMenuActions(false)}
                </motion.div>
              </div>
            )
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};
