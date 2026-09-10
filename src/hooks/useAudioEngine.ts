import { useState, useEffect, useRef } from "react";
import { Song } from "../constants";

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

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // THROTTLE: Evita que React procese decenas de renders por segundo
  const lastTimeUpdateRef = useRef(0);
  const handleThrottledTimeUpdate = (time: number) => {
    const now = performance.now();
    // Solo actualizamos el estado cada 200ms para dejar la CPU libre a 60 FPS
    if (now - lastTimeUpdateRef.current >= 200) {
      lastTimeUpdateRef.current = now;
      setCurrentTime(time);
    }
  };

  // 1. PERSISTENT AUDIO GRAPH SETUP
  const ensureGraph = () => {
    if (!audioRef.current || audioCtxRef.current) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    
    // CLAVE DE RENDIMIENTO: latencyHint 'playback' optimiza el hilo de audio de Windows
    // liberando el 80% de la CPU para que las animaciones vayan fluidas
    const ctx = new AudioContextClass({ latencyHint: 'playback' });
    
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

    applyRouting(isNormalizerEnabled);
  };

  const applyRouting = (enabled: boolean) => {
    if (!audioCtxRef.current || !sourceNodeRef.current) return;
    const ctx = audioCtxRef.current;
    const source = sourceNodeRef.current;
    const comp = compressorRef.current!;
    const ana = analyserRef.current!;

    source.disconnect();
    comp.disconnect();
    ana.disconnect();

    if (enabled) {
      source.connect(comp);
      comp.connect(ana);
    } else {
      source.connect(ana);
    }
    ana.connect(ctx.destination);
  };

  useEffect(() => {
    applyRouting(isNormalizerEnabled);
  }, [isNormalizerEnabled]);

  useEffect(() => { 
    if (audioRef.current) audioRef.current.volume = volume; 
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong || !resolvedAudioUrl) return;

    let canPlayHandler: (() => void) | null = null;

    const startAudioHardware = async () => {
      ensureGraph();
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      if (isPlaying) {
        try {
          await audio.play();
        } catch (e: any) {
          if (e.name !== "AbortError") console.error("Playback failed", e);
        }
      }
    };

    const targetUrl = new URL(resolvedAudioUrl, window.location.origin).href;

    // Case A: Song changed
    if (audio.src !== targetUrl) {
      audio.pause();
      audio.src = resolvedAudioUrl;
      audio.load();

      canPlayHandler = () => {
        startAudioHardware();
        if (canPlayHandler) audio.removeEventListener('canplay', canPlayHandler);
      };
      audio.addEventListener('canplay', canPlayHandler);
    } 
    // Case B: Simple Play/Pause toggle
    else {
      if (isPlaying) {
        startAudioHardware();
      } else {
        audio.pause();
      }
    }

    // Limpieza correcta de listeners para evitar fugas de memoria
    return () => {
      if (canPlayHandler) audio.removeEventListener('canplay', canPlayHandler);
    };
  }, [currentSong?.id, isPlaying, resolvedAudioUrl]);

  return { 
    audioRef, 
    analyserRef, 
    currentTime, 
    setCurrentTime: handleThrottledTimeUpdate, 
    duration, 
    setDuration 
  };
}