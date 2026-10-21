import { getResponsiveCoverSrcSet, DEFAULT_COVER } from '../utils/api';
import React, { useRef, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { motion } from 'motion/react';
import { 
  X, Play, Pause, SkipBack, SkipForward, 
  Shuffle, Repeat, ChevronDown, Music2,
  Volume2, Mic2, ListMusic, VolumeX, Volume1, SlidersHorizontal
} from 'lucide-react';
import { type Song } from '../constants';
import { useAudioPlaybackTime } from "../hooks/useAudioEngine";
import { useFileUrl } from "../hooks/useFileUrl";
import { hapticImpact } from "../utils/haptics";
import type { AudioSettings } from "../audio/audioSettings";

interface FullPlayerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentSong: Song | null;
  animatedCoverUrl?: string | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  liveCurrentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  getCurrentTime: () => number;
  subscribeToTime: (listener: () => void) => () => void;
  volume: number;
  onVolumeChange: (val: number) => void;
  isShuffle: boolean;
  isLoop: boolean;
  onToggleShuffle: () => void;
  onToggleLoop: () => void;
  onToggleLyrics: () => void;
  onToggleQueue: () => void;
  onOpenAudioSettings: () => void;
  activeTheme: string;
  onOpenMinigameLobby: () => void;
  ambientGlow?: 'off' | 'soft' | 'vibrant';
  ambientGlowColor?: string;
  audioSettings?: AudioSettings;
}

const isVideoUrl = (url?: string | null) => {
  if (!url) return false;
  return /\.(mp4|webm|mov|mkv)($|\?)/i.test(url);
};

const resolveMediaUrl = (url?: string | null): string | undefined => {
  if (!url) return undefined;

  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('firestore-file://')
  ) {
    return url;
  }

  if (url.startsWith('/uploads/')) {
    return `https://aura.basildo.me${url}`;
  }

  return url;
};

