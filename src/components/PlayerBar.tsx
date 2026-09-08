import { useState, useEffect } from "react";
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
} from "lucide-react";
import { type Song } from "../constants";
import { motion } from "motion/react";

interface PlayerBarProps {
  currentSong: Song;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
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
  onOpenFullPlayer,
  onToggleFocusMode,
  isFocusMode,
  activeTheme,
}: PlayerBarProps) {
  const [localProgress, setLocalProgress] = useState(currentTime);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      setLocalProgress(currentTime);
    }
  }, [currentTime, isDragging]);

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
    setIsDragging(true);
  };

  const handleSeekEnd = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    setIsDragging(false);
    onSeek(localProgress);
  };

  const progressValue = isDragging ? localProgress : currentTime;
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
        backdrop-blur-md border-t box-border
        transition-all duration-1000 z-[100]
        overflow-hidden outline-none select-none
        ${glassClasses}
      `}
    >
      {/* Inyección CSS directa e inviolable para navegadores móviles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          *, *::before, *::after, button, input {
            -webkit-tap-highlight-color: transparent !important;
            -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
            -webkit-touch-callout: none !important;
            outline: none !important;
            box-shadow: none !important;
          }
          button:focus, button:active, button:focus-visible {
            outline: none !important;
            box-shadow: none !important;
          }
        `,
        }}
      />

      {/* =========================================================
          MOBILE LAYOUT
          ========================================================= */}
      <div
        onClick={onOpenFullPlayer}
        style={{
          WebkitTapHighlightColor: "transparent",
          WebkitTouchCallout: "none",
        }}
        className="flex md:hidden flex-col w-full h-auto pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4 gap-4 box-border cursor-pointer outline-none select-none"
      >
        {/* ROW 1: Art, Info, and Controls */}
        <div className="flex items-center justify-between w-full min-w-0 gap-3 pointer-events-auto">
          <div className="flex items-center gap-3 flex-1 min-w-0 pointer-events-none">
            <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-white/10 shadow-lg">
              <img
                src={currentSong.coverUrl}
                className="w-full h-full object-cover"
                alt={currentSong.title}
              />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <h4 className="font-bold text-sm truncate text-white">
                {currentSong.title}
              </h4>
              <p className="text-white/50 text-[10px] uppercase font-bold truncate mt-0.5">
                {currentSong.artist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPrevious();
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-8 h-8 flex items-center justify-center text-white/50 active:scale-90 transition-transform cursor-pointer outline-none focus:outline-none"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay(e);
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black shrink-0 active:scale-95 transition-transform shadow-xl cursor-pointer outline-none focus:outline-none"
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
                onNext();
              }}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="w-8 h-8 flex items-center justify-center text-white/50 active:scale-90 transition-transform cursor-pointer outline-none focus:outline-none"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>

        {/* ROW 2: Progress Bar & Secondary Controls */}
        <div
          className="flex items-center w-full min-w-0 gap-2 sm:gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* SHUFFLE BUTTON */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleShuffle(e);
            }}
            style={{
              WebkitTapHighlightColor: "transparent",
              WebkitTouchCallout: "none",
            }}
            className={`w-7 h-7 flex items-center justify-center shrink-0 transition-transform active:scale-90 cursor-pointer outline-none focus:outline-none ${
              isShuffle ? "text-brand-primary" : "text-white/40"
            }`}
          >
            <Shuffle size={14} />
          </button>

          <span className="text-[10px] font-bold text-white/40 w-7 text-right font-mono shrink-0 pointer-events-none">
            {formatTime(progressValue)}
          </span>

          <div className="relative flex-1 h-1.5 flex items-center min-w-0">
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
              onClick={(e) => e.stopPropagation()}
              onMouseDown={handleSeekStart}
              onChange={handleSeekChange}
              onMouseUp={handleSeekEnd}
              onTouchStart={handleSeekStart}
              onTouchEnd={handleSeekEnd}
              style={{
                WebkitTapHighlightColor: "transparent",
                WebkitTouchCallout: "none",
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 outline-none focus:outline-none"
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md z-30 pointer-events-none"
              style={{
                left: `calc(${Math.min(100, Math.max(0, progressPercent))}% - 6px)`,
              }}
            />
          </div>

          <span className="text-[10px] font-bold text-white/40 w-7 font-mono shrink-0 pointer-events-none">
            {formatTime(duration)}
          </span>

          {/* LOOP BUTTON */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLoop(e);
            }}
            style={{
              WebkitTapHighlightColor: "transparent",
              WebkitTouchCallout: "none",
            }}
            className={`w-7 h-7 flex items-center justify-center shrink-0 transition-transform active:scale-90 cursor-pointer outline-none focus:outline-none ${
              isLoop ? "text-brand-primary" : "text-white/40"
            }`}
          >
            <Repeat size={14} />
          </button>
        </div>
      </div>

      {/* =========================================================
          DESKTOP LAYOUT
          ========================================================= */}
      <div className="hidden md:flex items-center justify-between w-full h-24 px-6 lg:px-10 gap-6 box-border">
        <div className="flex items-center gap-4 w-1/3 min-w-0 shrink-0">
          <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/10 shadow-xl">
            <img
              src={currentSong.coverUrl}
              className="w-full h-full object-cover"
              alt={currentSong.title}
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