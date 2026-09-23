import React, { useEffect, useState, useRef } from 'react';
import { useAudioPlaybackTime } from '../hooks/useAudioEngine';
import { motion, AnimatePresence } from 'motion/react';
import { X, Music2, Loader2 } from 'lucide-react';
import { type Song } from '../constants';

interface LyricsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentSong: Song | null;
  currentTime: number;
  onSeek: (time: number) => void;
  getCurrentTime: () => number;subscribeToTime: (listener: () => void) => () => void;
}

interface LyricLine {
  time: number;
  text: string;
}

export const LyricsOverlay: React.FC<LyricsOverlayProps> = ({ 
  isOpen, onClose, currentSong, currentTime, onSeek, getCurrentTime, subscribeToTime
}) => {

  const liveCurrentTime = useAudioPlaybackTime(
  getCurrentTime,
  subscribeToTime
);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // --- IMPROVED AGGRESSIVE SANITIZATION ---
  const sanitizeText = (text: string) => {
    if (!text) return "";
    return text
      // 1. Replace all known Unicode "Smart" apostrophes and accents
      .replace(/[\u2018\u2019\u02bc\u02bb\u00ff\ufffd\u00b4\u02b9\u02ba]/g, "'")
      // 2. Replace all known Unicode "Smart" quotes
      .replace(/[\u201c\u201d\u201f\u201e]/g, '"')
      // 3. Replace non-breaking spaces
      .replace(/\u00a0/g, " ")
      // 4. FIX: Specifically target the "I?d" or "You?ve" pattern 
      // This catches '?' sitting between two word characters and replaces it with an apostrophe
      .replace(/(\w)\?(\s?\w)/g, "$1'$2")
      .trim();
  };

  useEffect(() => {
    if (!isOpen || !currentSong) return;

    const fetchLyrics = async () => {
      setIsLoading(true);
      setError(null);
      setLyrics([]);

      try {
        const response = await fetch(
          `https://lrclib.net/api/get?artist_name=${encodeURIComponent(currentSong.artist)}&track_name=${encodeURIComponent(currentSong.title)}&album_name=${encodeURIComponent(currentSong.album || '')}`
        );
        const data = await response.json();

        if (data.syncedLyrics) {
          parseLRC(data.syncedLyrics);
        } else if (data.plainLyrics) {
          setLyrics([{ time: 0, text: sanitizeText(data.plainLyrics) }]);
        } else {
          setError("Lyrics not found.");
        }
      } catch (err) {
        setError("Could not load lyrics.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLyrics();
  }, [currentSong?.id, isOpen]);

  const parseLRC = (lrcContent: string) => {
    const lines = lrcContent.split('\n');
    const parsed: LyricLine[] = [];
    const timeRegex = /\[(\d+):(\d+\.\d+)\]/;

    lines.forEach(line => {
      const match = timeRegex.exec(line);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseFloat(match[2]);
        const time = minutes * 60 + seconds;
        const rawText = line.replace(timeRegex, '').trim();
        
        // Apply improved sanitization
        const text = sanitizeText(rawText);
        
        if (text) parsed.push({ time, text });
      }
    });
    setLyrics(parsed);
  };

  useEffect(() => {
  if (activeLineRef.current && scrollContainerRef.current) {
    activeLineRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
}, [liveCurrentTime, lyrics]);
  if (!isOpen) return null;

  const activeIndex = lyrics.reduce((prev, curr, idx) => {
    return curr.time <= liveCurrentTime ? idx : prev;
  }, -1);

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-2xl flex flex-col font-sans"
    >
      {/* Header */}
      <div className="h-24 flex items-center justify-between px-10 shrink-0 border-b border-white/5">
        <div className="flex items-center gap-6">
          <img 
            src={currentSong?.coverUrl || '/default-cover.jpg'} 
            className="w-12 h-12 rounded-lg shadow-2xl border border-white/10" 
            alt="" 
          />
          <div>
            <h2 className="text-xl font-bold text-white tracking-tighter uppercase font-serif italic">{currentSong?.title}</h2>
            <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">{currentSong?.artist}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white">
          <X size={24} />
        </button>
      </div>

      {/* Lyrics Container */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-10 py-40 flex flex-col items-center scrollbar-hide"
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-4 opacity-20">
            <Loader2 className="animate-spin" size={32} />
            <p className="text-[10px] font-bold uppercase tracking-widest">Searching Soundscape...</p>
          </div>
        ) : error ? (
          <div className="text-center opacity-30">
            <Music2 size={48} className="mx-auto mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">{error}</p>
          </div>
        ) : (
          <div className="w-full max-w-4xl space-y-12">
            {lyrics.map((line, index) => {
              const isActive = index === activeIndex;
              const isPast = index < activeIndex;

              return (
                <div
                  key={index}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => onSeek(line.time)}
                  className={`
                    cursor-pointer transition-all duration-700 ease-out text-center
                    ${isActive ? 'text-white scale-110' : isPast ? 'text-white/20' : 'text-white/40 hover:text-white/60'}
                  `}
                >
                  <p className={`
                    text-3xl md:text-5xl font-bold tracking-tighter leading-tight
                    ${isActive ? 'font-black opacity-100 blur-none' : 'opacity-100 blur-[1px]'}
                  `}>
                    {line.text}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};