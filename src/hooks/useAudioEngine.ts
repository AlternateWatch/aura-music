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

  // 1. PERSISTENT AUDIO GRAPH SETUP
  // We initialize this once and never destroy it.
  const ensureGraph = () => {
    if (!audioRef.current || audioCtxRef.current) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    
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

    // Initial Routing
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

  // Handle Dynamic Normalizer Toggling
  useEffect(() => {
    applyRouting(isNormalizerEnabled);
  }, [isNormalizerEnabled]);

  // 2. VOLUME CONTROL
  useEffect(() => { 
    if (audioRef.current) audioRef.current.volume = volume; 
  }, [volume]);

  // 3. THE REPRODUCTION FIX
  // This logic manages the bridge between the state and the hardware.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong || !resolvedAudioUrl) return;

    const startAudioHardware = async () => {
      ensureGraph(); // Make sure nodes exist
      
      // Resuming context is required by browsers to "unmute" the graph
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      if (isPlaying) {
        try {
          await audio.play();
        } catch (e) {
          if (e.name !== "AbortError") console.error("Playback failed", e);
        }
      }
    };

    // Case A: Song changed
    if (audio.src !== new URL(resolvedAudioUrl, window.location.origin).href) {
      audio.pause();
      audio.src = resolvedAudioUrl;
      audio.load();

      // We MUST wait for 'canplay' on a source change, otherwise .play() is silent
      const onCanPlay = () => {
        startAudioHardware();
        audio.removeEventListener('canplay', onCanPlay);
      };
      audio.addEventListener('canplay', onCanPlay);
    } 
    // Case B: Simple Play/Pause toggle
    else {
      if (isPlaying) {
        startAudioHardware();
      } else {
        audio.pause();
      }
    }

    return () => {
      audio.removeEventListener('canplay', startAudioHardware);
    };
  }, [currentSong?.id, isPlaying, resolvedAudioUrl]);

  return { 
    audioRef, analyserRef, currentTime, setCurrentTime, duration, setDuration 
  };
}