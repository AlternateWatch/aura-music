import React, { useState } from 'react';
import { Play, Pause, ListPlus, Guitar, Trash2, SquarePlay, Edit2, ListMusic, Heart } from 'lucide-react';
import { type Song } from '../constants';

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
  onClick: () => void;

  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  isDragging?: boolean;
}

export const MusicCard: React.FC<MusicCardProps> = ({ 
  song, isActive, isPlaying, playlists = [], userRole, isLiked, onToggleLike,
  onAddToPlaylist, onRemoveFromPlaylist, onOpenTabs, onDelete, onPlayNext, onAddToQueue, onEdit, onClick, onDragStart,
onDragOver,
onDrop,
isDragging
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

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
  className={`group relative p-6 md:p-4 rounded-[40px] md:rounded-3xl transition-all duration-300 ${
    isDragging
      ? 'opacity-30 scale-95'
      : isActive
        ? 'bg-white/10'
        : 'bg-white/5 hover:bg-white/[0.08]'
  } ${
    onDragStart
      ? 'cursor-grab active:cursor-grabbing'
      : ''
  }`}
>
      
      {/* ELIMINAR - TOP RIGHT (Escalado móvil) */}
      {userRole === 'admin' && (
          <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="absolute top-8 right-8 md:top-6 md:right-6 z-30 p-4 md:p-2 rounded-full bg-black/60 backdrop-blur-md text-white/40 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all border border-white/10 shadow-xl"
          >
              <Trash2 size={24} className="md:w-3.5 md:h-3.5" />
          </button>
      )}

      {/* CLUSTER ACCIONES - TOP LEFT */}
      <div className="absolute top-8 left-8 md:top-6 md:left-6 z-30 flex gap-4 md:gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all">
          {(userRole === 'admin' || userRole === 'moderator') && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-4 md:p-2 rounded-full bg-black/60 backdrop-blur-md text-white/40 hover:text-white border border-white/10 shadow-xl"><Edit2 size={24} className="md:w-3.5 md:h-3.5" /></button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onPlayNext(); }} className="p-4 md:p-2 rounded-full bg-black/60 backdrop-blur-md text-white/40 hover:text-white border border-white/10 shadow-xl"><SquarePlay size={24} className="md:w-3.5 md:h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); onAddToQueue(); }} className="p-4 md:p-2 rounded-full bg-black/60 backdrop-blur-md text-white/40 hover:text-white border border-white/10 shadow-xl"><ListMusic size={24} className="md:w-3.5 md:h-3.5" /></button>
      </div>

      {/* PORTADA (Grande y táctil) */}
      <div onClick={onClick} className="relative aspect-square rounded-[32px] md:rounded-2xl overflow-hidden mb-8 md:mb-4 cursor-pointer">
        <img src={song.coverUrl || '/default-cover.jpg'} className={`w-full h-full object-cover transition-transform duration-700 ${isActive && isPlaying ? 'scale-110' : 'md:group-hover:scale-105'}`} alt={song.title} />
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'}`}>
          {isPlaying && isActive ? <Pause size={64} fill="white" className="md:w-8 md:h-8" /> : <Play size={64} fill="white" className="ml-2 md:w-8 md:h-8 md:ml-1" />}
        </div>
      </div>

      {/* INFO - TEXTOS GRANDES */}
      <div className="pr-12 space-y-3 md:space-y-1">
        <h3 className="text-2xl md:text-sm font-bold text-white truncate leading-tight tracking-tight">{song.title}</h3>
        <p className="text-lg md:text-[10px] text-white/40 uppercase font-black tracking-widest truncate">{song.artist}</p>
      </div>

      {/* ACCIONES INFERIORES */}
<div className="absolute bottom-6 right-6 md:bottom-4 md:right-4 flex gap-4 md:gap-2">

  {/* QUITAR DE PLAYLIST */}
  {onRemoveFromPlaylist && (
    <button
        onClick={(e) => {
            e.stopPropagation();
            onRemoveFromPlaylist();
        }}
        className="p-4 md:p-2 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500/60 hover:text-red-500 transition-all border border-red-500/10"
        title="Remove from playlist"
    >
        <Trash2 size={24} className="md:w-4 md:h-4" />
    </button>
)}
  {/* BOTÓN LIKE */}
  <button
    onClick={(e) => { e.stopPropagation(); onToggleLike(); }}
    className={`p-4 md:p-2 rounded-full border border-white/5 transition-all hover:scale-110 ${isLiked ? 'bg-red-500/20 text-red-500 border-red-500/20' : 'bg-white/5 text-white/20 hover:text-white/40'}`}
  >
    <Heart size={24} fill={isLiked ? "currentColor" : "none"} className="md:w-4 md:h-4" />
  </button>

        <button onClick={(e) => { e.stopPropagation(); onOpenTabs(); }} className="p-4 md:p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-brand-primary transition-all border border-white/5"><Guitar size={24} className="md:w-4 md:h-4" /></button>
        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setShowDropdown(!showDropdown); }} className={`p-4 md:p-2 rounded-full transition-all border border-white/5 ${showDropdown ? 'bg-white/20 text-white border-white/20' : 'bg-white/5 hover:bg-white/10 text-white/40 hover:text-white'}`}><ListPlus size={24} className="md:w-4 md:h-4" /></button>
          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute bottom-full right-0 mb-4 w-72 md:w-48 bg-[#1a1a1a] border border-white/10 rounded-[24px] md:rounded-xl overflow-hidden z-50 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                <p className="px-6 py-4 md:px-4 md:py-2 text-xs md:text-[8px] font-bold text-white/20 uppercase tracking-widest border-b border-white/5 bg-black/20 text-center">Add to Playlist</p>
                <div className="max-h-80 md:max-h-48 overflow-y-auto">
                    {playlists.map(p => (
                        <button key={p.id} onClick={(e) => { e.stopPropagation(); onAddToPlaylist(p.id.toString()); setShowDropdown(false); }} className="w-full text-left px-6 py-5 md:px-4 md:py-3 text-base md:text-[10px] font-bold text-white/60 hover:text-white hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">{p.name}</button>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};