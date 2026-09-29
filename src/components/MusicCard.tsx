import React, { useState } from 'react';
import { 
  Play, Pause, ListPlus, Guitar, Trash2, 
  Edit2, ListMusic, Heart, MoreVertical, Youtube, Check 
} from 'lucide-react';
import { type Song } from '../constants';
import { hapticImpact } from '../utils/haptics';

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
  /** Si estamos en una sesión colaborativa, muestra "Proponer para votación". */
  onClick: () => void;

  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  isDragging?: boolean;
}

export const MusicCard: React.FC<MusicCardProps> = ({ 
  song, isActive, isPlaying, playlists = [], userRole, isLiked, onToggleLike,
  onAddToPlaylist, onRemoveFromPlaylist, onOpenTabs, onDelete, onPlayNext, onAddToQueue, onEdit, onClick, onDragStart,
  onDragOver, onDrop, isDragging
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);

  // Feedback visual al añadir a la cola o reproducir siguiente
  const [addedToQueue, setAddedToQueue] = useState(false);
  const [playedNext, setPlayedNext] = useState(false);

  // La portada aparece con un fundido suave en vez de "reventar" de golpe
  // en cuanto llega. El fondo (bg-white/5) ya hace de placeholder mientras
  // tanto, así que esto no cambia el aspecto final, solo cómo se presenta
  // la carátula mientras carga.
  const [coverLoaded, setCoverLoaded] = useState(false);

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
      className={`group relative p-5 md:p-4 rounded-[32px] md:rounded-3xl transition-all duration-300 flex flex-col justify-between ${
        isDragging
          ? 'opacity-30 scale-95'
          : isActive
            ? 'bg-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]'
            : 'bg-white/5 hover:bg-white/[0.08]'
      } ${
        onDragStart ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* PORTADA LIMPIA */}
      <div onClick={onClick} className="relative aspect-square rounded-[24px] md:rounded-2xl overflow-hidden mb-4 cursor-pointer shrink-0 bg-white/5">
        <img
          src={song.coverUrl || '/default-cover.jpg'}
          className={`w-full h-full object-cover transition-transform duration-700 ${isActive && isPlaying ? 'scale-110' : 'md:group-hover:scale-105'} ${coverLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          alt={song.title}
          draggable={false}
          onLoad={() => setCoverLoaded(true)}
        />
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'}`}>
          {isPlaying && isActive ? <Pause size={48} fill="white" className="md:w-8 md:h-8 text-white" /> : <Play size={48} fill="white" className="ml-1.5 md:w-8 md:h-8 md:ml-1 text-white" />}
        </div>
      </div>

      {/* FILA INFERIOR: INFORMACIÓN + BOTÓN DE 3 PUNTOS */}
      <div className="flex items-end justify-between gap-3 min-w-0 w-full pt-1">
        
        {/* TÍTULO Y ARTISTA */}
        <div className="min-w-0 flex-1 space-y-1 md:space-y-0.5">
          <h3 className="text-lg md:text-sm font-bold text-white truncate leading-tight tracking-tight" title={song.title}>
            {song.title}
          </h3>
          <p className="text-sm md:text-[10px] text-white/40 uppercase font-black tracking-widest truncate" title={song.artist}>
            {song.artist}
          </p>
        </div>

        {/* MENÚ DE 3 PUNTOS */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
              setShowPlaylistSubmenu(false);
            }}
            className={`p-2.5 md:p-2 rounded-full border transition-all cursor-pointer outline-none ${
              showMenu 
                ? 'bg-brand-primary text-black border-brand-primary shadow-lg' 
                : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white border-white/5'
            }`}
            title="Opciones de la canción"
          >
            <MoreVertical size={18} className="md:w-4 md:h-4" />
          </button>

          {/* DESPLEGABLE CON TODAS LAS ACCIONES */}
          {showMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  setShowPlaylistSubmenu(false);
                }} 
              />

              <div 
                className="absolute bottom-full right-0 mb-2 w-64 bg-[#161616]/95 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden z-50 shadow-2xl p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 1. LIKE / FAVORITOS */}
                <button
                  type="button"
                  onClick={() => { hapticImpact('light'); onToggleLike(); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left"
                >
                  <Heart size={15} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "text-red-500" : ""} />
                  <span>{isLiked ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}</span>
                </button>

                {/* 2. VER TABS / ACORDES (Abre Songsterr en el navegador del sistema) */}
                <button
                  type="button"
                  onClick={() => { 
                    setShowMenu(false);
                    const tabsUrl = (song as any).tabs_url;
                    if (tabsUrl && tabsUrl.trim()) {
                      openExternalLink(tabsUrl);
                    } else {
                      onOpenTabs();
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer text-left ${
                    hasTabs ? 'text-white/70 hover:text-brand-primary hover:bg-white/10' : 'text-white/30 hover:text-white/50 hover:bg-white/5'
                  }`}
                >
                  <Guitar size={15} />
                  <span>{hasTabs ? 'Ver Acordes / Tabs' : 'Sin acordes / tabs'}</span>
                </button>

                {/* 3. VÍDEO OFICIAL YOUTUBE (Abre el vídeo en el navegador del sistema) */}
                <button
                  type="button"
                  onClick={() => { setShowMenu(false); handleOpenVideo(); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer text-left ${
                    hasVideo ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' : 'text-white/30 hover:text-white/50 hover:bg-white/5'
                  }`}
                >
                  <Youtube size={15} />
                  <span>{hasVideo ? 'Vídeo Oficial (YouTube)' : 'Sin vídeo oficial'}</span>
                </button>

                {/* 4. REPRODUCIR SIGUIENTE */}
                <button
                  type="button"
                  onClick={(e) => {
                    handlePlayNextClick(e);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left"
                >
                  {playedNext ? <Check size={15} className="text-green-400" /> : <ListMusic size={15} />}
                  <span>{playedNext ? '¡Se reproducirá siguiente!' : 'Reproducir siguiente'}</span>
                </button>

                {/* 5. AÑADIR A LA COLA */}
                <button
                  type="button"
                  onClick={(e) => { 
                    handleQueueClick(e);
                    setShowMenu(false); 
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left"
                >
                  {addedToQueue ? <Check size={15} className="text-green-400" /> : <ListPlus size={15} />}
                  <span>{addedToQueue ? '¡Añadida a la cola!' : 'Añadir a la cola'}</span>
                </button>

                {/* 6. AÑADIR A PLAYLIST */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPlaylistSubmenu(!showPlaylistSubmenu)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ListPlus size={15} />
                      <span>Añadir a Playlist</span>
                    </div>
                    <span className="text-[10px] text-white/30">{showPlaylistSubmenu ? '▲' : '▼'}</span>
                  </button>

                  {showPlaylistSubmenu && (
                    <div className="max-h-36 overflow-y-auto pl-8 pr-2 py-1 space-y-1 bg-black/40 rounded-xl my-1 border border-white/5">
                      {playlists.length > 0 ? (
                        playlists.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              onAddToPlaylist(p.id.toString());
                              setShowMenu(false);
                              setShowPlaylistSubmenu(false);
                            }}
                            className="w-full text-left py-1.5 px-2 text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer truncate"
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
                    onClick={() => { onRemoveFromPlaylist(); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer text-left border-t border-white/5 mt-1"
                  >
                    <Trash2 size={15} />
                    <span>Quitar de esta lista</span>
                  </button>
                )}

                {/* 8. OPCIONES DE ADMINISTRACIÓN */}
                {(userRole === 'admin' || userRole === 'moderator') && (
                  <button
                    type="button"
                    onClick={() => { onEdit(); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-left border-t border-white/5 mt-1"
                  >
                    <Edit2 size={15} />
                    <span>Editar metadatos</span>
                  </button>
                )}

                {userRole === 'admin' && (
                  <button
                    type="button"
                    onClick={() => { hapticImpact('heavy'); onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                  >
                    <Trash2 size={15} />
                    <span>Eliminar canción</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
};