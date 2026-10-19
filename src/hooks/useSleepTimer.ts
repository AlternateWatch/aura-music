import { useState, useEffect, useRef, useCallback } from 'react';
import { Song } from '../constants';
import { hapticImpact } from '../utils/haptics';

export type SleepTimerMode = 'time' | 'end-of-song' | null;

interface UseSleepTimerOptions {
  isPlaying: boolean;
  onPause: () => void;
  currentSong: Song | null;
  getCurrentTime: () => number;
  duration: number;
  volume: number;
  setVolume: (v: number) => void;
}

export function useSleepTimer({
  isPlaying,
  onPause,
  currentSong,
  getCurrentTime,
  duration,
  volume,
  setVolume,
}: UseSleepTimerOptions) {
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<SleepTimerMode>(null);
  const [targetTimestamp, setTargetTimestamp] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [enableFadeOut, setEnableFadeOut] = useState<boolean>(true);
  const [selectedMinutes, setSelectedMinutes] = useState<number>(30);

  // Guardamos el volumen base del usuario antes de que empiece cualquier fade-out
  const originalVolumeRef = useRef<number>(volume);
  const isFadingRef = useRef(false);
  const initialSongIdRef = useRef<string | null>(null);

  // Si el usuario cambia el volumen manualmente mientras NO se está haciendo fade-out,
  // actualizamos el volumen base recordado.
  useEffect(() => {
    if (!isFadingRef.current && volume > 0) {
      originalVolumeRef.current = volume;
    }
  }, [volume]);

  // Cancelar temporizador
  const cancelTimer = useCallback(() => {
    setIsActive(false);
    setMode(null);
    setTargetTimestamp(null);
    setRemainingSeconds(0);
    initialSongIdRef.current = null;

    // Restaurar volumen si estaba en fade
    if (isFadingRef.current) {
      setVolume(originalVolumeRef.current);
      isFadingRef.current = false;
    }
    hapticImpact('light');
  }, [setVolume]);

  // Iniciar temporizador por tiempo (en minutos)
  const startTimer = useCallback((minutes: number, withFadeOut: boolean = true) => {
    const totalSecs = Math.max(1, Math.round(minutes * 60));
    const target = Date.now() + totalSecs * 1000;

    originalVolumeRef.current = volume > 0 ? volume : 0.7;
    isFadingRef.current = false;
    setSelectedMinutes(minutes);
    setEnableFadeOut(withFadeOut);
    setTargetTimestamp(target);
    setRemainingSeconds(totalSecs);
    setMode('time');
    setIsActive(true);
    initialSongIdRef.current = currentSong?.id || null;

    hapticImpact('medium');
  }, [volume, currentSong?.id]);

  // Iniciar temporizador al acabar la canción actual
  const startEndOfSongTimer = useCallback((withFadeOut: boolean = true) => {
    if (!currentSong) return;

    originalVolumeRef.current = volume > 0 ? volume : 0.7;
    isFadingRef.current = false;
    setEnableFadeOut(withFadeOut);
    setTargetTimestamp(null);
    setMode('end-of-song');
    setIsActive(true);
    initialSongIdRef.current = currentSong.id;

    // Estimación inicial de segundos restantes de la canción
    const curTime = getCurrentTime();
    const dur = duration > 0 ? duration : 180;
    const rem = Math.max(0, Math.round(dur - curTime));
    setRemainingSeconds(rem);

    hapticImpact('medium');
  }, [currentSong, volume, getCurrentTime, duration]);

  // Extender tiempo (sumar minutos)
  const extendTimer = useCallback((additionalMinutes: number) => {
    if (!isActive) {
      startTimer(additionalMinutes, enableFadeOut);
      return;
    }

    if (mode === 'time' && targetTimestamp) {
      const addedMs = additionalMinutes * 60 * 1000;
      const newTarget = targetTimestamp + addedMs;
      setTargetTimestamp(newTarget);
      const newRem = Math.max(0, Math.round((newTarget - Date.now()) / 1000));
      setRemainingSeconds(newRem);

      // Si estábamos en fade-out y añadimos tiempo, restablecemos el volumen
      if (isFadingRef.current) {
        setVolume(originalVolumeRef.current);
        isFadingRef.current = false;
      }
      hapticImpact('light');
    }
  }, [isActive, mode, targetTimestamp, enableFadeOut, startTimer, setVolume]);

  // Bucle de comprobación y fade-out cada segundo
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      // 1. MODO: Fin de la canción
      if (mode === 'end-of-song') {
        // Si la canción cambió respecto a la que estaba sonando al fijar el timer, ha terminado
        if (initialSongIdRef.current && currentSong?.id && currentSong.id !== initialSongIdRef.current) {
          onPause();
          cancelTimer();
          hapticImpact('heavy');
          return;
        }

        const curTime = getCurrentTime();
        const dur = duration;
        if (dur > 0) {
          const trackRemaining = Math.max(0, dur - curTime);
          setRemainingSeconds(Math.round(trackRemaining));

          // Si quedan menos de 0.5s o la canción ya acabó
          if (trackRemaining <= 0.6) {
            onPause();
            cancelTimer();
            hapticImpact('heavy');
            return;
          }

          // Fade-out suave en los últimos 15 segundos
          if (enableFadeOut && trackRemaining <= 15) {
            isFadingRef.current = true;
            const factor = Math.max(0.01, trackRemaining / 15);
            setVolume(Number((originalVolumeRef.current * factor).toFixed(3)));
          }
        }
        return;
      }

      // 2. MODO: Tiempo en minutos
      if (mode === 'time' && targetTimestamp) {
        const diffMs = targetTimestamp - Date.now();
        const remaining = Math.max(0, Math.round(diffMs / 1000));
        setRemainingSeconds(remaining);

        if (remaining <= 0) {
          // ¡Temporizador terminado!
          onPause();
          cancelTimer();
          hapticImpact('heavy');
          return;
        }

        // Fade-out en los últimos 30 segundos (o últimos 10s si el timer era muy corto)
        const fadeDuration = selectedMinutes <= 1 ? 10 : 30;
        if (enableFadeOut && remaining <= fadeDuration) {
          isFadingRef.current = true;
          const factor = Math.max(0.01, remaining / fadeDuration);
          setVolume(Number((originalVolumeRef.current * factor).toFixed(3)));
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isActive,
    mode,
    targetTimestamp,
    enableFadeOut,
    selectedMinutes,
    currentSong?.id,
    duration,
    getCurrentTime,
    onPause,
    cancelTimer,
    setVolume,
  ]);

  return {
    isActive,
    mode,
    remainingSeconds,
    enableFadeOut,
    setEnableFadeOut,
    selectedMinutes,
    setSelectedMinutes,
    startTimer,
    startEndOfSongTimer,
    cancelTimer,
    extendTimer,
  };
}
