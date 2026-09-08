import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Song } from "../constants";

export function useSocketLogic(user: any, handlePlaySongRef: any, setIsPlaying: any, audioRef: any, setActiveQueue: any) {
  const socketRef = useRef<Socket | null>(null);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [unreadSenders, setUnreadSenders] = useState<string[]>([]);
  const [activeInvite, setActiveInvite] = useState<{from: string, code: string} | null>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<Song[]>([]);
  const [isLoop, setIsLoop] = useState(false);

  // Track the current song ID locally for the sync-time check
  const currentSongIdRef = useRef<string | null>(null);

  useEffect(() => {
    const SOCKET_URL = "https://aura.basildo.me"
    socketRef.current = io(SOCKET_URL);
    
    socketRef.current.on('connect', () => {
        if (user) socketRef.current?.emit('identify', user.userId);
    });

    socketRef.current.on('receive-command', ({ command, data }) => {
        const now = Date.now();
        const latency = data.sentAt ? (now - data.sentAt) / 1000 : 0;

        if (command === 'play-track') {
            if (data.queue) setActiveQueue(data.queue);
            if (data.song?.id && handlePlaySongRef.current) {
                currentSongIdRef.current = data.song.id;
                handlePlaySongRef.current(data.song, true, (data.position || 0) + latency);
            }
        }
        
        if (command === 'sync-time') {
            // ONLY sync if we are playing the same song as the sender
            if (audioRef && data.songId === currentSongIdRef.current) {
                const targetTime = data.position + latency;
                if (Math.abs(audioRef.currentTime - targetTime) > 1.5) {
                    audioRef.currentTime = targetTime;
                }
            }
        }

        if (command === 'toggle-play') setIsPlaying(data.isPlaying);
        
        if (command === 'toggle-shuffle') { 
            setIsShuffle(data.isShuffle); 
            if (data.shuffledQueue) setShuffledQueue(data.shuffledQueue); 
        }
        
        if (command === 'toggle-loop') setIsLoop(data.isLoop);
        
        if (command === 'seek' && audioRef) {
            audioRef.currentTime = data.time + latency;
        }
    });

    socketRef.current.on('receive-chat', (chat) => setSessionMessages(prev => [...prev, chat]));
    socketRef.current.on('receive-private-message', (msg) => {
        setUnreadSenders(prev => [...new Set([...prev, String(msg.sender_id)])]);
    });
    socketRef.current.on('receive-session-invite', (invite) => setActiveInvite(invite));

    return () => { socketRef.current?.disconnect(); };
  }, [audioRef]);

  useEffect(() => {
    if (user && socketRef.current) socketRef.current.emit('identify', user.userId);
  }, [user]);

  const emitCommand = (command: string, data: any) => {
    if (currentSession) {
        socketRef.current?.emit('send-command', { 
            code: currentSession, 
            command, 
            data: { ...data, sentAt: Date.now() } 
        });
    }
  };

  // Helper to keep track of the ID for sync-time
  const setTrackId = (id: string | null) => { currentSongIdRef.current = id; };

  return { 
    socketRef, currentSession, setCurrentSession, sessionMessages, setSessionMessages, 
    unreadSenders, setUnreadSenders, activeInvite, setActiveInvite, emitCommand,
    isShuffle, setIsShuffle, shuffledQueue, setShuffledQueue, isLoop, setIsLoop,
    setTrackId
  };
}