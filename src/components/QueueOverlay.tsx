import React from 'react';
import { motion, Reorder, useDragControls } from 'motion/react';
import { X, ListMusic, Play, Disc, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { type Song } from '../constants';

interface QueueOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  queue: Song[];
  currentSong: Song | null;
  onPlayFromQueue: (song: Song) => void;
  onReorderQueue: (queue: Song[]) => void;
  isShuffle: boolean;
  activeTheme: string;
}

interface QueueItemProps {
  song: Song;
  idx: number;
  total: number;
  onPlay: () => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
}

// Componente individual con soporte de arrastre por puntero (invulnerable a bloqueos de Tauri)
const QueueItem: React.FC<QueueItemProps> = ({ song, idx, total, onPlay, onMove }) => {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="div"
      key={song.id}
      value={song}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ 
        scale: 1.02, 
        boxShadow: "0 20px 30px rgba(0, 0, 0, 0.7)",
        zIndex: 50
      }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className="group relative flex items-center gap-3 p-3 rounded-2xl border border-transparent hover:border-white/5 hover:bg-white/5 bg-[#121212]/60 select-none transition-colors"
    >
      {/* Controles de movimiento: Drag Handle táctil/ratón + Flechas de clic rápido */}
      <div className="flex items-center gap-1 shrink-0">
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="text-white/20 hover:text-white/60 active:text-brand-primary transition-colors p-1.5 cursor-grab active:cursor-grabbing touch-none"
          title="Arrastra para reordenar"
        >
          <GripVertical size={18} />
        </div>
        
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            disabled={idx === 0}
            onClick={(e) => { e.stopPropagation(); onMove(idx, 'up'); }}
            className="text-white/30 hover:text-white disabled:opacity-0 cursor-pointer p-0.5 outline-none"
            title="Mover arriba"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            disabled={idx === total - 1}
            onClick={(e) => { e.stopPropagation(); onMove(idx, 'down'); }}
            className="text-white/30 hover:text-white disabled:opacity-0 cursor-pointer p-0.5 outline-none"
            title="Mover abajo"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* Cover */}
      <div 
        onClick={onPlay} 
        className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/5 cursor-pointer"
      >
        <img
          src={song.coverUrl || '/default-cover.jpg'}
          className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none"
          alt=""
          draggable={false}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
          <Play size={16} fill="white" className="text-white" />
        </div>
      </div>

      {/* Song Info */}
      <div 
        onClick={onPlay} 
        className="overflow-hidden flex-1 cursor-pointer"
      >
        <p className="text-sm font-bold text-white truncate group-hover:text-brand-primary transition-colors">
          {song.title}
        </p>
        <p className="text-[10px] font-bold uppercase text-white/30 tracking-wider truncate">
          {song.artist}
        </p>
      </div>

      {/* Position */}
      <div className="text-[10px] font-bold font-mono text-white/10 group-hover:text-white/20 shrink-0 pointer-events-none">
        #{(idx + 1).toString().padStart(2, '0')}
      </div>
    </Reorder.Item>
  );
};

export const QueueOverlay: React.FC<QueueOverlayProps> = ({
  isOpen,
  onClose,
  queue,
  currentSong,
  onPlayFromQueue,
  onReorderQueue,
  isShuffle,
  activeTheme
}) => {
  if (!isOpen) return null;

  const currentIndex = queue.findIndex(s => s.id === currentSong?.id);
  const upcoming = currentIndex !== -1 ? queue.slice(currentIndex + 1) : queue;

  const handleReorderUpcoming = (newUpcoming: Song[]) => {
    const reorderedQueue = [
      ...queue.slice(0, currentIndex + 1),
      ...newUpcoming
    ];
    onReorderQueue(reorderedQueue);
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= upcoming.length) return;

    const reorderedUpcoming = [...upcoming];
    const [movedSong] = reorderedUpcoming.splice(index, 1);
    reorderedUpcoming.splice(targetIndex, 0, movedSong);

    handleReorderUpcoming(reorderedUpcoming);
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed top-0 right-0 bottom-0 w-full max-w-md z-[500] bg-[#080808]/90 backdrop-blur-3xl border-l border-white/5 flex flex-col shadow-2xl select-none"
    >
      {/* Header */}
      <div className="h-24 flex items-center justify-between px-8 border-b border-white/5">
        <div className="flex items-center gap-3">
          <ListMusic className="text-brand-primary" size={20} />
          <h2 className="text-lg font-bold uppercase tracking-[0.2em] text-white">
            Play Queue
          </h2>
        </div>

        <button
          onClick={onClose}
          className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-all cursor-pointer outline-none"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">

        {/* Currently Playing Section */}
        <div className="mb-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-primary mb-4 ml-2">
            Now Playing
          </p>

          {currentSong && (
            <div className="flex items-center gap-4 p-3 bg-white/5 rounded-2xl border border-brand-primary/20 shadow-[0_0_30px_rgba(99,102,241,0.1)]">
              <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-lg">
                <img
                  src={currentSong.coverUrl || '/default-cover.jpg'}
                  className="w-full h-full object-cover pointer-events-none"
                  alt=""
                  draggable={false}
                />
              </div>

              <div className="overflow-hidden">
                <p className="text-sm font-bold text-white truncate">
                  {currentSong.title}
                </p>

                <p className="text-[10px] font-bold uppercase text-white/40 tracking-wider truncate">
                  {currentSong.artist}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Up Next Section */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/20 mb-4 ml-2">
            Up Next
          </p>

          {upcoming.length > 0 ? (
            /* Lista Reordenable con Motion (Pointer Events nativos) */
            <Reorder.Group
              as="div"
              axis="y"
              values={upcoming}
              onReorder={handleReorderUpcoming}
              className="space-y-2"
            >
              {upcoming.map((song, idx) => (
                <QueueItem
                  key={song.id}
                  song={song}
                  idx={idx}
                  total={upcoming.length}
                  onPlay={() => onPlayFromQueue(song)}
                  onMove={handleMove}
                />
              ))}
            </Reorder.Group>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center opacity-20 grayscale">
              <div className="relative">
                <Disc size={40} className="mb-3 animate-spin-slow" />
              </div>

              <p className="text-[10px] font-bold uppercase tracking-widest">
                End of Queue
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 bg-black/40 border-t border-white/5 text-center">
        <p className="text-[8px] font-bold uppercase text-white/10 tracking-[0.4em]">
          AURA Queue Engine v2.0 · Powered by Motion
        </p>
      </div>
    </motion.div>
  );
};