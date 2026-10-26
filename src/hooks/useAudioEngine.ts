import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { Song } from "../constants";
import { AudioSettings } from "../audio/audioSettings";
import { AudioGraph, IDLE_STATUS, getOrCreateGraph } from "../audio/audioGraph";
import { playbackPriority } from "../utils/playbackPriority";

function isSameAudioSource(elementSrc: string | null | undefined, targetUrl: string | null | undefined): boolean {
  if (!elementSrc || !targetUrl) return false;
  if (elementSrc === targetUrl) return true;
  try {
    const elUrl = new URL(elementSrc, window.location.href).href;
    const tgUrl = new URL(targetUrl, window.location.href).href;
    return elUrl === tgUrl;
  } catch {
    return elementSrc.endsWith(targetUrl) || targetUrl.endsWith(elementSrc);
  }
}

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
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const needsGraph =
    settings.normalizer.enabled ||
    settings.eq.enabled ||
    (settings.crossfade.enabled && settings.crossfade.duration > 0) ||
    (settings.playbackRate?.reverbWet ?? 0) > 0 ||
    visualizerActive;

  const currentTimeRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const timeListenersRef = useRef(new Set<() => void>());
  const onCrossfadeNextRef = useRef<((commitCrossfade: () => void) => void) | null>(null);
  const durationRef = useRef(0);

  const standbyPreloadedForSongRef = useRef<string | null>(null);
  const standbyPreloadedTrackRef = useRef<{ id: string; url: string } | null>(null);
  const transitionTriggeredForSongRef = useRef<string | null>(null);
  const nextTrackCandidateRef = useRef<Song | null>(null);
  const isChangingTrackRef = useRef(false);

  const applyPlaybackRate = useCallback((a: HTMLAudioElement | null) => {
    if (!a) return;
    const rate = settingsRef.current.playbackRate?.rate ?? 1.0;
    const preservesPitch = settingsRef.current.playbackRate?.preservePitch !== false;

    a.defaultPlaybackRate = rate;
    if (Math.abs(a.playbackRate - rate) > 0.001) {
      a.playbackRate = rate;
    }
    (a as any).preservesPitch = preservesPitch;
    (a as any).mozPreservesPitch = preservesPitch;
    (a as any).webkitPreservesPitch = preservesPitch;
  }, []);

  const isStandbyReadyForSong = useCallback((standbyAudio: HTMLAudioElement | null, targetSong: Song | null): boolean => {
    if (!standbyAudio || !targetSong) return false;
    const preloaded = standbyPreloadedTrackRef.current;
    if (!preloaded || preloaded.id !== targetSong.id) return false;
    if (!isSameAudioSource(standbyAudio.src, preloaded.url)) return false;
    if (standbyAudio.error) return false;
    // En móviles/WebView y streaming FLAC, preload="auto" carga hasta HAVE_METADATA (1).
    if (standbyAudio.readyState < 1) return false;
    return true;
  }, []);

  const clearStandbyPlayer = useCallback(() => {
    standbyPreloadedForSongRef.current = null;
    standbyPreloadedTrackRef.current = null;
    const g = graphRef.current;
    const standby = g ? g.getStandbyAudio() : (activePlayerRef.current === "A" ? secondaryAudioRef.current : primaryAudioRef.current);
    if (standby) {
      if (!standby.paused) standby.pause();
      try { standby.currentTime = 0; } catch {}
    }
  }, []);

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

      // Precarga ultra-anticipada: inicia tan pronto lleve 3s sonando de forma estable
      // para que cuando termine la canción actual, la siguiente ya esté 100% en memoria
      const bufferedAhead = playbackPriority.getBufferedAhead(audio);
      const isBufferHealthy = bufferedAhead >= 3 || remaining <= 40;
      const canPrebuffer = time > 3 && isBufferHealthy;

      if (canPrebuffer && standbyPreloadedForSongRef.current !== songId) {
        standbyPreloadedForSongRef.current = songId;
        const nextInfo = getNextTrackRef.current?.();
        if (nextInfo && nextInfo.song && nextInfo.song.id !== songId) {
          nextTrackCandidateRef.current = nextInfo.song;
          const candidateSongId = nextInfo.song.id;
          void nextInfo.resolveUrl().then((url) => {
            if (url && songIdRef.current === songId && nextTrackCandidateRef.current?.id === candidateSongId) {
              standbyPreloadedTrackRef.current = { id: candidateSongId, url };
              const g = graphRef.current;
              if (g) {
                g.prepareStandby(url);
              } else {
                const standby = activePlayerRef.current === "A" ? secondaryAudioRef.current : primaryAudioRef.current;
                if (standby && standby.paused && !isSameAudioSource(standby.src, url)) {
                  standby.src = url;
                  standby.preload = "auto";
                  applyPlaybackRate(standby);
                  standby.load();
                }
              }
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
          // Verificación estricta: sólo disparar si standby tiene cargada ESTA misma canción y datos listos
          if (nextSong && onGaplessNextRef.current && isStandbyReadyForSong(standbyAudio, nextSong)) {
            transitionTriggeredForSongRef.current = songId;
      loadedSongIdRef.current = nextSong.id;
      standbyPreloadedTrackRef.current = null;
      standbyPreloadedForSongRef.current = null;
      nextTrackCandidateRef.current = null;
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
        // Gapless 0 ms: disparar cuando resten menos de 180 ms para solapamiento sample-exacto sin silencio
        const isGaplessPoint = time > 3 && remaining <= 0.18 && remaining >= -0.5;
        if (isGaplessPoint && transitionTriggeredForSongRef.current !== songId) {
          const nextSong = nextTrackCandidateRef.current;
          const g = graphRef.current;
          const standbyAudio = g ? g.getStandbyAudio() : (activePlayerRef.current === "A" ? secondaryAudioRef.current : primaryAudioRef.current);
          // Verificación estricta: sólo disparar si standby tiene cargada ESTA misma canción y datos listos
          if (nextSong && onGaplessNextRef.current && isStandbyReadyForSong(standbyAudio, nextSong)) {
            transitionTriggeredForSongRef.current = songId;
            loadedSongIdRef.current = nextSong.id;
            if (g) {
              g.triggerGaplessTransition();
              activePlayerRef.current = g.getActivePlayer();
              audioRef.current = g.getActiveAudio();
            } else {
              const from = activePlayerRef.current;
              const to: "A" | "B" = from === "A" ? "B" : "A";
              const fromAudio = from === "A" ? primaryAudioRef.current : secondaryAudioRef.current;
              const toAudio = to === "A" ? secondaryAudioRef.current : primaryAudioRef.current;
              activePlayerRef.current = to;
              if (toAudio) {
                audioRef.current = toAudio;
                toAudio.volume = volumeRef.current;
                applyPlaybackRate(toAudio);
                void toAudio.play().catch(() => {});
              }
              if (fromAudio) {
                fromAudio.pause();
                fromAudio.currentTime = 0;
              }
            }
            const newAudio = audioRef.current;
            const newDur = (newAudio && Number.isFinite(newAudio.duration) && newAudio.duration > 0)
              ? newAudio.duration
              : (nextSong.duration || 0);
            setDuration(newDur);
            onGaplessNextRef.current(nextSong);
          }
        }
      }
    }
  }, [ensureGraph, isStandbyReadyForSong, applyPlaybackRate, setDuration]);

  const handleLoadedMetadata = useCallback((d: number) => {
    if (Number.isFinite(d)) {
      setDuration(d);
    }
  }, [setDuration]);

  const handleEnded = useCallback((player: "A" | "B") => {
    if (activePlayerRef.current !== player) return;
    const songId = songIdRef.current;

    // Si la transición ya se disparó y cambió la canción, no duplicar
    if (transitionTriggeredForSongRef.current === songId && loadedSongIdRef.current !== songId) {
      return;
    }

    const cf = settingsRef.current.crossfade;
    const gapless = settingsRef.current.gapless?.enabled ?? true;
    const nextSong = nextTrackCandidateRef.current;
    const g = graphRef.current;
    const standbyAudio = g ? g.getStandbyAudio() : (activePlayerRef.current === "A" ? secondaryAudioRef.current : primaryAudioRef.current);

    if (nextSong && onGaplessNextRef.current && (gapless || (cf.enabled && cf.duration > 0)) && isStandbyReadyForSong(standbyAudio, nextSong)) {
      transitionTriggeredForSongRef.current = songId;
      loadedSongIdRef.current = nextSong.id;
      if (cf.enabled && cf.duration > 0 && g) {
        g.triggerCrossfadeTransition(cf.duration);
        activePlayerRef.current = g.getActivePlayer();
        audioRef.current = g.getActiveAudio();
      } else if (g) {
        g.triggerGaplessTransition();
        activePlayerRef.current = g.getActivePlayer();
        audioRef.current = g.getActiveAudio();
      } else {
        const from = activePlayerRef.current;
        const to: "A" | "B" = from === "A" ? "B" : "A";
        const fromAudio = from === "A" ? primaryAudioRef.current : secondaryAudioRef.current;
        const toAudio = to === "A" ? secondaryAudioRef.current : primaryAudioRef.current;
        activePlayerRef.current = to;
        if (toAudio) {
          audioRef.current = toAudio;
          toAudio.volume = volumeRef.current;
          applyPlaybackRate(toAudio);
          void toAudio.play().catch(() => {});
        }
        if (fromAudio) {
          fromAudio.pause();
          fromAudio.currentTime = 0;
        }
      }
      const newAudio = audioRef.current;
      const newDur = (newAudio && Number.isFinite(newAudio.duration) && newAudio.duration > 0)
        ? newAudio.duration
        : (nextSong.duration || 0);
      setDuration(newDur);
      onGaplessNextRef.current(nextSong);
      return;
    }

    // Standby no estaba listo o era de otra pista: avance estándar e impecable
    transitionTriggeredForSongRef.current = null;
    clearStandbyPlayer();
    if (graphRef.current) {
      graphRef.current.resetGains(activePlayerRef.current);
      if (graphRef.current.ctx.state !== "running") {
        void graphRef.current.resume().catch(() => {});
      }
    }
    onSongEndedRef.current?.();
  }, [clearStandbyPlayer, isStandbyReadyForSong, applyPlaybackRate, setDuration]);

  // Enlazar los eventos nativos de ambos elementos de audio
  useEffect(() => {
    const a1 = primaryAudioRef.current;
    const a2 = secondaryAudioRef.current;
    if (!a1 || !a2) return;

    if (!audioRef.current) {
      audioRef.current = a1;
    }

    const onTimeA = () => {
      if (audioRef.current === a1 || (!a1.paused && a2.paused)) {
        if (activePlayerRef.current !== "A") activePlayerRef.current = "A";
        if (audioRef.current !== a1) audioRef.current = a1;
        handleTimeUpdate(a1.currentTime);
      }
    };
    const onTimeB = () => {
      if (audioRef.current === a2 || (!a2.paused && a1.paused)) {
        if (activePlayerRef.current !== "B") activePlayerRef.current = "B";
        if (audioRef.current !== a2) audioRef.current = a2;
        handleTimeUpdate(a2.currentTime);
      }
    };

    const onMetaA = () => {
      if (audioRef.current === a1 || (!a1.paused && a2.paused)) {
        handleLoadedMetadata(a1.duration);
      }
    };
    const onMetaB = () => {
      if (audioRef.current === a2 || (!a2.paused && a1.paused)) {
        handleLoadedMetadata(a2.duration);
      }
    };

    const onEndA = () => {
      if (audioRef.current === a1 || (!a1.paused && a2.paused)) {
        handleEnded("A");
      }
    };
    const onEndB = () => {
      if (audioRef.current === a2 || (!a2.paused && a1.paused)) {
        handleEnded("B");
      }
    };

    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const onWaiting = () => {
      playbackPriority.setBuffering(true);
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        const cur = audioRef.current;
        if (cur && isPlayingRef.current) {
          if (graphRef.current && graphRef.current.ctx.state !== "running") {
            void graphRef.current.resume().catch(() => {});
          }
          void cur.play().catch(() => {});
        }
      }, 1000);
    };

    const onPlaying = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      playbackPriority.setBuffering(false);
      playbackPriority.reportPlaybackState(true, audioRef.current);
      if (graphRef.current && graphRef.current.ctx.state === "suspended") {
        void graphRef.current.resume().catch(() => {});
      }
    };
    const onPause = (e: Event) => {
      playbackPriority.reportPlaybackState(false, audioRef.current);
      if (isChangingTrackRef.current) return;
      const el = e.target as HTMLAudioElement;
      if (el === audioRef.current && isPlayingRef.current) {
        setTimeout(() => {
          if (isPlayingRef.current && el.paused && audioRef.current === el && !isChangingTrackRef.current) {
            if (graphRef.current && graphRef.current.ctx.state !== "running") {
              void graphRef.current.resume().catch(() => {});
            }
            void el.play().catch(() => {});
          }
        }, 120);
      }
    };
    const onCanPlay = (e: Event) => {
      playbackPriority.setBuffering(false);
      const el = e.target as HTMLAudioElement;
      if (el === audioRef.current) {
        if (graphRef.current && graphRef.current.ctx.state !== "running") {
          void graphRef.current.resume().catch(() => {});
        }
        if (isPlayingRef.current && el.paused) {
          void el.play().catch(() => {});
        }
        if (Number.isFinite(el.duration) && el.duration > 0 && (!durationRef.current || durationRef.current <= 0)) {
          handleLoadedMetadata(el.duration);
        }
        if (pendingSeekRef.current !== null && Number.isFinite(pendingSeekRef.current)) {
          try { el.currentTime = pendingSeekRef.current; } catch {}
          pendingSeekRef.current = null;
        }
      }
    };

    const onAudioError = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      console.warn("[AudioEngine] Error en elemento de audio:", el.error?.message || el.error?.code);
    };

    a1.addEventListener("timeupdate", onTimeA);
    a2.addEventListener("timeupdate", onTimeB);
    a1.addEventListener("loadedmetadata", onMetaA);
    a2.addEventListener("loadedmetadata", onMetaB);
    a1.addEventListener("ended", onEndA);
    a2.addEventListener("ended", onEndB);
    a1.addEventListener("waiting", onWaiting);
    a2.addEventListener("waiting", onWaiting);
    a1.addEventListener("playing", onPlaying);
    a2.addEventListener("playing", onPlaying);
    a1.addEventListener("pause", onPause);
    a2.addEventListener("pause", onPause);
    a1.addEventListener("canplay", onCanPlay);
    a2.addEventListener("canplay", onCanPlay);
    a1.addEventListener("error", onAudioError);
    a2.addEventListener("error", onAudioError);

    return () => {
      if (stallTimer) clearTimeout(stallTimer);
      a1.removeEventListener("timeupdate", onTimeA);
      a2.removeEventListener("timeupdate", onTimeB);
      a1.removeEventListener("loadedmetadata", onMetaA);
      a2.removeEventListener("loadedmetadata", onMetaB);
      a1.removeEventListener("ended", onEndA);
      a2.removeEventListener("ended", onEndB);
      a1.removeEventListener("waiting", onWaiting);
      a2.removeEventListener("waiting", onWaiting);
      a1.removeEventListener("playing", onPlaying);
      a2.removeEventListener("playing", onPlaying);
      a1.removeEventListener("pause", onPause);
      a2.removeEventListener("pause", onPause);
      a1.removeEventListener("canplay", onCanPlay);
      a2.removeEventListener("canplay", onCanPlay);
      a1.removeEventListener("error", onAudioError);
      a2.removeEventListener("error", onAudioError);
    };
  }, [handleTimeUpdate, handleLoadedMetadata, handleEnded]);

  // Ticker activo de alta precisión: garantiza que la barra de reproducción avance sin interrupciones
  useEffect(() => {
    if (!isPlaying) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTicker = () => {
      if (timer) clearInterval(timer);
      const intervalMs = (typeof document !== "undefined" && document.hidden) ? 500 : 150;
      timer = setInterval(() => {
        const a = audioRef.current;
        if (a && !a.paused && Number.isFinite(a.currentTime)) {
          handleTimeUpdate(a.currentTime);
        }
      }, intervalMs);
    };
    startTicker();
    const onVis = () => startTicker();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isPlaying, handleTimeUpdate]);

  const getCurrentTime = useCallback(() => {
    return audioRef.current?.currentTime ?? currentTimeRef.current;
  }, []);

  const seek = useCallback((targetSeconds: number) => {
    if (!Number.isFinite(targetSeconds) || targetSeconds < 0) return;
    const dur = durationRef.current;
    const safeTime = dur > 0 ? Math.min(targetSeconds, dur) : targetSeconds;

    currentTimeRef.current = safeTime;
    timeListenersRef.current.forEach((listener) => listener());

    const audio = audioRef.current;
    if (audio && audio.readyState >= 1) {
      try {
        audio.currentTime = safeTime;
      } catch (e) {
        pendingSeekRef.current = safeTime;
      }
    } else {
      pendingSeekRef.current = safeTime;
    }
  }, []);

  useEffect(() => {
    if (needsGraph) ensureGraph();
  }, [needsGraph, ensureGraph]);

  useEffect(() => {
    [primaryAudioRef.current, secondaryAudioRef.current].forEach(a => {
      if (a) applyPlaybackRate(a);
    });

    graphRef.current?.applySettings(settings);
  }, [
    settings.playbackRate?.rate,
    settings.playbackRate?.preservePitch,
    settings.playbackRate?.reverbWet,
    settings.eq,
    settings.normalizer,
    settings.crossfade,
    graphVersion,
    applyPlaybackRate
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) {
      graph.setVolume(volume);
    } else {
      if (primaryAudioRef.current) primaryAudioRef.current.volume = volume;
      if (secondaryAudioRef.current) secondaryAudioRef.current.volume = volume;
    }
  }, [volume, graphVersion]);

  useEffect(() => () => { unsubscribeGraphRef.current?.(); }, []);

  // Nueva canción => reiniciar análisis de sonoridad y banderas de transición
  useEffect(() => {
    const id = currentSong?.id ?? null;
    songIdRef.current = id;
    if (loadedSongIdRef.current !== id) {
      clearStandbyPlayer();
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
  }, [currentSong?.id, currentSong?.duration, setDuration, clearStandbyPlayer]);

  // Auto-recuperación ante cortes esporádicos de red
  const retryCountRef = useRef(0);
  const lastRetryTimeRef = useRef(0);

  const handlePlaybackError = useCallback((el: HTMLAudioElement) => {
    const song = currentSong;
    const url = resolvedAudioUrl;
    if (!song || !url || !isPlaying) return;

    const now = Date.now();
    if (now - lastRetryTimeRef.current > 15000) {
      retryCountRef.current = 0;
    }
    lastRetryTimeRef.current = now;

    if (retryCountRef.current < 3) {
      retryCountRef.current += 1;
      const saveTime = Math.max(0, el.currentTime - 0.2);
      console.warn(`[AudioEngine] Auto-recuperando audio tras corte (intento ${retryCountRef.current}/3) en ${saveTime.toFixed(1)}s`);

      setTimeout(() => {
        if (audioRef.current === el && isPlaying) {
          el.pause();
          el.src = url;
          applyPlaybackRate(el);
          el.load();
          const onRecoverCanPlay = () => {
            el.removeEventListener("canplay", onRecoverCanPlay);
            try { el.currentTime = saveTime; } catch {}
            applyPlaybackRate(el);
            if (graphRef.current && graphRef.current.ctx.state !== "running") {
              void graphRef.current.resume().catch(() => {});
            }
            void el.play().catch(() => {});
          };
          el.addEventListener("canplay", onRecoverCanPlay, { once: true });
        }
      }, 400);
    }
  }, [currentSong, resolvedAudioUrl, isPlaying, applyPlaybackRate]);

  // Carga y reproducción controlada
  useEffect(() => {
    let audio = audioRef.current;
    if (!audio) {
      audio = activePlayerRef.current === "A" ? primaryAudioRef.current : secondaryAudioRef.current;
      if (audio) audioRef.current = audio;
    }

    if (!audio || !currentSong || !resolvedAudioUrl) {
      return;
    }

    let canPlayHandler: (() => void) | null = null;
    let errorHandler: (() => void) | null = null;

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

      applyPlaybackRate(audio);

      if (pendingSeekRef.current !== null && Number.isFinite(pendingSeekRef.current) && audio.readyState >= 1) {
        try { audio.currentTime = pendingSeekRef.current; } catch (e) {}
        pendingSeekRef.current = null;
      }

      if (isPlayingRef.current) {
        if (audio.paused) {
          try {
            await audio.play();
          } catch (e: any) {
            if (e?.name === "NotAllowedError") {
              console.warn("Autoplay bloqueado: requiere interacción del usuario");
              setIsPlaying(false);
            } else if (e?.name === "AbortError") {
              // Play interrumpido por cambio de buffer/red; reintentar cuando los datos lleguen
              if (isPlayingRef.current) {
                const onReadyRetry = () => {
                  audio.removeEventListener("canplay", onReadyRetry);
                  audio.removeEventListener("loadeddata", onReadyRetry);
                  if (isPlayingRef.current && audio.paused) {
                    void audio.play().catch(() => {});
                  }
                };
                audio.addEventListener("canplay", onReadyRetry, { once: true });
                audio.addEventListener("loadeddata", onReadyRetry, { once: true });
              }
            } else {
              console.error("Playback failed", e);
            }
          }
        }
      }
    };

    const isDifferentSong = loadedSongIdRef.current !== currentSong.id;
    const isDifferentUrl = !isSameAudioSource(audio.src, resolvedAudioUrl);
    const needsNewTrackLoad = isDifferentSong || isDifferentUrl;

    if (needsNewTrackLoad) {
      const g = graphRef.current;
      const standbyAudio = g ? g.getStandbyAudio() : (activePlayerRef.current === "A" ? secondaryAudioRef.current : primaryAudioRef.current);
      if (standbyAudio && isStandbyReadyForSong(standbyAudio, currentSong)) {
        // Standby ya tiene esta canción lista. Cambio instantáneo sin silencios ni recargas
        loadedSongIdRef.current = currentSong.id;
        standbyPreloadedTrackRef.current = null;
        standbyPreloadedForSongRef.current = null;
        transitionTriggeredForSongRef.current = null;
        nextTrackCandidateRef.current = null;

        if (g) {
          g.triggerGaplessTransition();
          activePlayerRef.current = g.getActivePlayer();
          audioRef.current = g.getActiveAudio();
        } else {
          const from = activePlayerRef.current;
          const to: "A" | "B" = from === "A" ? "B" : "A";
          const fromAudio = from === "A" ? primaryAudioRef.current : secondaryAudioRef.current;
          const toAudio = to === "A" ? secondaryAudioRef.current : primaryAudioRef.current;
          activePlayerRef.current = to;
          if (toAudio) {
            audioRef.current = toAudio;
            toAudio.volume = volumeRef.current;
            applyPlaybackRate(toAudio);
            void toAudio.play().catch(() => {});
          }
          if (fromAudio) {
            fromAudio.pause();
            fromAudio.currentTime = 0;
          }
        }

        const newAudio = audioRef.current;
        const newDur = (newAudio && Number.isFinite(newAudio.duration) && newAudio.duration > 0)
          ? newAudio.duration
          : (currentSong.duration || 0);
        setDuration(newDur);

        if (pendingSeekRef.current !== null && Number.isFinite(pendingSeekRef.current) && newAudio && newAudio.readyState >= 1) {
          try { newAudio.currentTime = pendingSeekRef.current; } catch (e) {}
          pendingSeekRef.current = null;
        }

        if (isPlaying && newAudio && newAudio.paused) {
          void newAudio.play().catch(() => {});
        }
        return;
      }

      loadedSongIdRef.current = currentSong.id;
      transitionTriggeredForSongRef.current = null;
      nextTrackCandidateRef.current = null;
      clearStandbyPlayer();

      const songDur = (Number.isFinite(currentSong.duration) && currentSong.duration > 0)
        ? currentSong.duration
        : 0;
      setDuration(songDur);

      isChangingTrackRef.current = true;
      audio.pause();
      currentTimeRef.current = 0;

      // Asegurar que las ganancias del reproductor activo estén calibradas
      if (graphRef.current) {
        graphRef.current.resetGains(activePlayerRef.current);
        if (graphRef.current.ctx.state !== "running") {
          void graphRef.current.resume().catch(() => {});
        }
      }

      applyPlaybackRate(audio);
      audio.src = resolvedAudioUrl;
      audio.load();
      isChangingTrackRef.current = false;

      // INMEDIATO: Iniciar reproducción sin esperar a canplay para que el navegador
      // asigne decodificadores y buffers de inmediato sin quedarse congelado
      if (isPlaying) {
        startPlayback();
      }

      canPlayHandler = () => {
        applyPlaybackRate(audio);
        if (pendingSeekRef.current !== null && Number.isFinite(pendingSeekRef.current)) {
          try { audio.currentTime = pendingSeekRef.current; } catch (e) {}
          pendingSeekRef.current = null;
        }
        if (isPlayingRef.current) {
          startPlayback();
        }

        if (canPlayHandler) {
          audio.removeEventListener("canplay", canPlayHandler);
          audio.removeEventListener("loadeddata", canPlayHandler);
        }
      };

      errorHandler = () => {
        console.warn("Error cargando pista de audio, reseteando referencia:", audio.error);
        loadedSongIdRef.current = null;
        handlePlaybackError(audio);
      };

      audio.addEventListener("canplay", canPlayHandler);
      audio.addEventListener("loadeddata", canPlayHandler);
      audio.addEventListener("error", errorHandler, { once: true });
    } else {
      applyPlaybackRate(audio);
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
    setIsPlaying,
    clearStandbyPlayer,
    applyPlaybackRate,
    handlePlaybackError,
    needsGraph,
    ensureGraph,
    setDuration,
    isStandbyReadyForSong,
    currentSong?.duration,
  ]);


  // SUPERVISOR DE REPRODUCCIÓN (Watchdog):
  // Si la app está en modo reproducción (isPlaying === true), pero por cualquier motivo
  // del navegador/red el elemento de audio se quedó en pausa tras un cambio de pista,
  // lo detecta automáticamente en menos de 350 ms y reanuda el audio sin que el usuario
  // tenga que darle a pausa y play manualmente.
  useEffect(() => {
    if (!isPlaying) return;

    const watchdog = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;

      if (isPlayingRef.current && !isChangingTrackRef.current) {
        if (audio.paused && audio.readyState >= 1) {
          if (graphRef.current && graphRef.current.ctx.state !== "running") {
            void graphRef.current.resume().catch(() => {});
          }
          void audio.play().catch((err: any) => {
            if (err?.name === "NotAllowedError") {
              setIsPlaying(false);
            }
          });
        }
      }
    }, 350);

    return () => clearInterval(watchdog);
  }, [isPlaying, setIsPlaying]);

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
    seek,

    duration,
    setDuration,
  };
}
