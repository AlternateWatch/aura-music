import { useState, useEffect, useRef, useCallback, useSyncExternalStore, } from "react";
import { Song } from "../constants";

export function useAudioPlaybackTime(
  getCurrentTime: () => number,
  subscribeToTime: (listener: () => void) => () => void
) {
  return useSyncExternalStore(
    subscribeToTime,
    getCurrentTime,
    getCurrentTime
  );
}

export function useAudioEngine(
  currentSong: Song | null,
  isPlaying: boolean,
  volume: number,
  isNormalizerEnabled: boolean,
  setIsPlaying: (val: boolean) => void,
  resolvedAudioUrl: string | undefined
) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);


  const currentTimeRef = useRef(0);
  // Posición (s) a aplicar cuando termine de cargar la próxima canción.
  // Fijar audio.currentTime antes de cambiar el src no sirve: load() lo resetea a 0.
  const pendingSeekRef = useRef<number | null>(null);
  const timeListenersRef = useRef(new Set<() => void>());

  const [duration, setDuration] = useState(0);


  const handleTimeUpdate = useCallback((time: number) => {
  currentTimeRef.current = time;

  timeListenersRef.current.forEach((listener) => {
    listener();
  });
}, []);

  const getCurrentTime = useCallback(() => {
    return audioRef.current?.currentTime ?? currentTimeRef.current;
  }, []);

  const ensureGraph = useCallback(() => {
    if (!isNormalizerEnabled || !audioRef.current || audioCtxRef.current) {
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;

      const ctx = new AudioContextClass({
        latencyHint: "playback",
      });

      const source = ctx.createMediaElementSource(audioRef.current);
      const compressor = ctx.createDynamicsCompressor();
      const analyser = ctx.createAnalyser();

      analyser.fftSize = 64;

      compressor.threshold.setValueAtTime(-24, ctx.currentTime);
      compressor.knee.setValueAtTime(40, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      compressorRef.current = compressor;
      analyserRef.current = analyser;

      source.connect(compressor);
      compressor.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (e) {
      console.error("Error al iniciar Web Audio API:", e);
    }
  }, [isNormalizerEnabled]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentSong || !resolvedAudioUrl) {
      return;
    }

    let canPlayHandler: (() => void) | null = null;

    const startPlayback = async () => {
      if (isNormalizerEnabled) {
        ensureGraph();

        if (audioCtxRef.current?.state === "suspended") {
          try {
            await audioCtxRef.current.resume();
          } catch (e) {
            console.error("Error resuming AudioContext:", e);
          }
        }
      }

      if (isPlaying) {
        try {
          await audio.play();
        } catch (e: any) {
          if (e?.name === "NotAllowedError") {
            // El navegador bloquea el autoplay hasta que el usuario interactúa
            // (p. ej. al entrar desde un enlace). Mostramos pausa en vez de "sonando".
            console.warn("Autoplay bloqueado: hace falta pulsar play");
            setIsPlaying(false);
          } else if (e?.name !== "AbortError") {
            console.error("Playback failed", e);
          }
        }
      }
    };

    const targetUrl = new URL(
      resolvedAudioUrl,
      window.location.origin
    ).href;

    if (audio.src !== targetUrl) {
      audio.pause();
      currentTimeRef.current = 0;

      audio.src = resolvedAudioUrl;
      audio.load();

      canPlayHandler = () => {
        if (pendingSeekRef.current !== null) {
          try { audio.currentTime = pendingSeekRef.current; } catch (e) {}
          pendingSeekRef.current = null;
        }
        startPlayback();

        if (canPlayHandler) {
          audio.removeEventListener("canplay", canPlayHandler);
        }
      };

      audio.addEventListener("canplay", canPlayHandler);
    } else {
     
      if (isPlaying) {
        startPlayback();
      } else {
        audio.pause();
      }
    }

    return () => {
    
      if (canPlayHandler) {
        audio.removeEventListener("canplay", canPlayHandler);
      }
    };
  }, [
    currentSong?.id,
    isPlaying,
    resolvedAudioUrl,
    isNormalizerEnabled,
    ensureGraph,
  ]);

  const subscribeToTime = useCallback((listener: () => void) => {
  timeListenersRef.current.add(listener);

  return () => {
    timeListenersRef.current.delete(listener);
  };
}, []);

  return {
    audioRef,
    analyserRef,
    pendingSeekRef,

    
    currentTimeRef,
    getCurrentTime,
    subscribeToTime,

    handleTimeUpdate,

    duration,
    setDuration,
  };
}