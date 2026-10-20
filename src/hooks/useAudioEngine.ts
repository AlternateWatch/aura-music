import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { Song } from "../constants";
import { AudioSettings } from "../audio/audioSettings";
import { AudioGraph, IDLE_STATUS, getOrCreateGraph } from "../audio/audioGraph";

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
  settings: AudioSettings,
  setIsPlaying: (val: boolean) => void,
  resolvedAudioUrl: string | undefined,
  visualizerActive = false,
  onSongEnded?: () => void,
  getNextTrack?: () => { song: Song; resolveUrl: () => Promise<string | undefined> } | null,
  onGaplessNext?: (song: Song) => void
) {
  const primaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activePlayerRef = useRef<"A" | "B">("A");

  const graphRef = useRef<AudioGraph | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const statusListenersRef = useRef(new Set<() => void>());
  const unsubscribeGraphRef = useRef<(() => void) | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);

  // Valores "vivos" para que ensureGraph no dependa de ellos
  const volumeRef = useRef(volume);
  const settingsRef = useRef(settings);
  const songIdRef = useRef<string | null>(null);
  const onSongEndedRef = useRef(onSongEnded);
  const getNextTrackRef = useRef(getNextTrack);
  const onGaplessNextRef = useRef(onGaplessNext);

  volumeRef.current = volume;
  settingsRef.current = settings;
  onSongEndedRef.current = onSongEnded;
  getNextTrackRef.current = getNextTrack;
  onGaplessNextRef.current = onGaplessNext;

  const needsGraph =
    settings.normalizer.enabled ||
    settings.eq.enabled ||
    settings.crossfade.enabled ||
    (settings.gapless?.enabled ?? true) ||
    visualizerActive;

  const currentTimeRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const timeListenersRef = useRef(new Set<() => void>());
  const onCrossfadeNextRef = useRef<((commitCrossfade: () => void) => void) | null>(null);
  const durationRef = useRef(0);

  const standbyPreloadedForSongRef = useRef<string | null>(null);
  const transitionTriggeredForSongRef = useRef<string | null>(null);
  const nextTrackCandidateRef = useRef<Song | null>(null);

  const [duration, setDurationState] = useState(0);

  const setDuration = useCallback((d: number) => {
    durationRef.current = d;
    setDurationState(d);
    graphRef.current?.setDuration(d);
  }, []);

  const notifyStatus = useCallback(() => {
    statusListenersRef.current.forEach((l) => l());
  }, []);

  const ensureGraph = useCallback((): AudioGraph | null => {
    const pAudio = primaryAudioRef.current;
    if (graphRef.current) return graphRef.current;
    if (!pAudio) return null;

    const graph = getOrCreateGraph(pAudio, secondaryAudioRef.current ?? undefined);
    if (!graph) return null;

    graphRef.current = graph;
    analyserRef.current = graph.analyser;
    audioRef.current = graph.getActiveAudio();
    activePlayerRef.current = graph.getActivePlayer();

    graph.setVolume(volumeRef.current);
    graph.applySettings(settingsRef.current);
    graph.beginTrack(songIdRef.current);

    const activeAudio = graph.getActiveAudio();
    if (Number.isFinite(activeAudio.duration)) graph.setDuration(activeAudio.duration);

    unsubscribeGraphRef.current = graph.subscribeStatus(notifyStatus);
    void graph.resume().catch(() => {});

    setGraphVersion((v) => v + 1);
    notifyStatus();
    return graph;
  }, [notifyStatus]);

  const loadedSongIdRef = useRef<string | null>(null);

  // Manejador central de tiempo con pre-buffering inteligente y transición Gapless / Crossfade
  const handleTimeUpdate = useCallback((time: number) => {
    currentTimeRef.current = time;
    timeListenersRef.current.forEach((listener) => listener());

    const audio = audioRef.current;
    // La duración real del elemento de audio activo tiene máxima autoridad
    const realAudioDur = audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : 0;

    let dur = realAudioDur || durationRef.current;
    if (realAudioDur > 0 && Math.abs(realAudioDur - durationRef.current) > 0.5) {
      setDuration(realAudioDur);
      dur = realAudioDur;
    }

    const remaining = dur - time;
    const songId = songIdRef.current;
    const cf = settingsRef.current.crossfade;
    const gapless = settingsRef.current.gapless?.enabled ?? true;

    if (
      songId &&
      audio &&
      !audio.paused &&
      !audio.seeking &&
      Number.isFinite(dur) &&
      dur > 4
    ) {
      // 1. LOOKAHEAD: Pre-cargar silenciosamente en el reproductor standby
      // cuando falten 10 segundos para el final de la pista (o 40% en pistas muy cortas).
      // Guardia de seguridad: la pista debe llevar al menos 5 segundos reproduciéndose o haber superado el 40%.
      // Informar al gestor de prioridad del estado del buffer de reproducción
      playbackPriority.reportPlaybackState(audio ? !audio.paused : true, audio, remaining);

      // LOOKAHEAD: Solo precargar la siguiente si la activa ya tiene todo su final buferizado
      const prebufferThreshold = Math.min(10, Math.max(3, dur * 0.4));
      const bufferedAhead = playbackPriority.getBufferedAhead(audio);
      const isActiveTrackSafe = bufferedAhead >= Math.min(remaining - 0.5, 8) || remaining <= 2;
      const canPrebuffer = time > 5 && time >= dur * 0.4 && remaining <= prebufferThreshold && isActiveTrackSafe;

      if (canPrebuffer && standbyPreloadedForSongRef.current !== songId) {
        standbyPreloadedForSongRef.current = songId;
        const nextInfo = getNextTrackRef.current?.();
        if (nextInfo && nextInfo.song && nextInfo.song.id !== songId) {
          nextTrackCandidateRef.current = nextInfo.song;
          void nextInfo.resolveUrl().then((url) => {
            if (url && standbyPreloadedForSongRef.current === songId) {
              const g = ensureGraph();
              g?.prepareStandby(url);
            }
          });
        }
      }

      // 2. DISPARO DE TRANSICIÓN: Crossfade (si está activo) o Gapless 0 ms
      if (cf.enabled && cf.duration > 0 && dur > cf.duration * 2) {
        const isCrossfadePoint = time > 5 && time >= dur * 0.6 && remaining > 0.05 && remaining <= cf.duration;
        if (isCrossfadePoint && transitionTriggeredForSongRef.current !== songId) {
          const nextSong = nextTrackCandidateRef.current;
          const g = ensureGraph();
          const standbyAudio = g?.getStandbyAudio();
          // Solo si el siguiente track está realmente buferizado en standby
          if (nextSong && onGaplessNextRef.current && standbyAudio && standbyAudio.readyState >= 2) {
            transitionTriggeredForSongRef.current = songId;
            loadedSongIdRef.current = nextSong.id;
            g.triggerCrossfadeTransition(cf.duration);
            activePlayerRef.current = g.getActivePlayer();
            const newAudio = g.getActiveAudio();
            audioRef.current = newAudio;
            const newDur = (Number.isFinite(newAudio.duration) && newAudio.duration > 0)
              ? newAudio.duration
              : (nextSong.duration || 0);
            setDuration(newDur);
            onGaplessNextRef.current(nextSong);
          }
        }
      } else if (gapless) {
        // Gapless 0 ms: disparar cuando resten menos de 45 ms para sample exacto sin gap
        const isGaplessPoint = time > 5 && time >= dur * 0.7 && remaining <= 0.045 && remaining >= -0.5;
        if (isGaplessPoint && transitionTriggeredForSongRef.current !== songId) {
          const nextSong = nextTrackCandidateRef.current;
          const g = ensureGraph();
          const standbyAudio = g?.getStandbyAudio();
          // Solo si el siguiente track está listo para reproducir
          if (nextSong && onGaplessNextRef.current && standbyAudio && standbyAudio.readyState >= 2) {
            transitionTriggeredForSongRef.current = songId;
            loadedSongIdRef.current = nextSong.id;
            g.triggerGaplessTransition();
            activePlayerRef.current = g.getActivePlayer();
            const newAudio = g.getActiveAudio();
            audioRef.current = newAudio;
            const newDur = (Number.isFinite(newAudio.duration) && newAudio.duration > 0)
              ? newAudio.duration
              : (nextSong.duration || 0);
            setDuration(newDur);
            onGaplessNextRef.current(nextSong);
          }
        }
      }
    }
  }, [ensureGraph, setDuration]);

  const handleLoadedMetadata = useCallback((d: number) => {
    if (Number.isFinite(d)) {
      setDuration(d);
    }
  }, [setDuration]);

  const handleEnded = useCallback((player: "A" | "B") => {
    if (activePlayerRef.current !== player) return;
    const songId = songIdRef.current;

    // Si la transición ya se disparó anticipadamente (0 ms gapless o crossfade), no duplicar
    if (transitionTriggeredForSongRef.current === songId) return;

    const cf = settingsRef.current.crossfade;
    const gapless = settingsRef.current.gapless?.enabled ?? true;

    if (nextTrackCandidateRef.current && onGaplessNextRef.current && (gapless || (cf.enabled && cf.duration > 0))) {
      const nextSong = nextTrackCandidateRef.current;
      const g = ensureGraph();
      const standbyAudio = g?.getStandbyAudio();
      if (standbyAudio && standbyAudio.readyState >= 2) {
        transitionTriggeredForSongRef.current = songId;
        loadedSongIdRef.current = nextSong.id;
        if (cf.enabled && cf.duration > 0) {
          g.triggerCrossfadeTransition(cf.duration);
        } else {
          g.triggerGaplessTransition();
        }
        activePlayerRef.current = g.getActivePlayer();
        const newAudio = g.getActiveAudio();
        audioRef.current = newAudio;
        const newDur = (Number.isFinite(newAudio.duration) && newAudio.duration > 0)
          ? newAudio.duration
          : (nextSong.duration || 0);
        setDuration(newDur);
        onGaplessNextRef.current(nextSong);
        return;
      }
    }

    onSongEndedRef.current?.();
  }, [ensureGraph, setDuration]);

  // Enlazar los eventos nativos de ambos elementos de audio
  useEffect(() => {
    const a1 = primaryAudioRef.current;
    const a2 = secondaryAudioRef.current;
    if (!a1 || !a2) return;

    if (!audioRef.current) {
      audioRef.current = a1;
    }

    const onTimeA = () => { if (activePlayerRef.current === "A") handleTimeUpdate(a1.currentTime); };
    const onTimeB = () => { if (activePlayerRef.current === "B") handleTimeUpdate(a2.currentTime); };

    const onMetaA = () => { if (activePlayerRef.current === "A") handleLoadedMetadata(a1.duration); };
    const onMetaB = () => { if (activePlayerRef.current === "B") handleLoadedMetadata(a2.duration); };

    const onEndA = () => { if (activePlayerRef.current === "A") handleEnded("A"); };
    const onEndB = () => { if (activePlayerRef.current === "B") handleEnded("B"); };

    const onWaiting = () => playbackPriority.setBuffering(true);
    const onPlaying = () => {
      playbackPriority.setBuffering(false);
      playbackPriority.reportPlaybackState(true, audioRef.current);
    };
    const onPause = () => playbackPriority.reportPlaybackState(false, audioRef.current);
    const onCanPlay = () => playbackPriority.setBuffering(false);

    a1.addEventListener("timeupdate", onTimeA);
    a2.addEventListener("timeupdate", onTimeB);
    a1.addEventListener("loadedmetadata", onMetaA);
    a2.addEventListener("loadedmetadata", onMetaB);
    a1.addEventListener("ended", onEndA);
    a2.addEventListener("ended", onEndB);
    a1.addEventListener("waiting", onWaiting);
    a2.addEventListener("waiting", onWaiting);
    a1.addEventListener("stalled", onWaiting);
    a2.addEventListener("stalled", onWaiting);
    a1.addEventListener("playing", onPlaying);
    a2.addEventListener("playing", onPlaying);
    a1.addEventListener("pause", onPause);
    a2.addEventListener("pause", onPause);
    a1.addEventListener("canplay", onCanPlay);
    a2.addEventListener("canplay", onCanPlay);

    return () => {
      a1.removeEventListener("timeupdate", onTimeA);
      a2.removeEventListener("timeupdate", onTimeB);
      a1.removeEventListener("loadedmetadata", onMetaA);
      a2.removeEventListener("loadedmetadata", onMetaB);
      a1.removeEventListener("ended", onEndA);
      a2.removeEventListener("ended", onEndB);
      a1.removeEventListener("waiting", onWaiting);
      a2.removeEventListener("waiting", onWaiting);
      a1.removeEventListener("stalled", onWaiting);
      a2.removeEventListener("stalled", onWaiting);
      a1.removeEventListener("playing", onPlaying);
      a2.removeEventListener("playing", onPlaying);
      a1.removeEventListener("pause", onPause);
      a2.removeEventListener("pause", onPause);
      a1.removeEventListener("canplay", onCanPlay);
      a2.removeEventListener("canplay", onCanPlay);
    };
  }, [handleTimeUpdate, handleLoadedMetadata, handleEnded]);

  const getCurrentTime = useCallback(() => {
    return audioRef.current?.currentTime ?? currentTimeRef.current;
  }, []);

  useEffect(() => {
    if (needsGraph) ensureGraph();
  }, [needsGraph, ensureGraph]);

  useEffect(() => {
    graphRef.current?.applySettings(settings);
  }, [settings, graphVersion]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) {
      graph.setVolume(volume);
    } else if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, graphVersion]);

  useEffect(() => () => { unsubscribeGraphRef.current?.(); }, []);

  // Nueva canción => reiniciar análisis de sonoridad y banderas de transición
  useEffect(() => {
    const id = currentSong?.id ?? null;
    songIdRef.current = id;
    if (loadedSongIdRef.current !== id) {
      standbyPreloadedForSongRef.current = null;
      transitionTriggeredForSongRef.current = null;
      nextTrackCandidateRef.current = null;
      const initialDur = (currentSong && Number.isFinite(currentSong.duration) && currentSong.duration > 0)
        ? currentSong.duration
        : 0;
      setDuration(initialDur);
      currentTimeRef.current = 0;
    }
    const graph = graphRef.current;
    if (!graph) return;
    graph.beginTrack(id);
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1 && Number.isFinite(audio.duration) && loadedSongIdRef.current === id) {
      graph.setDuration(audio.duration);
    }
  }, [currentSong?.id, currentSong?.duration, setDuration]);

  // Carga y reproducción controlada
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentSong || !resolvedAudioUrl) {
      return;
    }

    let canPlayHandler: (() => void) | null = null;

    const startPlayback = async () => {
      if (needsGraph) ensureGraph();

      const graph = graphRef.current;
      if (graph && graph.ctx.state !== "running") {
        try {
          await graph.resume();
        } catch (e) {
          console.error("Error resuming AudioContext:", e);
        }
      }

      if (isPlaying && audio.paused) {
        try {
          await audio.play();
        } catch (e: any) {
          if (e?.name === "NotAllowedError") {
            console.warn("Autoplay bloqueado: requiere interacción del usuario");
            setIsPlaying(false);
          } else if (e?.name !== "AbortError") {
            console.error("Playback failed", e);
          }
        }
      }
    };

    const isDifferentSong = loadedSongIdRef.current !== currentSong.id;
    const needsNewTrackLoad = isDifferentSong || !audio.src;

    let errorHandler: (() => void) | null = null;

    if (needsNewTrackLoad) {
      loadedSongIdRef.current = currentSong.id;
      standbyPreloadedForSongRef.current = null;
      transitionTriggeredForSongRef.current = null;
      nextTrackCandidateRef.current = null;

      const songDur = (Number.isFinite(currentSong.duration) && currentSong.duration > 0)
        ? currentSong.duration
        : 0;
      setDuration(songDur);

      audio.pause();
      currentTimeRef.current = 0;

      // Asegurar que las ganancias del reproductor activo estén calibradas
      if (graphRef.current) {
        graphRef.current.resetGains(activePlayerRef.current);
      }

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

      errorHandler = () => {
        console.warn("Error en reproducción de audio, reseteando referencia de canción:", audio.error);
        loadedSongIdRef.current = null;
      };

      audio.addEventListener("canplay", canPlayHandler);
      audio.addEventListener("error", errorHandler, { once: true });
    } else {
      if (isPlaying) {
        if (audio.paused) {
          startPlayback();
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
        graphRef.current?.stopCrossfade();
      }
    }

    return () => {
      if (canPlayHandler) {
        audio.removeEventListener("canplay", canPlayHandler);
      }
      if (errorHandler) {
        audio.removeEventListener("error", errorHandler);
      }
    };
  }, [
    currentSong?.id,
    isPlaying,
    resolvedAudioUrl,
    needsGraph,
    ensureGraph,
    setIsPlaying,
  ]);

  const subscribeToTime = useCallback((listener: () => void) => {
    timeListenersRef.current.add(listener);
    return () => {
      timeListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeStatus = useCallback((listener: () => void) => {
    statusListenersRef.current.add(listener);
    return () => {
      statusListenersRef.current.delete(listener);
    };
  }, []);

  const getStatus = useCallback(() => graphRef.current?.getStatus() ?? IDLE_STATUS, []);

  const clearLoudnessCache = useCallback(() => {
    graphRef.current?.clearLoudnessCache();
  }, []);

  return {
    primaryAudioRef,
    secondaryAudioRef,
    audioRef,
    analyser: graphRef.current?.analyser ?? null,
    analyserRef,
    pendingSeekRef,
    onCrossfadeNextRef,

    subscribeStatus,
    getStatus,
    clearLoudnessCache,

    currentTimeRef,
    getCurrentTime,
    subscribeToTime,

    handleTimeUpdate,

    duration,
    setDuration,
  };
}
