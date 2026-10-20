import { useState, useEffect, useRef, useCallback, useSyncExternalStore, } from "react";
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
  visualizerActive = false
) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const graphRef = useRef<AudioGraph | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const statusListenersRef = useRef(new Set<() => void>());
  const unsubscribeGraphRef = useRef<(() => void) | null>(null);
  // Se incrementa al crear el grafo para que los componentes que leen
  // analyserRef.current (visualizador) se vuelvan a renderizar.
  const [graphVersion, setGraphVersion] = useState(0);

  // Valores "vivos" para que ensureGraph no dependa de ellos.
  const volumeRef = useRef(volume);
  const settingsRef = useRef(settings);
  const songIdRef = useRef<string | null>(null);
  volumeRef.current = volume;
  settingsRef.current = settings;

  const needsGraph =
    settings.normalizer.enabled ||
    settings.eq.enabled ||
    settings.crossfade.enabled ||
    visualizerActive;

  const currentTimeRef = useRef(0);
  // Posición (s) a aplicar cuando termine de cargar la próxima canción.
  // Fijar audio.currentTime antes de cambiar el src no sirve: load() lo resetea a 0.
  const pendingSeekRef = useRef<number | null>(null);
  const timeListenersRef = useRef(new Set<() => void>());
  const crossfadeTriggeredForSongRef = useRef<string | null>(null);
  const onCrossfadeNextRef = useRef<((commitCrossfade: () => void) => void) | null>(null);
  const durationRef = useRef(0);

  const [duration, setDurationState] = useState(0);

  const setDuration = useCallback((d: number) => {
    durationRef.current = d;
    setDurationState(d);
    graphRef.current?.setDuration(d);
  }, []);

  const notifyStatus = useCallback(() => {
    statusListenersRef.current.forEach((l) => l());
  }, []);

  // El grafo (normalizador + ecualizador + crossfade) solo se crea cuando alguna
  // de las funciones está activa. Una vez creado se queda (solo puede crearse
  // una vez por elemento) y "desactivado" significa pasar la señal sin tocarla.
  const ensureGraph = useCallback((): AudioGraph | null => {
    const audio = audioRef.current;
    if (graphRef.current) return graphRef.current;
    if (!audio) return null;

    const graph = getOrCreateGraph(audio);
    if (!graph) return null;

    graphRef.current = graph;
    analyserRef.current = graph.analyser;
    graph.setVolume(volumeRef.current);
    graph.applySettings(settingsRef.current);
    graph.beginTrack(songIdRef.current);
    if (Number.isFinite(audio.duration)) graph.setDuration(audio.duration);
    unsubscribeGraphRef.current = graph.subscribeStatus(notifyStatus);
    void graph.resume().catch(() => {});

    setGraphVersion((v) => v + 1);
    notifyStatus();
    return graph;
  }, [notifyStatus]);

  const loadedSongIdRef = useRef<string | null>(null);

  const handleTimeUpdate = useCallback((time: number) => {
    currentTimeRef.current = time;

    timeListenersRef.current.forEach((listener) => {
      listener();
    });

    const cf = settingsRef.current.crossfade;
    const songId = songIdRef.current;
    const dur = durationRef.current;
    const audio = audioRef.current;

    if (
      cf.enabled &&
      cf.duration > 0 &&
      songId &&
      crossfadeTriggeredForSongRef.current !== songId &&
      audio &&
      !audio.paused &&
      !audio.seeking &&
      Number.isFinite(dur) &&
      dur > cf.duration * 2
    ) {
      const remaining = dur - time;
      const outgoingSrc = audio.currentSrc || audio.src;
      // Preparamos el reproductor de cola solo cuando faltan pocos segundos para el crossfade,
      // nunca en el segundo 0 para no competir por el ancho de banda al arrancar la canción.
      if (outgoingSrc && remaining <= cf.duration + 12 && remaining > cf.duration) {
        graphRef.current?.prepareTail(outgoingSrc);
      }
      if (remaining > 0.2 && remaining <= cf.duration) {
        if (outgoingSrc && onCrossfadeNextRef.current) {
          crossfadeTriggeredForSongRef.current = songId;
          onCrossfadeNextRef.current(() => {
            const g = ensureGraph();
            g?.startCrossfade(outgoingSrc, time, cf.duration);
          });
        }
      }
    }
  }, [ensureGraph]);

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

  // Nueva canción => el analizador empieza de cero (o arranca con la ganancia
  // guardada). Va aparte de la lógica de src porque React ya asigna el src
  // del <audio> por JSX antes de que esa lógica compare URLs.
  useEffect(() => {
    const id = currentSong?.id ?? null;
    songIdRef.current = id;
    crossfadeTriggeredForSongRef.current = null;
    const graph = graphRef.current;
    if (!graph) return;
    graph.beginTrack(id);
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1 && Number.isFinite(audio.duration)) graph.setDuration(audio.duration);
  }, [currentSong?.id]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentSong || !resolvedAudioUrl) {
      return;
    }

    let canPlayHandler: (() => void) | null = null;

    const startPlayback = async () => {
      if (needsGraph) ensureGraph();

      // Con el grafo creado el audio SIEMPRE pasa por él (aunque las
      // funciones estén desactivadas), así que el contexto tiene que estar
      // en marcha o no se oiría nada.
      const graph = graphRef.current;
      if (graph) {
        try {
          await graph.resume();
        } catch (e) {
          console.error("Error resuming AudioContext:", e);
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

    const isDifferentSong = loadedSongIdRef.current !== currentSong.id;
    const needsNewTrackLoad = isDifferentSong || !audio.src;

    let errorHandler: (() => void) | null = null;

    if (needsNewTrackLoad) {
      loadedSongIdRef.current = currentSong.id;
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

      errorHandler = () => {
        console.warn("Error en reproducción de audio, reseteando referencia de canción:", audio.error);
        loadedSongIdRef.current = null;
      };

      audio.addEventListener("canplay", canPlayHandler);
      audio.addEventListener("error", errorHandler, { once: true });
    } else {
      if (isPlaying) {
        startPlayback();
      } else {
        audio.pause();
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