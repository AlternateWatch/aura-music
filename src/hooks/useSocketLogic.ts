import { useState, useEffect, useRef, useCallback, MutableRefObject } from "react";
import { io, Socket } from "socket.io-client";
import { Song } from "../constants";

export type SessionMember = { userId: string; username: string; avatar: string | null; isHost: boolean };
export type JoinResult = { ok: boolean; error?: string; members?: number };

const getSocketUrl = () => {
  if (typeof window !== "undefined") {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:${window.location.port || 3000}`;
    }
  }
  return "https://aura.basildo.me";
};

// Cuánto puede desviarse el audio local respecto al de la sesión antes de saltar.
const DRIFT_TOLERANCE = 1.5;

// Limpia campos pesados (como letras o lore) para que los paquetes de Socket.IO sean ligeros y nunca se descarten.
const stripSongForSocket = (song: any): any => {
  if (!song || typeof song !== "object") return song;
  const { lyrics, lore_data, ...rest } = song;
  return rest;
};

const trimQueueForSocket = (queue: any[], currentSongId?: string | null, maxItems = 80): any[] => {
  if (!Array.isArray(queue) || queue.length === 0) return [];
  let sliced = queue;
  if (queue.length > maxItems) {
    const idx = currentSongId
      ? queue.findIndex((s) => String(s?.id) === String(currentSongId))
      : 0;
    const start = Math.max(0, (idx >= 0 ? idx : 0) - 10);
    sliced = queue.slice(start, start + maxItems);
  }
  return sliced.map(stripSongForSocket);
};

export function useSocketLogic(
  user: any,
  handlePlaySongRef: any,
  setIsPlaying: any,
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  setActiveQueue: any,
  currentSong?: Song | null,
  isPlaying?: boolean
) {
  const socketRef = useRef<Socket | null>(null);
  const [currentSession, setCurrentSessionState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("aura_active_session") || null;
  });
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [sessionMembers, setSessionMembers] = useState<SessionMember[]>([]);
  const [unreadSenders, setUnreadSenders] = useState<string[]>([]);
  const [activeInvite, setActiveInvite] = useState<{from: string, code: string} | null>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<Song[]>([]);
  const [isLoop, setIsLoop] = useState(false);
  const [sessionVotes, setSessionVotes] = useState<Record<string, string[]>>({});
  const [liveReactions, setLiveReactions] = useState<Array<{ id: string; emoji: string; username: string }>>([]);

  // Refs sincronizadas con el estado actual de App.tsx
  const currentSongIdRef = useRef<string | null>(currentSong?.id ? String(currentSong.id) : null);
  const currentSongRef = useRef<Song | null>(currentSong ?? null);
  const isPlayingRef = useRef<boolean>(!!isPlaying);
  const userRef = useRef<any>(user);
  const sessionRef = useRef<string | null>(currentSession);
  const settersRef = useRef({ setIsPlaying, setActiveQueue });
  const isShuffleRef = useRef(isShuffle);
  // Solo el anfitrión de la sesión tiene isLeaderRef = true.
  const isLeaderRef = useRef(false);

  userRef.current = user;
  settersRef.current = { setIsPlaying, setActiveQueue };
  isShuffleRef.current = isShuffle;
  currentSongRef.current = currentSong ?? null;
  isPlayingRef.current = !!isPlaying;

  useEffect(() => {
    currentSongIdRef.current = currentSong?.id ? String(currentSong.id) : null;
  }, [currentSong?.id]);

  // Si el anfitrión cambia play/pause desde controles externos (notificación Android, teclas multimedia, etc.),
  // propagar de inmediato a la sesión además del latido de 3s.
  useEffect(() => {
    if (!sessionRef.current || !isLeaderRef.current || !socketRef.current) return;
    if (!currentSongRef.current?.id) return;
    socketRef.current.emit("sync-command", {
      code: sessionRef.current,
      command: "sync-time",
      data: {
        songId: String(currentSongRef.current.id),
        song: stripSongForSocket(currentSongRef.current),
        position: audioRef.current?.currentTime || 0,
        isPlaying: !!isPlaying
      }
    });
  }, [isPlaying]);

  const getMyUserId = () => String(userRef.current?.userId ?? userRef.current?.id ?? "");

  const updateLeaderFromMembers = useCallback((members?: SessionMember[]) => {
    if (!Array.isArray(members)) return;
    const myId = getMyUserId();
    if (!myId) return;
    const me = members.find((m) => String(m.userId) === myId);
    if (me) {
      isLeaderRef.current = !!me.isHost;
    }
  }, []);

  const setCurrentSession = useCallback((code: string | null) => {
    sessionRef.current = code;
    setCurrentSessionState(code);
    if (code) {
      sessionStorage.setItem("aura_active_session", code);
    } else {
      sessionStorage.removeItem("aura_active_session");
    }
  }, []);

  // Aplica el estado de la sesión y sobreescribe cualquier canción que el usuario estuviera escuchando.
  const applyState = useCallback((state: any) => {
    if (!state) return;
    const { setIsPlaying, setActiveQueue } = settersRef.current;

    if (typeof state.isShuffle === "boolean") setIsShuffle(state.isShuffle);
    if (Array.isArray(state.shuffledQueue)) setShuffledQueue(state.shuffledQueue);
    if (typeof state.isLoop === "boolean") setIsLoop(state.isLoop);
    if (Array.isArray(state.queue) && state.queue.length) setActiveQueue(state.queue);
    if (state.votes && typeof state.votes === "object") setSessionVotes(state.votes);

    if (!state.song?.id) return;
    const position = Number(state.position) || 0;
    const targetId = String(state.song.id);
    const shouldPlay = state.isPlaying !== undefined ? !!state.isPlaying : true;

    currentSongIdRef.current = targetId;
    handlePlaySongRef.current?.(state.song, true, position, true, null, shouldPlay);
    setIsPlaying(shouldPlay);
  }, []);

  useEffect(() => {
    const socket = io(getSocketUrl(), {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      const uid = getMyUserId();
      if (uid) socket.emit("identify", uid);

      // Si ya estábamos en una sesión (o tras recargar/reconectar), volver a entrar y sincronizar.
      const code = sessionRef.current;
      if (code) {
        socket.emit("join-session", { code, user: userRef.current }, (res: any) => {
          if (res?.ok) {
            if (res.membersList) {
              setSessionMembers(res.membersList);
              updateLeaderFromMembers(res.membersList);
            }
            if (!isLeaderRef.current) {
              applyState(res.state);
            }
          } else if (res?.error === "SESSION_NOT_FOUND") {
            setCurrentSession(null);
          }
        });
      }
    });

    socket.on("receive-command", ({ command, data }) => {
      if (command === "update-queue") {
        if (Array.isArray(data?.queue)) {
          settersRef.current.setActiveQueue(data.queue);
          if (Array.isArray(data.shuffledQueue)) {
            setShuffledQueue(data.shuffledQueue);
          } else if (isShuffleRef.current) {
            setShuffledQueue(data.queue);
          }
        }
      }

      if (command === "play-track") {
        if (Array.isArray(data?.queue) && data.queue.length > 0) {
          settersRef.current.setActiveQueue(data.queue);
        }
        if (data?.song?.id) {
          const pos = Number(data.position) || 0;
          const shouldPlay = data.isPlaying !== undefined ? !!data.isPlaying : true;
          currentSongIdRef.current = String(data.song.id);
          // Sobreescribir inmediatamente lo que sea que el miembro estuviera escuchando
          handlePlaySongRef.current?.(data.song, true, pos, true, null, shouldPlay);
          settersRef.current.setIsPlaying(shouldPlay);
        }
      }

      if (command === "sync-time") {
        const incomingId = data?.songId ?? data?.song?.id;
        const pos = Number(data?.position) || 0;

        // Si el anfitrión está reproduciendo otra canción distinta a la que tenemos puesta, sobreescribir automáticamente
        if (incomingId && String(incomingId) !== String(currentSongIdRef.current)) {
          if (data?.song?.id) {
            const shouldPlay = data.isPlaying !== undefined ? !!data.isPlaying : true;
            currentSongIdRef.current = String(data.song.id);
            handlePlaySongRef.current?.(data.song, true, pos, true, null, shouldPlay);
            settersRef.current.setIsPlaying(shouldPlay);
          } else if (sessionRef.current) {
            socket.emit("get-session-state", { code: sessionRef.current }, (res: any) => {
              if (res?.state?.song?.id) applyState(res.state);
            });
          }
          return;
        }

        const audio = audioRef.current;
        if (audio && incomingId && String(incomingId) === String(currentSongIdRef.current)) {
          if (typeof data.isPlaying === "boolean" && data.isPlaying !== isPlayingRef.current) {
            settersRef.current.setIsPlaying(data.isPlaying);
          }
          if (Math.abs(audio.currentTime - pos) > DRIFT_TOLERANCE) {
            audio.currentTime = pos;
          }
        }
      }

      if (command === "toggle-play") {
        const shouldPlay = !!data?.isPlaying;
        // Si el anfitrión le da a Play en una canción distinta a la que el invitado estaba escuchando, sobreescribirla
        if (shouldPlay && data?.song?.id && String(data.song.id) !== String(currentSongIdRef.current)) {
          const pos = Number(data.position) || 0;
          currentSongIdRef.current = String(data.song.id);
          handlePlaySongRef.current?.(data.song, true, pos, true, null, true);
          settersRef.current.setIsPlaying(true);
        } else {
          settersRef.current.setIsPlaying(shouldPlay);
          if (data?.position !== undefined && audioRef.current) {
            const pos = Number(data.position) || 0;
            if (Math.abs(audioRef.current.currentTime - pos) > DRIFT_TOLERANCE) {
              audioRef.current.currentTime = pos;
            }
          }
        }
      }

      if (command === "toggle-shuffle") {
        setIsShuffle(!!data?.isShuffle);
        if (Array.isArray(data?.shuffledQueue)) setShuffledQueue(data.shuffledQueue);
      }

      if (command === "toggle-loop") setIsLoop(!!data?.isLoop);

      if (command === "seek" && audioRef.current) {
        audioRef.current.currentTime = Number(data?.time) || 0;
      }
    });

    // HEARTBEAT: El anfitrión envía el estado y tiempo actual cada 3 segundos para mantener a todos sincronizados
    const heartbeatInterval = setInterval(() => {
      if (isLeaderRef.current && sessionRef.current && audioRef.current && currentSongRef.current) {
        emitCommand("sync-time", {
          songId: String(currentSongRef.current.id),
          song: stripSongForSocket(currentSongRef.current),
          position: audioRef.current.currentTime,
          isPlaying: !audioRef.current.paused
        });
      }
    }, 3000);

    socket.on("receive-chat", (chat) => setSessionMessages(prev => [...prev, chat]));
    socket.on("receive-reaction", ({ messageId, userId, reaction }) => {
      setSessionMessages(prev => {
        return prev.map(msg => {
          if (msg.id === messageId) {
            const reactions = msg.reactions || {};
            const userReactions = reactions[userId] || [];
            const newReactions = userReactions.includes(reaction)
              ? userReactions.filter((r: string) => r !== reaction)
              : [...userReactions, reaction];
            return { ...msg, reactions: { ...reactions, [userId]: newReactions } };
          }
          return msg;
        });
      });
    });
    socket.on("session-members", ({ code, members }: { code: string; members: SessionMember[] }) => {
      if (code !== sessionRef.current) return;
      setSessionMembers(members);
      updateLeaderFromMembers(members);
    });
    socket.on("session-votes-updated", ({ votes, queue, shuffledQueue }) => {
      if (votes && typeof votes === "object") {
        setSessionVotes(votes);
      }
      if (Array.isArray(queue) && queue.length > 0) {
        settersRef.current.setActiveQueue(queue);
        if (Array.isArray(shuffledQueue) && shuffledQueue.length > 0) {
          setShuffledQueue(shuffledQueue);
        } else if (isShuffleRef.current) {
          setShuffledQueue(queue);
        }
      }
    });
    socket.on("receive-live-reaction", (item: { id: string; emoji: string; username: string }) => {
      if (!item || !item.emoji) return;
      const reactionItem = {
        id: item.id || `${Date.now()}_${Math.random()}`,
        emoji: item.emoji,
        username: item.username || "Alguien"
      };
      setLiveReactions(prev => [...prev.slice(-18), reactionItem]);
      setTimeout(() => {
        setLiveReactions(prev => prev.filter(r => r.id !== reactionItem.id));
      }, 3200);
    });
    socket.on("receive-private-message", (msg) => {
      setUnreadSenders(prev => [...new Set([...prev, String(msg.sender_id)])]);
    });
    socket.on("receive-session-invite", (invite) => setActiveInvite(invite));

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const uid = getMyUserId();
    if (uid && socketRef.current) socketRef.current.emit("identify", uid);
  }, [user]);

  // Entra en una sesión.
  const joinSession = useCallback((rawCode: string, opts: { asLeader?: boolean } = {}): Promise<JoinResult> => {
    return new Promise((resolve) => {
      const code = (rawCode || "").trim().toUpperCase();
      const socket = socketRef.current;
      if (!code) return resolve({ ok: false, error: "INVALID_CODE" });
      if (!socket) return resolve({ ok: false, error: "NO_SOCKET" });

      const prevSession = sessionRef.current;
      // Fijar sessionRef antes del emit para que el evento 'session-members' que emite el servidor
      // inmediatamente antes del ack no sea descartado por `code !== sessionRef.current`.
      sessionRef.current = code;

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sessionRef.current = prevSession;
        resolve({ ok: false, error: "TIMEOUT" });
      }, 10000);

      socket.emit("join-session", { code, user: userRef.current }, (res: any) => {
        if (settled) {
          if (res?.ok && sessionRef.current !== code) socket.emit("leave-session", { code });
          return;
        }
        settled = true;
        clearTimeout(timer);

        if (!res?.ok) {
          sessionRef.current = prevSession;
          return resolve({ ok: false, error: res?.error || "SERVER_ERROR" });
        }

        if (prevSession && prevSession !== code) {
          socket.emit("leave-session", { code: prevSession });
        }
        if (prevSession !== code) {
          setSessionMessages([]);
          setSessionVotes({});
          setLiveReactions([]);
        }
        setCurrentSession(code);
        isLeaderRef.current = !!opts.asLeader;
        if (res.membersList) {
          setSessionMembers(res.membersList);
          updateLeaderFromMembers(res.membersList);
        }
        if (res.state?.votes && typeof res.state.votes === "object") {
          setSessionVotes(res.state.votes);
        }
        if (!opts.asLeader) {
          applyState(res.state);
        }
        resolve({ ok: true, members: res.members });
      });
    });
  }, [applyState, setCurrentSession, updateLeaderFromMembers]);

  const transferHost = useCallback((targetUserId: string): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const code = sessionRef.current;
      const socket = socketRef.current;
      if (!code || !socket) return resolve({ ok: false, error: "NO_SESSION" });
      socket.emit("transfer-host", { code, targetUserId }, (res: any) => {
        resolve(res?.ok ? { ok: true } : { ok: false, error: res?.error || "SERVER_ERROR" });
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
    setSessionVotes({});
    setLiveReactions([]);
  }, [setCurrentSession]);

  // Pide el estado actual al servidor y sincroniza canción y posición.
  const resyncSession = useCallback(() => {
    const code = sessionRef.current;
    if (!code) return;
    socketRef.current?.emit("get-session-state", { code }, (res: any) => {
      const st = res?.state;
      if (!st?.song?.id) return;
      if (String(st.song.id) !== String(currentSongIdRef.current)) {
        applyState(st);
        return;
      }
      const audio = audioRef.current;
      if (audio && Math.abs(audio.currentTime - st.position) > DRIFT_TOLERANCE) {
        audio.currentTime = st.position;
      }
    });
  }, [applyState]);

  const emitCommand = (command: string, data: any) => {
    const code = sessionRef.current;
    if (!code) return;
    if (command === "sync-time" && !isLeaderRef.current) return;

    const payload = { ...data };
    if (payload.song) {
      payload.song = stripSongForSocket(payload.song);
    }
    if (Array.isArray(payload.queue)) {
      payload.queue = trimQueueForSocket(payload.queue, payload.song?.id ?? currentSongIdRef.current);
    }
    if (Array.isArray(payload.shuffledQueue)) {
      payload.shuffledQueue = trimQueueForSocket(payload.shuffledQueue, payload.song?.id ?? currentSongIdRef.current);
    }

    socketRef.current?.emit("send-command", {
      code,
      command,
      data: { ...payload, sentAt: Date.now() }
    });
  };

  const emitReaction = (messageId: string, reaction: string) => {
    const code = sessionRef.current;
    if (!code) return;

    const uid = getMyUserId();
    setSessionMessages(prev =>
      prev.map(msg => {
        if (msg.id === messageId) {
          const reactions = msg.reactions || {};
          const myReactions = reactions[uid] || [];
          const newMyReactions = myReactions.includes(reaction)
            ? myReactions.filter((r: string) => r !== reaction)
            : [...myReactions, reaction];
          return { ...msg, reactions: { ...reactions, [uid]: newMyReactions } };
        }
        return msg;
      })
    );

    socketRef.current?.emit("send-reaction", {
      code,
      messageId,
      reaction,
      userId: uid
    });
  };

  const voteQueueTrack = useCallback((songId: string) => {
    const code = sessionRef.current;
    const uid = getMyUserId();
    if (!code || !songId || !uid) return;
    socketRef.current?.emit("vote-queue-track", {
      code,
      songId: String(songId),
      userId: uid
    });
  }, []);

  const proposeQueueTrack = useCallback((song: Song) => {
    const code = sessionRef.current;
    if (!code || !song?.id) return;
    socketRef.current?.emit("propose-queue-track", {
      code,
      song: stripSongForSocket(song),
      user: userRef.current
    });
  }, []);

  const sendLiveReaction = useCallback((emoji: string) => {
    const code = sessionRef.current;
    if (!code || !emoji) return;
    socketRef.current?.emit("send-live-reaction", {
      code,
      emoji,
      user: userRef.current
    });
  }, []);

  const setTrackId = (id: string | null) => { currentSongIdRef.current = id ? String(id) : null; };
  const getTrackId = () => currentSongIdRef.current;
  const isLeader = () => isLeaderRef.current;

  return {
    socketRef, currentSession, setCurrentSession, sessionMessages, setSessionMessages, sessionMembers,
    unreadSenders, setUnreadSenders, activeInvite, setActiveInvite, emitCommand, emitReaction,
    isShuffle, setIsShuffle, shuffledQueue, setShuffledQueue, isLoop, setIsLoop,
    setTrackId, getTrackId, isLeader, joinSession, leaveSession, resyncSession, transferHost,
    sessionVotes, liveReactions, voteQueueTrack, proposeQueueTrack, sendLiveReaction
  };
}
