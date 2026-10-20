import { getResponsiveCoverSrcSet, DEFAULT_COVER } from '../utils/api';
import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Mic2,
  Shuffle,
  Repeat,
  Maximize2,
  MonitorPlay,
  SlidersHorizontal,
} from "lucide-react";
import { type Song } from "../constants";
import { useAudioPlaybackTime } from "../hooks/useAudioEngine";
import { useFileUrl } from "../hooks/useFileUrl";
import { motion } from "motion/react";
import { hapticImpact } from "../utils/haptics";

interface PlayerBarProps {
  currentSong: Song;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;

  getCurrentTime: () => number;
  subscribeToTime: (listener: () => void) => () => void;

  onTogglePlay: (e: any) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  isShuffle: boolean;
  isLoop: boolean;
  onToggleShuffle: (e: any) => void;
  onToggleLoop: (e: any) => void;
  onToggleLyrics: (e: any) => void;
  onOpenAudioSettings: () => void;
  onOpenFullPlayer: () => void;
  onToggleFocusMode: () => void;
  isFocusMode: boolean;
  activeTheme: string;
}

export function PlayerBar({
  currentSong,
  isPlaying,
  currentTime,
  duration,
  volume,
  getCurrentTime,
  subscribeToTime,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  isShuffle,
  isLoop,
  onToggleShuffle,
  onToggleLoop,
  onToggleLyrics,
  onOpenAudioSettings,
  onOpenFullPlayer,
  onToggleFocusMode,
  isFocusMode,
  activeTheme,
}: PlayerBarProps) {

  const liveCurrentTime = useAudioPlaybackTime(
  getCurrentTime,
  subscribeToTime
);

const [localProgress, setLocalProgress] = useState(currentTime);
const [isDragging, setIsDragging] = useState(false);
const resolvedCoverUrl = useFileUrl(currentSong?.coverUrl);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const handleMobileTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  };

  const handleMobileTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    // Solo desplazamos visualmente si el gesto es claramente horizontal
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) < 120) {
      setSwipeOffset(deltaX * 0.4);
    }
  };

  const handleMobileTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    setSwipeOffset(0);

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // 1. Gesto vertical hacia arriba: abrir Full Player
    if (deltaY < -40 && absY > absX * 1.1 && deltaTime < 600) {
      hapticImpact("light");
      onOpenFullPlayer();
      return;
    }

    // 2. Gesto horizontal: cambiar canción
    if (absX > 45 && absX > absY * 1.1 && deltaTime < 600) {
      if (deltaX < 0) {
        // Swipe hacia la izquierda -> Siguiente
        hapticImpact("medium");
        onNext();
      } else {
        // Swipe hacia la derecha -> Anterior
        hapticImpact("medium");
        onPrevious();
      }
      return;
    }

    // 3. Toque simple (tap sin desplazamiento): abrir Full Player
    if (absX < 12 && absY < 12) {
      onOpenFullPlayer();
    }
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time < 0) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalProgress(parseFloat(e.target.value));
  };

  const handleSeekStart = (e?: React.MouseEvent | React.TouchEvent) => {
  if (e) e.stopPropagation();

  setLocalProgress(liveCurrentTime);
  setIsDragging(true);
};

 const handleSeekEnd = (e?: React.MouseEvent | React.TouchEvent) => {
  if (e) e.stopPropagation();

  setIsDragging(false);
  onSeek(localProgress);
};

  const progressValue = isDragging ? localProgress : liveCurrentTime;
  const progressPercent = ((progressValue || 0) / (duration || 1)) * 100;

  const glassClasses =
    activeTheme === "light"
      ? "border-black/5 bg-white/60"
      : "border-white/10 bg-black/40";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        WebkitTapHighlightColor: "transparent",
        WebkitTouchCallout: "none",
        userSelect: "none",
      }}
      className={`
        relative w-full max-w-[100vw] shrink-0
        transition-all duration-1000 z-[100]
        outline-none select-none
        bg-transparent md:backdrop-blur-md md:border-t md:box-border
        ${activeTheme === "light" ? "md:border-black/5 md:bg-white/60" : "md:border-white/10 md:bg-black/40"}
      `}
 >

      {/* =========================================================
          MOBILE FLOATING ISLAND MINI-PLAYER
          ========================================================= */}
      <div className="flex md:hidden w-full px-3 pt-1 pb-[calc(0.6rem+env(safe-area-inset-bottom))] box-border">
        <div
          style={{
            WebkitTapHighlightColor: "transparent",
            WebkitTouchCallout: "none",
          }}
          className="relative flex items-center justify-between w-full h-[62px] px-3 rounded-2xl bg-[#141416]/95 backdrop-blur-2xl border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.7)] overflow-hidden select-none"
        >
          {/* Hairline Progress Bar along the top edge */}
          <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-white/10 overflow-hidden pointer-events-none">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-[#F27D26] to-orange-400 transition-all duration-150"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          </div>

          {/* Left: Cover Art & Song Info (TAP O SWIPE PARA ABRIR FULL PLAYER O CAMBIAR PISTA) */}
          <div
            onClick={onOpenFullPlayer}
            onTouchStart={handleMobileTouchStart}
            onTouchMove={handleMobileTouchMove}
            onTouchEnd={handleMobileTouchEnd}
            style={{
              transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
              transition: swipeOffset === 0 ? "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
            }}
            className="flex items-center gap-3 flex-1 h-full min-w-0 will-change-transform pr-2 cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-md bg-white/5 pointer-events-none">
              <img
                src={resolvedCoverUrl || currentSong.coverUrl || DEFAULT_COVER}
                srcSet={getResponsiveCoverSrcSet(resolvedCoverUrl || currentSong.coverUrl)}
                sizes="56px"
                decoding="async"
                className="w-full h-full object-cover"
                alt={currentSong.title}
                onError={(e) => {
                  if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                    e.currentTarget.src = DEFAULT_COVER;
                    e.currentTarget.removeAttribute('srcset');
                  }
                }}
              />
            </div>
            <div className="flex flex-col min-w-0 flex-1 justify-center pointer-events-none">
              <h4 className="font-bold text-sm truncate text-white leading-tight">
                {currentSong.title}
              </h4>
              <p className="text-white/50 text-[11px] uppercase font-semibold tracking-wide truncate mt-0.5">
                {currentSong.artist}
              </p>
            </div>
          </div>

          {/* Right: Controls (Previous, Play/Pause, Next) */}
          <div 
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 shrink-0 pointer-events-auto z-10"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                hapticImpact("light");
                onPrevious();
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white active:scale-90 transition-transform cursor-pointer outline-none focus:outline-none"
              title="Anterior"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                hapticImpact("medium");
                onTogglePlay(e);
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black shrink-0 active:scale-95 transition-transform shadow-xl cursor-pointer outline-none focus:outline-none"
              title={isPlaying ? "Pausar" : "Reproducir"}
            >
              {isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} className="ml-0.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                hapticImpact("light");
                onNext();
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white active:scale-90 transition-transform cursor-pointer outline-none focus:outline-none"
              title="Siguiente"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================
          DESKTOP LAYOUT
          ========================================================= */}
      <div className="hidden md:flex items-center justify-between w-full h-24 px-6 lg:px-10 gap-6 box-border">
        <div className="flex items-center gap-4 w-1/3 min-w-0 shrink-0">
          <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/10 shadow-xl bg-white/5">
            <img
              src={resolvedCoverUrl || currentSong.coverUrl || DEFAULT_COVER}
              srcSet={getResponsiveCoverSrcSet(resolvedCoverUrl || currentSong.coverUrl)}
              sizes="56px"
              decoding="async"
              className="w-full h-full object-cover"
              alt={currentSong.title}
              onError={(e) => {
                if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                  e.currentTarget.src = DEFAULT_COVER;
                  e.currentTarget.removeAttribute('srcset');
                }
              }}
            />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <h4 className="font-bold text-sm truncate text-white">
              {currentSong.title}
            </h4>
            <p className="text-white/40 text-[10px] uppercase font-bold truncate mt-1">
              {currentSong.artist}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 w-1/3 max-w-xl min-w-0 shrink-0">
          <div className="flex items-center justify-center gap-8 w-full">
            <button
              onClick={onToggleShuffle}
              className={`transition-all hover:scale-110 shrink-0 outline-none ${
                isShuffle ? "text-brand-primary" : "text-white/30 hover:text-white"
              }`}
            >
              <Shuffle size={16} />
            </button>
            <button
              onClick={onPrevious}
              className="text-white/50 hover:text-white transition-all hover:scale-110 shrink-0 outline-none"
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              onClick={onTogglePlay}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black shrink-0 hover:scale-105 active:scale-95 transition-all shadow-xl outline-none"
            >
              {isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} className="ml-0.5" fill="currentColor" />
              )}
            </button>
            <button
              onClick={onNext}
              className="text-white/50 hover:text-white transition-all hover:scale-110 shrink-0 outline-none"
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
            <button
              onClick={onToggleLoop}
              className={`transition-all hover:scale-110 shrink-0 outline-none ${
                isLoop ? "text-brand-primary" : "text-white/30 hover:text-white"
              }`}
            >
              <Repeat size={16} />
            </button>
          </div>
          <div className="flex items-center w-full min-w-0 gap-3">
            <span className="text-[10px] font-bold text-white/30 w-10 text-right font-mono shrink-0 pointer-events-none">
              {formatTime(progressValue)}
            </span>
            <div className="relative flex-1 h-1.5 group flex items-center min-w-0">
              <div className="absolute inset-0 bg-white/10 rounded-full w-full h-full pointer-events-none" />
              <div
                className="absolute left-0 bg-white rounded-full h-full z-10 pointer-events-none"
                style={{
                  width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                }}
              />
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={progressValue}
                onChange={handleSeekChange}
                onMouseDown={handleSeekStart}
                onMouseUp={handleSeekEnd}
                onTouchStart={handleSeekStart}
                onTouchEnd={handleSeekEnd}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 outline-none"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none shadow-md"
                style={{
                  left: `calc(${Math.min(100, Math.max(0, progressPercent))}% - 6px)`,
                }}
              />
            </div>
            <span className="text-[10px] font-bold text-white/30 w-10 font-mono shrink-0 pointer-events-none">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-6 w-1/3 min-w-0 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFocusMode();
            }}
            className={`transition-all hover:scale-110 shrink-0 outline-none ${
              isFocusMode ? "text-brand-primary" : "text-white/30 hover:text-white"
            }`}
          >
            <MonitorPlay size={18} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullPlayer();
            }}
            className="text-white/30 hover:text-white transition-all hover:scale-110 shrink-0 outline-none"
          >
            <Maximize2 size={18} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLyrics(e);
            }}
            className="text-white/30 hover:text-brand-primary transition-all hover:scale-110 shrink-0 outline-none"
          >
            <Mic2 size={18} />
          </button>
          <button
            title="Equalizer & normalizer"
            aria-label="Equalizer & normalizer"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAudioSettings();
            }}
            className="text-white/30 hover:text-brand-primary transition-all hover:scale-110 shrink-0 outline-none"
          >
            <SlidersHorizontal size={18} />
          </button>

          <div className="hidden lg:flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/5 group shrink-0">
            <Volume2 size={14} className="text-white/30" />
            <div className="relative w-24 h-1.5 flex items-center">
              <div className="absolute inset-0 bg-white/10 rounded-full w-full h-full" />
              <div
                className="absolute left-0 bg-white/60 rounded-full h-full pointer-events-none"
                style={{ width: `${volume * 100}%` }}
              />

              {/* Bolita circular blanca restaurada para PC */}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer z-20 outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}