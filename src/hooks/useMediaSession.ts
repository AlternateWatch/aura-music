import { useEffect } from "react";
import { Song } from "../constants";

/**
 * Controles de transporte del sistema para web y escritorio (Tauri).
 *
 * Usa la Media Session API del navegador, que es lo que conecta:
 *  - Botones de auriculares/Bluetooth con cable (play/pause, next, prev)
 *  - Las teclas multimedia del teclado
 *  - En Windows, el panel SMTC (System Media Transport Controls) vía WebView2,
 *    que es la misma superficie que alimenta el thumbbar de la barra de tareas.
 *
 * En Android nativo (Capacitor) esto se queda desactivado a propósito:
 * `AuraMedia` ya gestiona su propia MediaSession nativa y registrar las dos
 * a la vez puede pisarse (dos "ahora sonando" compitiendo).
 */

interface UseMediaSessionParams {
  currentSong: Song | null;
  isPlaying: boolean;
  duration: number;
  getCurrentTime: () => number;
  subscribeToTime: (listener: () => void) => () => void;
  setIsPlaying: (val: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekTo: (seconds: number) => void;
  isNativePlatform: boolean;
}

const isSupported = () =>
  typeof window !== "undefined" && "mediaSession" in navigator;

export function useMediaSession({
  currentSong,
  isPlaying,
  duration,
  getCurrentTime,
  subscribeToTime,
  setIsPlaying,
  onNext,
  onPrevious,
  onSeekTo,
  isNativePlatform,
}: UseMediaSessionParams) {
  // Metadatos + action handlers. Se re-registran cuando cambian los
  // callbacks (next/prev/seek dependen de la cola activa) para que
  // siempre disparen la lógica de reproducción más reciente.
  useEffect(() => {
    if (!isSupported() || isNativePlatform) return;
    if (!currentSong) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title || "Aura Music",
      artist: currentSong.artist || "",
      album: currentSong.album || "",
      artwork: currentSong.coverUrl
        ? [
            { src: currentSong.coverUrl, sizes: "96x96", type: "image/jpeg" },
            { src: currentSong.coverUrl, sizes: "256x256", type: "image/jpeg" },
            { src: currentSong.coverUrl, sizes: "512x512", type: "image/jpeg" },
          ]
        : [],
    });

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Acción no soportada por este navegador (p. ej. Safari con 'stop')
      }
    };

    safeSetHandler("play", () => setIsPlaying(true));
    safeSetHandler("pause", () => setIsPlaying(false));
    safeSetHandler("previoustrack", () => onPrevious());
    safeSetHandler("nexttrack", () => onNext());
    safeSetHandler("stop", () => setIsPlaying(false));
    safeSetHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        onSeekTo(details.seekTime);
      }
    });
    safeSetHandler("seekbackward", (details) => {
      const skip = details.seekOffset || 10;
      onSeekTo(Math.max(0, getCurrentTime() - skip));
    });
    safeSetHandler("seekforward", (details) => {
      const skip = details.seekOffset || 10;
      onSeekTo(Math.min(duration || Infinity, getCurrentTime() + skip));
    });

    return () => {
      safeSetHandler("play", null);
      safeSetHandler("pause", null);
      safeSetHandler("previoustrack", null);
      safeSetHandler("nexttrack", null);
      safeSetHandler("stop", null);
      safeSetHandler("seekto", null);
      safeSetHandler("seekbackward", null);
      safeSetHandler("seekforward", null);
    };
  }, [
    currentSong?.id,
    currentSong?.title,
    currentSong?.artist,
    currentSong?.album,
    currentSong?.coverUrl,
    duration,
    isNativePlatform,
    onNext,
    onPrevious,
    onSeekTo,
    setIsPlaying,
    getCurrentTime,
  ]);

  // Estado play/pause (icono del panel del sistema)
  useEffect(() => {
    if (!isSupported() || isNativePlatform || !currentSong) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying, isNativePlatform, currentSong?.id]);

  // Posición/duración, para la barra de progreso del panel del sistema.
  // setPositionState puede lanzar si la duración aún es 0/NaN.
  useEffect(() => {
    if (!isSupported() || isNativePlatform || !currentSong) return;
    if (!duration || !Number.isFinite(duration) || duration <= 0) return;

    const syncPosition = () => {
      try {
        const position = Math.min(getCurrentTime(), duration);
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.max(0, position),
          playbackRate: 1,
        });
      } catch {
        // Ignorable: pasa si duration/position quedan inconsistentes
        // un instante durante un cambio de pista.
      }
    };

    syncPosition();
    const unsubscribe = subscribeToTime(syncPosition);
    return unsubscribe;
  }, [currentSong?.id, duration, getCurrentTime, subscribeToTime, isNativePlatform]);
}
