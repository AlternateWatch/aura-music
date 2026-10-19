import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, X, Clock, PlayCircle, Plus, PowerOff, Sparkles, Music } from 'lucide-react';
import { Song } from '../constants';

interface SleepTimerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  isActive: boolean;
  mode: 'time' | 'end-of-song' | null;
  remainingSeconds: number;
  enableFadeOut: boolean;
  setEnableFadeOut: (v: boolean) => void;
  startTimer: (minutes: number, fadeOut: boolean) => void;
  startEndOfSongTimer: (fadeOut: boolean) => void;
  cancelTimer: () => void;
  extendTimer: (additionalMinutes: number) => void;
  currentSong: Song | null;
}

const PRESETS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hora', minutes: 60 },
  { label: '1h 30m', minutes: 90 },
];

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export const SleepTimerOverlay: React.FC<SleepTimerOverlayProps> = ({
  isOpen,
  onClose,
  isActive,
  mode,
  remainingSeconds,
  enableFadeOut,
  setEnableFadeOut,
  startTimer,
  startEndOfSongTimer,
  cancelTimer,
  extendTimer,
  currentSong,
}) => {
  const [customMinutes, setCustomMinutes] = useState(20);
  const [showCustom, setShowCustom] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/75 backdrop-blur-md px-4 font-sans select-none"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#121212]/95 border border-white/10 rounded-[36px] p-6 sm:p-8 shadow-2xl backdrop-blur-2xl overflow-hidden"
      >
        {/* Glow de fondo decorativo para ambiente nocturno */}
        <div className="absolute -top-24 -left-24 w-52 h-52 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-52 h-52 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Botón de cierre */}
        <button
          onClick={onClose}
          aria-label="Cerrar temporizador de apagado"
          className="absolute top-6 right-6 p-2 rounded-full text-white/30 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <X size={20} />
        </button>

        {/* Cabecera */}
        <div className="flex items-center gap-3.5 mb-6">
          <div className="p-3 bg-amber-400/15 border border-amber-400/20 text-amber-300 rounded-2xl shadow-inner">
            <Moon size={22} className="stroke-[2.2]" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Temporizador de Apagado
            </h2>
            <p className="text-[11px] font-medium tracking-wide text-white/40">
              Detiene la música suavemente para que duermas tranquilo
            </p>
          </div>
        </div>

        {/* ESTADO ACTIVO */}
        {isActive ? (
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-amber-400/30 flex flex-col items-center justify-center text-center relative overflow-hidden">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300/80 mb-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                {mode === 'end-of-song' ? 'Se apagará al acabar el tema actual' : 'Tiempo restante'}
              </span>

              <div className="text-5xl font-extrabold tracking-tight text-white font-mono my-2 text-glow-amber">
                {formatTime(remainingSeconds)}
              </div>

              {mode === 'end-of-song' && currentSong && (
                <div className="flex items-center gap-2 text-white/50 text-xs mt-1 max-w-[280px] truncate">
                  <Music size={13} className="shrink-0 text-amber-300" />
                  <span className="truncate">{currentSong.title} — {currentSong.artist}</span>
                </div>
              )}

              {/* Botones de extensión de tiempo */}
              {mode === 'time' && (
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => extendTimer(5)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-semibold border border-white/10 transition-all cursor-pointer"
                  >
                    <Plus size={13} /> 5 min
                  </button>
                  <button
                    onClick={() => extendTimer(15)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-semibold border border-white/10 transition-all cursor-pointer"
                  >
                    <Plus size={13} /> 15 min
                  </button>
                </div>
              )}
            </div>

            {/* Cancelar temporizador */}
            <button
              onClick={() => {
                cancelTimer();
              }}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold text-sm transition-all cursor-pointer active:scale-[0.98]"
            >
              <PowerOff size={16} />
              Cancelar temporizador
            </button>
          </div>
        ) : (
          /* ESTADO INACTIVO: SELECCIÓN DE PRESET */
          <div className="space-y-5">
            {/* Presets rápidos */}
            <div className="grid grid-cols-3 gap-2.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  onClick={() => {
                    startTimer(preset.minutes, enableFadeOut);
                    onClose();
                  }}
                  className="py-3 px-2 rounded-2xl bg-white/[0.04] hover:bg-amber-400/15 border border-white/5 hover:border-amber-400/30 text-white/80 hover:text-amber-200 text-sm font-semibold transition-all cursor-pointer flex flex-col items-center gap-1 active:scale-95"
                >
                  <Clock size={16} className="text-white/40" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            {/* Opción: Fin de la pista actual */}
            {currentSong && (
              <button
                onClick={() => {
                  startEndOfSongTimer(enableFadeOut);
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] hover:bg-amber-400/10 border border-white/5 hover:border-amber-400/30 text-left transition-all cursor-pointer group active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-white/5 text-amber-300 group-hover:bg-amber-400/20 transition-colors">
                    <Music size={18} />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-white block">
                      Al terminar esta canción
                    </span>
                    <span className="text-[11px] text-white/40 truncate max-w-[220px] block">
                      {currentSong.title}
                    </span>
                  </div>
                </div>
                <PlayCircle size={18} className="text-white/30 group-hover:text-amber-300 transition-colors" />
              </button>
            )}

            {/* Tiempo personalizado */}
            <div className="pt-1">
              {!showCustom ? (
                <button
                  onClick={() => setShowCustom(true)}
                  className="w-full text-center text-xs text-white/40 hover:text-white/80 font-medium py-1 transition-colors cursor-pointer"
                >
                  + Elegir otro tiempo personalizado
                </button>
              ) : (
                <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/70">Minutos:</span>
                    <span className="text-sm font-mono font-bold text-amber-300">{customMinutes} min</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="180"
                    step="1"
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(Number(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        startTimer(customMinutes, enableFadeOut);
                        onClose();
                      }}
                      className="flex-1 py-2 rounded-xl bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 transition-all cursor-pointer"
                    >
                      Iniciar ({customMinutes} min)
                    </button>
                    <button
                      onClick={() => setShowCustom(false)}
                      className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 text-xs transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Interruptor Fade-Out */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center gap-2.5">
                <Sparkles size={16} className="text-amber-300" />
                <div>
                  <span className="text-xs font-semibold text-white block">Fade-out suave</span>
                  <span className="text-[10px] text-white/40 block">Baja el volumen suavemente al terminar</span>
                </div>
              </div>
              <button
                role="switch"
                aria-checked={enableFadeOut}
                onClick={() => setEnableFadeOut(!enableFadeOut)}
                className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer outline-none ${
                  enableFadeOut ? 'bg-amber-400' : 'bg-white/10'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
                    enableFadeOut ? 'left-6 bg-black' : 'left-1 bg-white'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
