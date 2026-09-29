import { useState, useEffect, useRef, useCallback, MutableRefObject } from "react";
import { io, Socket } from "socket.io-client";
import { Song } from "../constants";

export type SessionMember = { userId: string; username: string; avatar: string | null; isHost: boolean };
export type JoinResult = { ok: boolean; error?: string; members?: number };

const SOCKET_URL = "https://aura.basildo.me";
// Cuánto puede desviarse el audio local respecto al de la sesión antes de saltar.
const DRIFT_TOLERANCE = 1.5;

export function useSocketLogic(
  user: any,
  handlePlaySongRef: any,
  setIsPlaying: any,
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  setActiveQueue: any
) {
  const socketRef = useRef<Socket | null>(null);
  const [currentSession, setCurrentSessionState] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [sessionMembers, setSessionMembers] = useState<SessionMember[]>([]);
  const [unreadSenders, setUnreadSenders] = useState<string[]>([]);
  const [activeInvite, setActiveInvite] = useState<{from: string, code: string} | null>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<Song[]>([]);
  const [isLoop, setIsLoop] = useState(false);

  // Refs para que los listeners del socket (que se crean UNA sola vez) siempre
  // vean el valor actual y no el de la primera render.
  const currentSongIdRef = useRef<string | null>(null);
  const userRef = useRef<any>(user);
  const sessionRef = useRef<string | null>(null);
  const settersRef = useRef({ setIsPlaying, setActiveQueue });
  // "Líder" = el último que tocó un control (play, seek, siguiente...). Solo el
  // líder envía el latido de sincronización; si lo enviaran todos, se estarían
  // corrigiendo entre ellos y la música saltaría constantemente.
  const isLeaderRef = useRef(false);

  userRef.current = user;
  settersRef.current = { setIsPlaying, setActiveQueue };

  const setCurrentSession = useCallback((code: string | null) => {
    sessionRef.current = code;
    setCurrentSessionState(code);
  }, []);

  // Aplica el estado de la sesión (canción, posición, cola, shuffle, loop).
  const applyState = useCallback((state: any) => {
    if (!state) return;
    const { setIsPlaying, setActiveQueue } = settersRef.current;

    if (typeof state.isShuffle === "boolean") setIsShuffle(state.isShuffle);
    if (Array.isArray(state.shuffledQueue)) setShuffledQueue(state.shuffledQueue);
    if (typeof state.isLoop === "boolean") setIsLoop(state.isLoop);
    if (Array.isArray(state.queue) && state.queue.length) setActiveQueue(state.queue);

    if (!state.song?.id) return;
    const position = Number(state.position) || 0;

    if (currentSongIdRef.current === state.song.id) {
      const audio = audioRef.current;
      if (audio && Math.abs(audio.currentTime - position) > DRIFT_TOLERANCE) {
        audio.currentTime = position;
      }
      setIsPlaying(!!state.isPlaying);
    } else {
      currentSongIdRef.current = state.song.id;
      handlePlaySongRef.current?.(state.song, true, position);
      if (!state.isPlaying) setIsPlaying(false);
    }
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      if (userRef.current) socket.emit("identify", userRef.current.userId);

      // Tras una reconexión (red inestable, reinicio del servidor...) el servidor
      // ha olvidado en qué salas estábamos: hay que volver a entrar y ponerse al día.
      const code = sessionRef.current;
      if (code) {
        socket.emit("join-session", { code, user: userRef.current }, (res: any) => {
          if (res?.ok) { applyState(res.state); if (res.membersList) setSessionMembers(res.membersList); }
          else if (res?.error === "SESSION_NOT_FOUND") setCurrentSession(null);
        });
      }
    });

    socket.on("receive-command", ({ command, data }) => {
      if (command !== "sync-time") isLeaderRef.current = false;

      if (command === "play-track") {
        if (data.queue) settersRef.current.setActiveQueue(data.queue);
        if (data.song?.id) {
          if (currentSongIdRef.current === data.song.id) {
            // Misma canción: solo era una actualización de la cola. NO hay que
            // llamar a handlePlaySong, que en ese caso alterna play/pausa.
            const audio = audioRef.current;
            const pos = Number(data.position) || 0;
            if (audio && Math.abs(audio.currentTime - pos) > DRIFT_TOLERANCE) audio.currentTime = pos;
          } else {
            currentSongIdRef.current = data.song.id;
            handlePlaySongRef.current?.(data.song, true, Number(data.position) || 0);
          }
        }
      }

      if (command === "sync-time") {
        const audio = audioRef.current;
        if (audio && data.songId === currentSongIdRef.current) {
          if (Math.abs(audio.currentTime - data.position) > DRIFT_TOLERANCE) {
            audio.currentTime = data.position;
          }
        }
      }

      if (command === "toggle-play") settersRef.current.setIsPlaying(data.isPlaying);

      if (command === "toggle-shuffle") {
        setIsShuffle(data.isShuffle);
        if (data.shuffledQueue) setShuffledQueue(data.shuffledQueue);
      }

      if (command === "toggle-loop") setIsLoop(data.isLoop);

      if (command === "seek" && audioRef.current) {
        audioRef.current.currentTime = data.time;
      }
    });

    socket.on("receive-chat", (chat) => setSessionMessages(prev => [...prev, chat]));
    socket.on("session-members", ({ code, members }: { code: string; members: SessionMember[] }) => {
      if (code === sessionRef.current) setSessionMembers(members);
    });
    socket.on("receive-private-message", (msg) => {
      setUnreadSenders(prev => [...new Set([...prev, String(msg.sender_id)])]);
    });
    socket.on("receive-session-invite", (invite) => setActiveInvite(invite));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    if (user && socketRef.current) socketRef.current.emit("identify", user.userId);
  }, [user]);

  // Entra en una sesión. Solo se marca como "dentro" si el servidor confirma
  // que el código existe (antes se marcaba siempre, aunque fuese inválido).
  const joinSession = useCallback((rawCode: string, opts: { asLeader?: boolean } = {}): Promise<JoinResult> => {
    return new Promise((resolve) => {
      const code = (rawCode || "").trim().toUpperCase();
      const socket = socketRef.current;
      if (!code) return resolve({ ok: false, error: "INVALID_CODE" });
      if (!socket) return resolve({ ok: false, error: "NO_SOCKET" });

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: "TIMEOUT" });
      }, 10000);

      // Si el socket aún se está conectando, socket.io guarda el emit y lo envía al conectar.
      socket.emit("join-session", { code, user: userRef.current }, (res: any) => {
        if (settled) {
          // Llegó tarde: si ya no nos interesa, salimos de la sala.
          if (res?.ok && sessionRef.current !== code) socket.emit("leave-session", { code });
          return;
        }
        settled = true;
        clearTimeout(timer);

        if (!res?.ok) return resolve({ ok: false, error: res?.error || "SERVER_ERROR" });

        // Si estaba en otra sesión, la dejo.
        if (sessionRef.current && sessionRef.current !== code) {
          socket.emit("leave-session", { code: sessionRef.current });
        }
        if (sessionRef.current !== code) setSessionMessages([]);
        setCurrentSession(code);
        isLeaderRef.current = !!opts.asLeader;
        if (res.membersList) setSessionMembers(res.membersList);
        applyState(res.state);
        resolve({ ok: true, members: res.members });
      });
    });
  }, []);

  const leaveSession = useCallback(() => {
    const code = sessionRef.current;
    if (code) socketRef.current?.emit("leave-session", { code });
    isLeaderRef.current = false;
    setCurrentSession(null);
    setSessionMessages([]);
    setSessionMembers([]);
  }, []);

  // Pide el estado actual y corrige solo la posición (no toca play/pausa).
  const resyncSession = useCallback(() => {
    const code = sessionRef.current;
    if (!code) return;
    socketRef.current?.emit("get-session-state", { code }, (res: any) => {
      const st = res?.state;
      const audio = audioRef.current;
      if (!st?.song?.id || !audio || st.song.id !== currentSongIdRef.current) return;
      if (Math.abs(audio.currentTime - st.position) > DRIFT_TOLERANCE) audio.currentTime = st.position;
    });
  }, []);

  const emitCommand = (command: string, data: any) => {
    const code = sessionRef.current;
    if (!code) return;
    if (command === "sync-time") {
      if (!isLeaderRef.current) return; // solo el líder emite el latido
    } else {
      isLeaderRef.current = true;
    }
    socketRef.current?.emit("send-command", {
      code,
      command,
      data: { ...data, sentAt: Date.now() }
    });
  };

  // Helper to keep track of the ID for sync-time
  const setTrackId = (id: string | null) => { currentSongIdRef.current = id; };
  const getTrackId = () => currentSongIdRef.current;
  const isLeader = () => isLeaderRef.current;

  return {
    socketRef, currentSession, setCurrentSession, sessionMessages, setSessionMessages, sessionMembers,
    unreadSenders, setUnreadSenders, activeInvite, setActiveInvite, emitCommand,
    isShuffle, setIsShuffle, shuffledQueue, setShuffledQueue, isLoop, setIsLoop,
    setTrackId, getTrackId, isLeader, joinSession, leaveSession, resyncSession
  };
}
