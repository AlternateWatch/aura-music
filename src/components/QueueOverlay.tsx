
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, ListMusic, Play, Disc, GripVertical } from 'lucide-react';
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
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [dragOverSongId, setDragOverSongId] = useState<string | null>(null);

  if (!isOpen) return null;

  // The 'queue' passed here is either the linear list
  // or the pre-shuffled list from App.tsx.
  const currentIndex = queue.findIndex(s => s.id === currentSong?.id);

  // Show everything after the current song in the sequence.
  const upcoming = currentIndex !== -1 ? queue.slice(currentIndex + 1) : queue;

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    songId: string
  ) => {
    setDraggedSongId(songId);

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', songId);

    // Makes the dragged item slightly transparent.
    setTimeout(() => {
      const element = e.currentTarget;
      element.classList.add('opacity-40');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('opacity-40');

    setDraggedSongId(null);
    setDragOverSongId(null);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    songId: string
  ) => {
    e.preventDefault();

    if (!draggedSongId || draggedSongId === songId) return;

    e.dataTransfer.dropEffect = 'move';
    setDragOverSongId(songId);
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetSongId: string
  ) => {
    e.preventDefault();

    const sourceSongId = e.dataTransfer.getData('text/plain');

    if (!sourceSongId || sourceSongId === targetSongId) {
      setDraggedSongId(null);
      setDragOverSongId(null);
      return;
    }

    const sourceIndex = upcoming.findIndex(s => s.id === sourceSongId);
    const targetIndex = upcoming.findIndex(s => s.id === targetSongId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedSongId(null);
      setDragOverSongId(null);
      return;
    }

    // Reorder ONLY the upcoming songs.
    const reorderedUpcoming = [...upcoming];
    const [movedSong] = reorderedUpcoming.splice(sourceIndex, 1);
    reorderedUpcoming.splice(targetIndex, 0, movedSong);

    // Keep everything before/current exactly where it was.
    const reorderedQueue = [
      ...queue.slice(0, currentIndex + 1),
      ...reorderedUpcoming
    ];

    onReorderQueue(reorderedQueue);

    setDraggedSongId(null);
    setDragOverSongId(null);
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed top-0 right-0 bottom-0 w-full max-w-md z-[500] bg-[#080808]/90 backdrop-blur-3xl border-l border-white/5 flex flex-col shadow-2xl"
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
          className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-all"
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
                  className="w-full h-full object-cover"
                  alt=""
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

          <div className="space-y-2">
            {upcoming.length > 0 ? (
              upcoming.map((song, idx) => {
                const isDragged = draggedSongId === song.id;
                const isDragOver = dragOverSongId === song.id;

                return (
                  <div
                    key={song.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, song.id)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, song.id)}
                    onDragLeave={() => {
                      if (dragOverSongId === song.id) {
                        setDragOverSongId(null);
                      }
                    }}
                    onDrop={(e) => handleDrop(e, song.id)}
                    onClick={() => {
                      // Don't accidentally play a song after dragging it.
                      if (draggedSongId) return;

                      onPlayFromQueue(song);
                    }}
                    className={`
                      group relative flex items-center gap-3 p-3
                      rounded-2xl transition-all cursor-grab
                      active:cursor-grabbing
                      border
                      ${isDragOver
                        ? 'border-brand-primary/60 bg-brand-primary/10'
                        : 'border-transparent hover:border-white/5 hover:bg-white/5'
                      }
                      ${isDragged ? 'opacity-40' : ''}
                    `}
                  >
                    {/* Drop indicator */}
                    {isDragOver && (
                      <div className="absolute -top-1 left-4 right-4 h-0.5 bg-brand-primary rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
                    )}

                    {/* Drag Handle */}
                    <div className="shrink-0 text-white/10 group-hover:text-white/30 transition-colors">
                      <GripVertical size={16} />
                    </div>

                    {/* Cover */}
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/5">
                      <img
                        src={song.coverUrl || '/default-cover.jpg'}
                        className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                        alt=""
                      />

                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                        <Play
                          size={16}
                          fill="white"
                          className="text-white"
                        />
                      </div>
                    </div>

                    {/* Song Info */}
                    <div className="overflow-hidden flex-1">
                      <p className="text-sm font-bold text-white truncate group-hover:text-brand-primary transition-colors">
                        {song.title}
                      </p>

                      <p className="text-[10px] font-bold uppercase text-white/30 tracking-wider truncate">
                        {song.artist}
                      </p>
                    </div>

                    {/* Position */}
                    <div className="text-[10px] font-bold font-mono text-white/10 group-hover:text-white/20 shrink-0">
                      #{(idx + 1).toString().padStart(2, '0')}
                    </div>
                  </div>
                );
              })
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
      </div>

      <div className="p-6 bg-black/40 border-t border-white/5 text-center">
        <p className="text-[8px] font-bold uppercase text-white/10 tracking-[0.4em]">
          AURA Queue Engine v1.1
        </p>
      </div>
    </motion.div>
  );
};