export const FullPlayerOverlay: React.FC<FullPlayerOverlayProps> = (props) => {
  const {
  isOpen,
  onClose,
  currentSong,
  animatedCoverUrl,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrevious,
  duration,
  onSeek,
  volume,
  onVolumeChange,
  isShuffle,
  isLoop,
  onToggleShuffle,
  onToggleLoop,
  onToggleLyrics,
  onToggleQueue,
  onOpenAudioSettings,
  activeTheme,
  onOpenMinigameLobby,
  getCurrentTime,
  subscribeToTime,
  ambientGlow,
  ambientGlowColor,
  audioSettings,
} = props;

  const hexToRgba = (hex: string, alpha: number) => {
    let c = (hex || '#6366f1').replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return 'rgba(99, 102, 241, ' + alpha + ')';
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  };

  const glowSetting = ambientGlow ?? (typeof window !== 'undefined' ? ((localStorage.getItem('aura_ambient_glow') as any) || 'soft') : 'soft');
  const glowColor = ambientGlowColor ?? (typeof window !== 'undefined' ? (localStorage.getItem('aura_ambient_glow_color') || '#6366f1') : '#6366f1');

const liveCurrentTime = useAudioPlaybackTime(
  getCurrentTime,
  subscribeToTime
);
const resolvedCoverUrl = useFileUrl(currentSong?.coverUrl);

  const coverTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [coverSwipeOffset, setCoverSwipeOffset] = useState(0);
  const animatedVideoRef = useRef<HTMLVideoElement>(null);

  const handleCoverTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    coverTouchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  };

  const handleCoverTouchMove = (e: React.TouchEvent) => {
    if (!coverTouchRef.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - coverTouchRef.current.x;
    const deltaY = touch.clientY - coverTouchRef.current.y;
    // Si es predominantemente horizontal, desplazamos la portada sutilmente
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) < 140) {
      setCoverSwipeOffset(deltaX * 0.45);
    }
  };

  const handleCoverTouchEnd = (e: React.TouchEvent) => {
    if (!coverTouchRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - coverTouchRef.current.x;
    const deltaY = touch.clientY - coverTouchRef.current.y;
    const deltaTime = Date.now() - coverTouchRef.current.time;
    coverTouchRef.current = null;
    setCoverSwipeOffset(0);

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Gesto hacia abajo: cerrar reproductor a pantalla completa
    if (deltaY > 60 && absY > absX * 1.1 && deltaTime < 600) {
      hapticImpact("light");
      onClose();
      return;
    }

    // Gesto horizontal: cambiar canción
    if (absX > 50 && absX > absY * 1.1 && deltaTime < 600) {
      if (deltaX < 0) {
        hapticImpact("medium");
        onNext();
      } else {
        hapticImpact("medium");
        onPrevious();
      }
    }
  };

  const headerTouchRef = useRef<{ y: number; time: number } | null>(null);
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    headerTouchRef.current = { y: e.touches[0].clientY, time: Date.now() };
  };
  const handleHeaderTouchEnd = (e: React.TouchEvent) => {
    if (!headerTouchRef.current) return;
    const deltaY = e.changedTouches[0].clientY - headerTouchRef.current.y;
    const deltaTime = Date.now() - headerTouchRef.current.time;
    headerTouchRef.current = null;
    if (deltaY > 40 && deltaTime < 600) {
      hapticImpact("light");
      onClose();
    }
  };

  if (!isOpen || !currentSong) return null;

  const progress = (liveCurrentTime / (duration || 1)) * 100;

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time < 0) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const animUrl = resolveMediaUrl(
    animatedCoverUrl ||
    (currentSong as any)?.animated_cover_path ||
    (currentSong as any)?.animatedCoverUrl
  );
  const isNative = Capacitor.isNativePlatform();
  const isVideo = !isNative && (isVideoUrl(animUrl) || isVideoUrl((currentSong as any)?.animated_cover_path));
  const coverSrc = resolvedCoverUrl || resolveMediaUrl(currentSong.coverUrl) || DEFAULT_COVER;

  const [videoError, setVideoError] = useState(false);
  useEffect(() => {
    setVideoError(false);
  }, [currentSong?.id, animUrl]);

  useEffect(() => {
    if (isVideo && !videoError && animatedVideoRef.current) {
      animatedVideoRef.current.muted = true;
      animatedVideoRef.current.play().catch(() => {});
    }
  }, [animUrl, isVideo, videoError]);

  return (
    <motion.div 
      initial={{ y: '100%' }} 
      animate={{ y: 0 }} 
      exit={{ y: '100%' }} 
      transition={{ type: 'spring', damping: 30, stiffness: 120 }}
      className="fixed inset-0 z-[400] bg-[#050505] overflow-y-auto overflow-x-hidden font-sans no-tap-highlight"
    >
      <style>{`
        .no-tap-highlight * {
          -webkit-tap-highlight-color: transparent !important;
        }
      `}</style>

            {/* Background Ambient Glow */}
      {glowSetting !== 'off' && (
        <div 
          className={`fixed inset-0 pointer-events-none transition-all duration-700 ${
            glowSetting === 'vibrant'
              ? 'opacity-65 blur-[100px]'
              : 'opacity-40 blur-[130px]'
          }`}
          style={{ background: `radial-gradient(circle at 50% 35%, ${hexToRgba(glowColor, glowSetting === 'vibrant' ? 0.45 : 0.35)} 0%, ${hexToRgba(glowColor, glowSetting === 'vibrant' ? 0.20 : 0.12)} 45%, transparent 80%)` }}
        />
      )}

{/* Contenedor principal que fluye completo */}
      <div className="flex flex-col min-h-full w-full relative z-10">
        {/* Mobile Pull-down handle indicator */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-2.5 shrink-0 md:hidden pointer-events-none" />
        
        {/* Header Area */}
        {/* Header Area (deslizar hacia abajo para cerrar) */}
        <div 
          onTouchStart={handleHeaderTouchStart}
          onTouchEnd={handleHeaderTouchEnd}
          className="h-20 md:h-24 flex items-center justify-between px-6 md:px-10 shrink-0 mt-4 md:mt-0 select-none cursor-pointer"
        >
          <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-full transition-all text-white/40 hover:text-white cursor-pointer active:scale-90 outline-none">
            <ChevronDown size={32} className="md:w-9 md:h-9" />
          </button>
          <div className="text-center pointer-events-none flex-1 px-4">
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.5em] text-brand-primary mb-1 truncate">AURA FOCUS ENGINE</p>
              <p className="text-[10px] md:text-xs font-bold text-white/60 uppercase tracking-widest truncate">{currentSong.album || 'Single'}</p>
          </div>
          <button 
            onClick={onOpenMinigameLobby}
            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full hover:bg-brand-primary/10 cursor-pointer group transition-colors shrink-0 outline-none"
            title="Start Recon Minigame"
          >
              <div className="relative w-2 h-2 md:w-3 md:h-3">
                <div className="absolute inset-0 bg-brand-primary rounded-full animate-ping opacity-75" />
                <div className="relative w-full h-full bg-brand-primary rounded-full" style={{ boxShadow: "0 0 15px var(--color-brand-primary, #F27D26)" }} />
              </div>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 md:px-10 w-full py-6 md:py-10">
          <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-8 md:gap-16">
            
            {/* Big Cover Art (SOPORTE PARA SWIPE HORIZONTAL SIGUIENTE/ANTERIOR Y SWIPE DOWN CERRAR) */}
            <motion.div
              onTouchStart={handleCoverTouchStart}
              onTouchMove={handleCoverTouchMove}
              onTouchEnd={handleCoverTouchEnd}
              style={{
                transform: coverSwipeOffset !== 0 ? `translateX(${coverSwipeOffset}px)` : undefined,
                transition: coverSwipeOffset === 0 ? "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
              }}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                scale: isPlaying ? 1 : 0.94,
                rotate: isPlaying ? 0 : -1,
              }}
              transition={{
                opacity: { duration: 0.12 },
                scale: { duration: 0.8, ease: "easeInOut" },
                rotate: { duration: 0.8, ease: "easeInOut" },
              }}
              className="aspect-square w-full max-w-[280px] sm:max-w-[340px] md:max-w-[450px] rounded-[32px] md:rounded-[48px] overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.6)] md:shadow-[0_50px_100px_rgba(0,0,0,0.8)] border border-white/5 relative group shrink-0 bg-black cursor-grab active:cursor-grabbing will-change-transform"
            >
              {animUrl && !videoError ? (
                isVideo ? (
                  <video
                    ref={animatedVideoRef}
                    key={animUrl}
                    src={animUrl}
                    poster={coverSrc}
                    preload="auto"
                    autoPlay
                    loop
                    muted
                    playsInline
                    onError={() => setVideoError(true)}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <img 
                    key={animUrl}
                    src={animUrl} 
                    onError={(e) => {
                      if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                        e.currentTarget.src = DEFAULT_COVER;
                        e.currentTarget.removeAttribute('srcset');
                      }
                    }}
                    className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105 pointer-events-none" 
                    alt={currentSong.title} 
                  />
                )
              ) : (
                <img 
                  src={coverSrc}
                  srcSet={getResponsiveCoverSrcSet(coverSrc)}
                  sizes="(max-width: 768px) 90vw, 600px"
                  decoding="async" 
                  onError={(e) => {
                    if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                      e.currentTarget.src = DEFAULT_COVER;
                      e.currentTarget.removeAttribute('srcset');
                    }
                  }}
                  className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105 pointer-events-none" 
                  alt={currentSong.title} 
                />
              )}
            </motion.div>

            <div className="flex-1 w-full max-w-xl flex flex-col justify-center">
              {/* Song Metadata */}
              <div className="mb-8 md:mb-12 text-center md:text-left">
                <motion.h2 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="text-3xl sm:text-4xl md:text-7xl font-bold text-white tracking-tighter mb-2 md:mb-4 font-serif italic leading-tight truncate">
                  {currentSong.title}
                </motion.h2>
                <p className="text-lg md:text-2xl text-white/40 font-medium tracking-[0.1em] uppercase truncate">
                  {currentSong.artist}
                </p>
              </div>

              {/* Main Progress Controller */}
              <div className="mb-8 md:mb-12">
                <div className="relative w-full h-2 group flex items-center">
                    <div className="absolute inset-0 bg-white/10 rounded-full w-full h-full" />
                    <div className="absolute left-0 h-full bg-white rounded-full transition-all shadow-[0_0_15px_rgba(255,255,255,0.5)] pointer-events-none" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                    <input type="range" min="0" max={duration || 0} step="0.1" value={liveCurrentTime} onChange={(e) => onSeek(parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 outline-none" />
                    <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 bg-white rounded-full shadow-2xl scale-0 group-hover:scale-100 transition-transform pointer-events-none z-10" style={{ left: `calc(${Math.min(100, Math.max(0, progress))}% - 8px)` }} />
                </div>
                <div className="flex justify-between items-center mt-3 md:mt-4 text-[10px] md:text-[11px] font-bold font-mono text-white/40 tracking-widest">
                  <span className="pointer-events-none">{formatTime(liveCurrentTime)}</span>
                  
                  {/* Píldora de velocidad y preset rápido */}
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpact('light');
                      onOpenAudioSettings();
                    }}
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all flex items-center gap-1 cursor-pointer border ${
                      ((audioSettings?.playbackRate?.rate ?? 1.0) !== 1.0 || (audioSettings?.playbackRate?.reverbWet ?? 0) > 0)
                        ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/40 shadow-sm shadow-brand-primary/20'
                        : 'text-white/40 border-white/5 hover:text-white hover:bg-white/5'
                    }`}
                    title="Ajustes de velocidad, Nightcore y Slowed & Reverb"
                  >
                    <span>
                      {audioSettings?.playbackRate?.preset === 'nightcore'
                        ? '⚡ Nightcore'
                        : audioSettings?.playbackRate?.preset === 'slowed'
                        ? '🌙 Slowed'
                        : audioSettings?.playbackRate?.preset === 'speedup'
                        ? '⏩ Speed Up'
                        : (audioSettings?.playbackRate?.rate && audioSettings.playbackRate.rate !== 1.0)
                        ? `${audioSettings.playbackRate.rate.toFixed(2)}x`
                        : '1.0x'}
                    </span>
                  </button>

                  <span className="pointer-events-none">{formatTime(duration)}</span>
                </div>
              </div>

              {/* Playback Controls */}
              <div className="flex items-center justify-between px-2 md:px-4">
                <button onClick={() => { hapticImpact('light'); onToggleShuffle(); }} className={`transition-all cursor-pointer hover:scale-125 active:scale-90 shrink-0 outline-none ${isShuffle ? 'text-brand-primary drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'text-white/30'}`}>
                  <Shuffle size={24} className="md:w-7 md:h-7" />
                </button>

                <div className="flex items-center gap-6 md:gap-10">
                    <button onClick={() => { hapticImpact('light'); onPrevious(); }} className="text-white/60 hover:text-white cursor-pointer hover:scale-110 active:scale-90 transition-all shrink-0 outline-none">
                      <SkipBack size={36} className="md:w-12 md:h-12" fill="currentColor" />
                    </button>
                    <button
                        onClick={() => { hapticImpact('medium'); onTogglePlay(); }}
                        className="w-20 h-20 md:w-28 md:h-28 bg-white cursor-pointer rounded-full flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-all shadow-[0_15px_35px_rgba(255,255,255,0.15)] shrink-0 outline-none"
                    >
                        {isPlaying ? <Pause size={32} className="md:w-11 md:h-11" fill="black" /> : <Play size={32} className="md:w-11 md:h-11 ml-1.5 md:ml-2" fill="black" />}
                    </button>
                    <button onClick={() => { hapticImpact('light'); onNext(); }} className="text-white/60 hover:text-white cursor-pointer hover:scale-110 active:scale-90 transition-all shrink-0 outline-none">
                      <SkipForward size={36} className="md:w-12 md:h-12" fill="currentColor" />
                    </button>
                </div>

                <button onClick={() => { hapticImpact('light'); onToggleLoop(); }} className={`transition-all cursor-pointer hover:scale-125 active:scale-90 shrink-0 outline-none ${isLoop ? 'text-brand-primary drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'text-white/30'}`}>
                  <Repeat size={24} className="md:w-7 md:h-7" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Utility Bar */}
        <div className="h-24 md:h-32 flex items-center justify-between px-6 md:px-20 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-transparent w-full">
              
              <div className="flex items-center gap-3 md:gap-5 shrink-0">
                {/* Botón LYRICS con cuadrado gris */}
                <button onClick={onToggleLyrics} className="flex items-center gap-2 md:gap-3 text-white/40 cursor-pointer hover:text-white transition-all group shrink-0 active:scale-95 outline-none">
                    <div className="p-3 bg-white/5 rounded-xl md:rounded-2xl group-hover:bg-brand-primary group-hover:text-black transition-all">
                        <Mic2 size={18} className="md:w-5 md:h-5" />
                    </div>
                    <span className="hidden sm:inline text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em]">Lyrics</span>
                </button>

                  {/* Botón AUDIO (ecualizador + normalizador) */}
                  <button onClick={onOpenAudioSettings} title="Equalizer & normalizer" aria-label="Equalizer & normalizer" className="flex items-center gap-2 md:gap-3 text-white/40 cursor-pointer hover:text-white transition-all group shrink-0 active:scale-95 outline-none">
                      <div className="p-3 bg-white/5 rounded-xl md:rounded-2xl group-hover:bg-brand-primary group-hover:text-black transition-all">
                          <SlidersHorizontal size={18} className="md:w-5 md:h-5" />
                      </div>
                      <span className="hidden lg:inline text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em]">EQ</span>
                  </button>


              </div>

              {/* Volume Controller (solo Desktop/Tablets) */}
              <div className="hidden sm:flex items-center gap-4 md:gap-6 w-full max-w-[200px] md:max-w-md px-4 md:px-10 group">
                  <button onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)} className="text-white/30 hover:text-white transition-colors cursor-pointer shrink-0 outline-none">
                      {volume === 0 ? <VolumeX size={18} className="md:w-5 md:h-5" /> : volume < 0.5 ? <Volume1 size={18} className="md:w-5 md:h-5" /> : <Volume2 size={18} className="md:w-5 md:h-5" />}
                  </button>
                  
                  <div className="relative flex-1 h-10 flex items-center group/slider">
                      <div className="absolute w-full h-[3px] md:h-[4px] bg-white/10 rounded-full pointer-events-none" />
                      <div className="absolute h-[3px] md:h-[4px] bg-brand-primary rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)] pointer-events-none" style={{ width: `${volume * 100}%` }} />
                      <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => onVolumeChange(parseFloat(e.target.value))} className="absolute w-full h-full opacity-0 cursor-pointer z-20 outline-none" />
                      <div className="absolute w-4 h-4 md:w-5 md:h-5 bg-white rounded-full shadow-2xl scale-0 group-hover/slider:scale-100 transition-transform pointer-events-none z-10 border-2 md:border-4 border-black" style={{ left: `calc(${volume * 100}% - 8px)` }} />
                  </div>
                  
                  <span className="hidden md:inline text-[10px] font-bold font-mono text-white/30 w-8 shrink-0 pointer-events-none">{Math.round(volume * 100)}%</span>
              </div>

              {/* Botón UP NEXT con cuadrado gris */}
              <button onClick={onToggleQueue} className="flex items-center gap-2 md:gap-3 text-white/40 hover:text-white cursor-pointer transition-all group shrink-0 active:scale-95 outline-none">
                  <span className="hidden sm:inline text-[9px] md:text-[10px] font-bold uppercase tracking-[0.3em]">Up Next</span>
                  <div className="p-3 bg-white/5 rounded-xl md:rounded-2xl group-hover:bg-white group-hover:text-black transition-all">
                      <ListMusic size={18} className="md:w-5 md:h-5" />
                  </div>
              </button>
        </div>
      </div>
    </motion.div>
  );
};