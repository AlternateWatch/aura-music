import { useState, useEffect, useRef, FormEvent } from "react";
import { Background } from "./components/Background";
import { PlayerBar } from "./components/PlayerBar";
import { MusicCard } from "./components/MusicCard";
import { Visualizer } from "./components/Visualizer";
import { type Song, type Playlist } from "./constants";
import { LyricsOverlay } from "./components/LyricsOverlay";
import { MusicUpload } from "./components/MusicUpload";
import { useFileUrl } from "./hooks/useFileUrl";
import { 
  Music2, Plus, Trash2, LogOut, ShieldCheck, Search, AlertTriangle, Edit2, Palette, Users, 
  MinusCircle, ListPlus, SquarePlay, DoorOpen, X, ArrowUpDown, Filter, Clock, Image as ImageIcon,
  ChevronLeft, Menu, Heart, Play, Trophy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { TabsOverlay } from "./components/TabsOverlay"; 
import { ProfileOverlay } from "./components/ProfileOverlay"; 
import { PersonalizationOverlay, THEMES } from "./components/PersonalizationOverlay";
import { FullPlayerOverlay } from "./components/FullPlayerOverlay";
import { QueueOverlay } from "./components/QueueOverlay";
import { SessionOverlay } from "./components/SessionOverlay";
import { MinigameLobbyOverlay } from "./components/MinigameLobbyOverlay";

// MODULED IMPORTS AND HOOKS

import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSocketLogic } from "./hooks/useSocketLogic";
import { SocialSidebar } from "./hooks/SocialSidebar";
import { AuthForm } from "./hooks/AuthSection";


export default function App() {
  // --- CORE STATE ---
  const API_BASE = import.meta.env.VITE_API_URL || "";
  const [token, setToken] = useState<string | null>(localStorage.getItem('aura_token'));
  const [user, setUser] = useState<any>(localStorage.getItem('aura_user') ? JSON.parse(localStorage.getItem('aura_user')!) : null);
  const [userRole, setUserRole] = useState(localStorage.getItem('aura_role') || "user");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isNormalizerEnabled, setIsNormalizerEnabled] = useState(localStorage.getItem('aura_norm') === 'true');
  const [activePlaylistId, setActivePlaylistId] = useState<string>("all");
  const [playlists, setPlaylists] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showModeration, setShowModeration] = useState(false);
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [formatFilter, setFormatFilter] = useState<'all' | 'mp3' | 'flac'>('all');
  const [sortBy, setSortBy] = useState<string>('first');
  const [searchQuery, setSearchQuery] = useState(""); 
  const [activeQueue, setActiveQueue] = useState<Song[]>([]);
  const [activeTheme, setActiveTheme] = useState(localStorage.getItem('aura_theme') || 'dark');
  const [customBg, setCustomBg] = useState(user?.custom_bg_path || null);
  const [isSocialOpen, setIsSocialOpen] = useState(false);
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [songToEdit, setSongToEdit] = useState<any | null>(null);
  const [newEditCover, setNewEditCover] = useState<File | null>(null);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPersonalizationOpen, setIsPersonalizationOpen] = useState(false);
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [tabsSong, setTabsSong] = useState<Song | null>(null);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [heroImageError, setHeroImageError] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>(() => {
    const saved = localStorage.getItem('aura_recent');
    return saved ? JSON.parse(saved) : [];
  });

  const [dynamicColor, setDynamicColor] = useState<string>('#6366f1');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [likedIds, setLikedIds] = useState<string[]>([]);

  // --- MINIGAME STATE AND MISC---
  const [isMinigameLobbyOpen, setIsMinigameLobbyOpen] = useState(false);
  const [isMinigameActive, setIsMinigameActive] = useState(false);
  const [minigameTargetSong, setMinigameTargetSong] = useState<Song | null>(null);
  const [minigameScore, setMinigameScore] = useState(0);
  const [minigameLives, setMinigameLives] = useState(3);
  const [minigameTime, setMinigameTime] = useState(0);
  const [isMinigamePlaying, setIsMinigamePlaying] = useState(false);
  
  const minigameAudioRef = useRef<HTMLAudioElement | null>(null);
  const minigameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resolvedMinigameAudioUrl = useFileUrl(minigameTargetSong?.audioUrl);

  const handlePlaySongRef = useRef<any>(null);
  const resolvedCoverUrl = useFileUrl(currentSong?.coverUrl);
  const resolvedAudioUrl = useFileUrl(currentSong?.audioUrl);
  const resolvedCustomBg = useFileUrl(customBg);
  const resolvedProfilePic = useFileUrl(user?.profile_pic_path);

  // --- LOGIC MODULES ---
  const audioObj = useAudioEngine(currentSong, isPlaying, volume, isNormalizerEnabled, setIsPlaying, resolvedAudioUrl);
  const socketObj = useSocketLogic(user, handlePlaySongRef, setIsPlaying, audioObj.audioRef.current, setActiveQueue);
  
  useEffect(() => { handlePlaySongRef.current = handlePlaySong; });

  // COLOR DINÁMICO
  useEffect(() => {
    if (!resolvedCoverUrl) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = resolvedCoverUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = 1; canvas.height = 1;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      setDynamicColor(`rgb(${r}, ${g}, ${b})`);
    };
  }, [resolvedCoverUrl]);

  // HEARTBEAT
  useEffect(() => {
    if (!socketObj.currentSession || !isPlaying || !currentSong) return;
    const heartbeat = setInterval(() => {
        socketObj.emitCommand('sync-time', { position: audioObj.currentTime, songId: currentSong.id });
    }, 10000); 
    return () => clearInterval(heartbeat);
  }, [socketObj.currentSession, isPlaying, currentSong?.id, audioObj.currentTime]);

  const handleLoginSuccess = (t: string, u: any, r: string) => {
    localStorage.setItem('aura_token', t); localStorage.setItem('aura_user', JSON.stringify(u)); localStorage.setItem('aura_role', r);
    window.location.reload(); 
  };
  const handleLogout = () => { localStorage.clear(); window.location.reload(); };

  const handleStartSession = async () => {
    const res = await fetch(`${API_BASE}/api/sessions/create`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok) { socketObj.setCurrentSession(data.code); socketObj.socketRef.current?.emit('join-session', { code: data.code, user }); }
  };
  const handleJoinSession = (code: string) => { socketObj.setCurrentSession(code); socketObj.socketRef.current?.emit('join-session', { code, user }); };
  const handleSendChat = (message: string) => { if (socketObj.currentSession) socketObj.socketRef.current?.emit('send-chat', { code: socketObj.currentSession, user, message }); };

  const loadContent = async () => {
    setIsLoading(true);
    try {
      let url = activePlaylistId === 'all' || activePlaylistId === 'liked' ? `/api/tracks?status=${showModeration ? 'pending' : 'approved'}` : `/api/playlists/${activePlaylistId}/tracks`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (Array.isArray(data)) { 
        setSongs(data.map((s: any) => ({ 
            ...s, id: s.id.toString(), coverUrl: s.cover_path, audioUrl: s.file_path, uploaderId: s.added_by?.toString(), tabs_url: s.tabs_url, track_number: s.track_number, format: s.format 
        }))); 
        setLikedIds(data.filter((s: any) => s.is_liked).map((s: any) => s.id.toString()));
      }
    } catch (e) { console.error("Load failed"); }
    setIsLoading(false);
  };
  const loadPlaylists = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/playlists`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (Array.isArray(data)) setPlaylists(data);
    } catch (e) { console.error("Playlists failed"); }
  };

  const loadLastTrack = async () => {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/api/users/me/last-track`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      console.error("Failed to load last track");
      return;
    }

    const data = await res.json();

    if (!data) return;

    const lastSong: Song = {
      ...data,
      id: data.id.toString(),
      coverUrl: data.cover_path,
      audioUrl: data.file_path,
      uploaderId: data.added_by?.toString(),
      tabs_url: data.tabs_url,
      track_number: data.track_number,
      format: data.format
    };

    setCurrentSong(lastSong);
    setIsPlaying(false);

  } catch (error) {
    console.error("Error loading last track:", error);
  }
};


  useEffect(() => { loadContent(); }, [showModeration, activePlaylistId]);
  useEffect(() => { loadPlaylists(); }, [token]);

  useEffect(() => {
  if (token) {
    loadLastTrack();
  }
}, [token]);

  // --- MINIGAME ENGINE ---
  useEffect(() => {
    if (minigameAudioRef.current) minigameAudioRef.current.volume = volume;
  }, [volume]);

const mysterySong: Song = {
  id: 'mystery-101',
  title: '???',
  artist: '???',
  album: '???',
  coverUrl: 'data:image/svg+xml;utf8,<svg ...',
  audioUrl: '',
  uploaderId: '',
  format: 'mp3',
  track_number: null,
  tabs_url: null,
  status: 'approved',
  createdAt: '',
  updatedAt: ''
};

  const playSfx = (type: 'correct' | 'wrong') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'correct') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
      } else {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(300, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
      }
    } catch(e) {}
  };

  const startMinigame = () => {
    if (songs.length === 0) return alert("Library empty.");
    if (isPlaying) { setIsPlaying(false); audioObj.audioRef.current?.pause(); }
    setIsMinigameLobbyOpen(false);
    setIsMinigameActive(true);
    setMinigameScore(0);
    setMinigameLives(3);
    const randomSong = songs[Math.floor(Math.random() * songs.length)];
    setMinigameTargetSong(randomSong);
  };

  const replayMinigameSnippet = () => {
    if (minigameAudioRef.current) {
        minigameAudioRef.current.currentTime = 0;
        setMinigameTime(0);
        minigameAudioRef.current.play();
        if (minigameTimeoutRef.current) clearTimeout(minigameTimeoutRef.current);
        minigameTimeoutRef.current = setTimeout(() => {
            minigameAudioRef.current?.pause();
        }, 10000);
    }
  };

  useEffect(() => {
    if (isMinigameActive && resolvedMinigameAudioUrl) { replayMinigameSnippet(); }
  }, [resolvedMinigameAudioUrl, isMinigameActive]);

  const endMinigame = (finalScore: number) => {
    if (minigameAudioRef.current) minigameAudioRef.current.pause();
    if (minigameTimeoutRef.current) clearTimeout(minigameTimeoutRef.current);
    setIsMinigameActive(false);
    setMinigameTargetSong(null);
    setMinigameTime(0);
    alert(`Game Over! Final Recon Score: ${finalScore}`);
  };

  const handleMinigameGuess = (song: Song) => {
    if (song.id === minigameTargetSong?.id) {
        playSfx('correct');
        setMinigameScore(prev => prev + 1);
        const randomSong = songs[Math.floor(Math.random() * songs.length)];
        setMinigameTargetSong(randomSong);
    } else {
        playSfx('wrong');
        const nextLives = minigameLives - 1;
        setMinigameLives(nextLives);
        if (nextLives <= 0) { endMinigame(minigameScore); }
    }
  };

  // --- LIKES ---
  const handleToggleLike = async (songId: string) => {
    if (!token) return setIsAuthModalOpen(true);
    const res = await fetch(`/api/tracks/${songId}/like`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        setLikedIds(prev => prev.includes(songId) ? prev.filter(id => id !== songId) : [...prev, songId]);
    }
  };

  // --- PLAYBACK ---
 const handlePlaySong = async (
  song: Song,
  fromSocket = false,
  initialPos = 0,
  preserveQueue = false
) => {
  if (currentSong?.id === song.id) {
    const nextState = !isPlaying;
    setIsPlaying(nextState);

    if (!fromSocket) {
      socketObj.emitCommand('toggle-play', { isPlaying: nextState });
    }

    return;
  }

  let finalQueue = activeQueue;

  if (!fromSocket && !preserveQueue) {
    const flattened = getFlattenedSongs();
    setActiveQueue(flattened);
    finalQueue = flattened;
  }

  setRecentlyPlayed(prev =>
    [song, ...prev.filter(s => s.id !== song.id)].slice(0, 4)
  );

  setCurrentSong(song);
  setIsPlaying(true);

  socketObj.setTrackId(song.id);

 if (!fromSocket && token) {
  console.log("GUARDANDO ÚLTIMA CANCIÓN:", song.id);

  fetch(`${API_BASE}/api/users/me/last-track`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      trackId: song.id
    })
  })
    .then(async res => {
      console.log("RESPUESTA LAST TRACK:", res.status, await res.text());
    })
    .catch(error => {
      console.error("ERROR GUARDANDO LAST TRACK:", error);
    });
}

  if (initialPos > 0 && audioObj.audioRef.current) {
    audioObj.audioRef.current.currentTime = initialPos;
  }

  if (!fromSocket) {
    socketObj.emitCommand('play-track', {
      id: song.id,
      song,
      queue: finalQueue,
      position: 0
    });
  }
};
  const handleNext = () => {
  const pool = socketObj.isShuffle
    ? socketObj.shuffledQueue
    : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

  if (pool.length === 0) return;

  const currentIndex = pool.findIndex((s) => s.id === currentSong?.id);

  if (currentIndex === -1) {
    handlePlaySong(pool[0], false, 0, true);
    return;
  }

  const nextSong = pool[(currentIndex + 1) % pool.length];

  handlePlaySong(nextSong, false, 0, true);
};

  const handlePrevious = () => {
  const pool = socketObj.isShuffle
    ? socketObj.shuffledQueue
    : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

  if (pool.length === 0) return;

  const currentIndex = pool.findIndex((s) => s.id === currentSong?.id);

  if (audioObj.currentTime > 3) {
    if (audioObj.audioRef.current) {
      audioObj.audioRef.current.currentTime = 0;
    }
    return;
  }

  if (currentIndex === -1) {
    handlePlaySong(pool[0], false, 0, true);
    return;
  }

  const previousSong = pool[(currentIndex - 1 + pool.length) % pool.length];

  handlePlaySong(previousSong, false, 0, true);
};

  const toggleShuffle = () => {
      const nextShuffleState = !socketObj.isShuffle;
      socketObj.setIsShuffle(nextShuffleState);
      let newShuffled: Song[] = [];
      if (nextShuffleState) {
          const currentPool = activeQueue.length > 0 ? activeQueue : getFlattenedSongs();
          newShuffled = [...currentPool].sort(() => Math.random() - 0.5);
          socketObj.setShuffledQueue(newShuffled);
      }
      socketObj.emitCommand('toggle-shuffle', { isShuffle: nextShuffleState, shuffledQueue: newShuffled });
  };

  const toggleLoop = () => {
      const nextLoop = !socketObj.isLoop;
      socketObj.setIsLoop(nextLoop);
      socketObj.emitCommand('toggle-loop', { isLoop: nextLoop });
  };

  const handlePlayNext = (song: Song) => {
    const currentPool = activeQueue.length > 0 ? [...activeQueue] : getFlattenedSongs();
    const filteredPool = currentPool.filter(s => s.id !== song.id);
    const currentIndex = filteredPool.findIndex(s => s.id === currentSong?.id);
    filteredPool.splice(currentIndex + 1, 0, song);
    setActiveQueue(filteredPool);
    socketObj.emitCommand('play-track', { id: currentSong?.id, song: currentSong, queue: filteredPool, position: audioObj.currentTime });
  };

  const handleAddToQueue = (song: Song) => {
    const currentPool = activeQueue.length > 0 ? [...activeQueue] : getFlattenedSongs();
    if (currentPool.some(s => s.id === song.id)) return; 
    const newQueue = [...currentPool, song];
    setActiveQueue(newQueue);
    socketObj.emitCommand('play-track', { id: currentSong?.id, song: currentSong, queue: newQueue, position: audioObj.currentTime });
  };

  const handleReorderQueue = (newQueue: Song[]) => {
  setActiveQueue(newQueue);

  if (socketObj.isShuffle) {
    socketObj.setShuffledQueue(newQueue);
  }

  socketObj.emitCommand('play-track', {
    id: currentSong?.id,
    song: currentSong,
    queue: newQueue,
    position: audioObj.currentTime
  });
};

  const handleModerate = async (songId: string, status: string) => {
      await fetch(`/api/moderation/${songId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ status }) });
      loadContent();
  };

  const handleUpdateMetadata = async (e: FormEvent) => {
    e.preventDefault();
    if (!songToEdit) return;
    const formData = new FormData();
    formData.append('title', songToEdit.title);
    formData.append('artist', songToEdit.artist);
    formData.append('album', songToEdit.album || "");
    formData.append('track_number', songToEdit.track_number ? String(songToEdit.track_number) : "");
    formData.append('tabs_url', songToEdit.tabs_url || "");
    formData.append('cover_path', songToEdit.coverUrl || ""); 
    if (newEditCover) { formData.append('cover', newEditCover); }
    const res = await fetch(`/api/tracks/${songToEdit.id}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
    if (res.ok) { setSongToEdit(null); setNewEditCover(null); loadContent(); }
  };

  const confirmDeleteTrack = async () => {
    if (!trackToDelete) return;
    const res = await fetch(`/api/tracks/${trackToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) { setTrackToDelete(null); loadContent(); }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
        const res = await fetch(`${API_BASE}/api/playlists`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
            body: JSON.stringify({ name: newPlaylistName }) 
        });
        if (res.ok) {
            setNewPlaylistName(""); 
            setIsCreatePlaylistOpen(false); 
            loadPlaylists();
        }
    } catch(err) { console.error("Error creating playlist"); }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    if (!confirm("Delete playlist?")) return;
    await fetch(`/api/playlists/${playlistId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (activePlaylistId === playlistId) setActivePlaylistId("all");
    loadPlaylists();
  };
  const handleRemoveFromPlaylist = async (songId: string) => {
    await fetch(`/api/playlists/${activePlaylistId}/tracks/${songId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    loadContent();
  };

  const handleReorderPlaylist = async (newOrder: Song[]) => {
    if (activePlaylistId === 'all' || activePlaylistId === 'liked') return;

    try {
        const res = await fetch(
            `/api/playlists/${activePlaylistId}/tracks/reorder`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    trackIds: newOrder.map(song => song.id)
                })
            }
        );

        if (!res.ok) {
            console.error("Error reordering playlist");
        }
    } catch (err) {
        console.error("Error reordering playlist:", err);
    }
};
  const handleAddToPlaylist = async (songId: string, playlistId: string) => {
    await fetch(`/api/playlists/${playlistId}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ trackId: songId }) });
  };
  const getFlattenedSongs = () => {
    let list = songs.filter(
        s => formatFilter === 'all' || s.format === formatFilter
    );

    list = list.filter(
        s =>
            s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (activePlaylistId === 'liked') {
        list = list.filter(s => likedIds.includes(s.id));
    }

    // LAS PLAYLISTS RESPETAN EL ORDEN GUARDADO EN LA BD
    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked') {
        if (selectedAlbumName) {
            return list.filter(s => s.album === selectedAlbumName);
        }

        return list;
    }

    // Biblioteca global / liked tracks mantienen el sistema de orden actual
    const sorted = [...list].sort((a, b) =>
        sortBy === 'name'
            ? a.title.localeCompare(b.title)
            : parseInt(a.id) - parseInt(b.id)
    );

    if (selectedAlbumName) {
        return sorted.filter(s => s.album === selectedAlbumName);
    }

    return sorted;
};

const getDisplayItems = () => {
    const list = getFlattenedSongs();

    // Las playlists muestran directamente sus canciones
    // respetando el orden guardado en la BD.
    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked') {
        return list;
    }

    if (selectedAlbumName) {
    return list;
}

    // Biblioteca global / liked:
    // mantenemos la agrupación de canciones por álbum.
    const items: any[] = [];
    const grouped = new Set<string>();

    list.forEach(song => {
        if (
            song.album &&
            song.album.toLowerCase().includes(searchQuery.toLowerCase()) &&
            !grouped.has(song.album)
        ) {
            const tracks = list.filter(s => s.album === song.album);

            if (tracks.length > 1) {
                items.push({
                    id: `album-${song.album}`,
                    type: 'album',
                    title: song.album,
                    artist: song.artist,
                    coverUrl: song.coverUrl,
                    trackCount: tracks.length
                });

                grouped.add(song.album);
            } else {
                items.push(song);
            }
        } else if (
            !song.album ||
            !song.album.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
            items.push(song);
        }
    });

    return items;
};


const canReorderPlaylist =
    activePlaylistId !== 'all' &&
    activePlaylistId !== 'liked' &&
    !showModeration &&
    !isMinigameActive &&
    sortBy === 'first' &&
    formatFilter === 'all' &&
    !searchQuery.trim() &&
    !selectedAlbumName;



  const getCurrentPlayPool = () => {
    if (socketObj.isShuffle) return socketObj.shuffledQueue;
    return activeQueue.length > 0 ? activeQueue : getFlattenedSongs();
  };

  const displayItems = getDisplayItems();
  const currentThemeConfig = THEMES.find(t => t.id === activeTheme) || THEMES[0];
  const getThemeBg = () => activeTheme === 'light' ? '#ffffff' : '#050505';

  return (
    <div className={`relative h-[100dvh] flex flex-col font-sans overflow-hidden transition-all duration-1000 ${currentThemeConfig.className}`}>
      {/* Hidden Minigame Engine */}
      <audio 
        ref={minigameAudioRef} 
        src={resolvedMinigameAudioUrl || undefined} 
        crossOrigin="anonymous" 
        onTimeUpdate={(e) => setMinigameTime(e.currentTarget.currentTime)}
        onPlay={() => setIsMinigamePlaying(true)}
        onPause={() => setIsMinigamePlaying(false)}
      />
      
      <Background color={getThemeBg()} dynamicColor={dynamicColor} />
      {activeTheme === 'custom' && resolvedCustomBg && (
          <div className="absolute inset-0 pointer-events-none transition-opacity duration-1000 z-[1]" style={{ backgroundImage: `url(${resolvedCustomBg})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5 }} />
      )}

      {/* TOP NAVIGATION (Responsive) */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.nav 
            initial={{ y: -100 }} animate={{ y: 0 }} exit={{ y: -100 }}
            className={`h-16 flex items-center justify-between px-4 md:px-8 border-b z-20 backdrop-blur-md transition-all duration-1000 ${activeTheme === 'light' ? 'border-black/5 bg-white/60' : 'border-white/10 bg-black/40'}`}
          >
            <div className="flex items-center gap-4 md:gap-12 flex-1">
              <span className="text-lg md:text-xl font-bold tracking-tighter uppercase cursor-pointer shrink-0" onClick={() => setSelectedAlbumName(null)}>AURA<span className="text-brand-primary">.</span></span>
              <div className={`hidden lg:flex gap-8 text-[10px] font-bold uppercase`}>
                <button onClick={() => {setShowModeration(false); setActivePlaylistId("all"); setSelectedAlbumName(null);}} className={`transition-colors ${!showModeration && activePlaylistId === "all" ? (activeTheme === 'light' ? 'text-black border-b border-brand-primary' : 'text-white border-b border-brand-primary pb-1') : ""}`}>Library</button>
                {(userRole === "admin" || userRole === "moderator") && <button onClick={() => setShowModeration(true)} className={`flex items-center gap-2 ${showModeration ? 'text-amber-500 border-b border-amber-500 pb-1' : ''}`}><ShieldCheck size={12}/> Moderation</button>}
                <button onClick={() => setIsSessionOpen(true)} className={`flex items-center gap-2 transition-colors ${socketObj.currentSession ? 'text-brand-primary animate-pulse font-black' : 'text-white/40'}`}><Users size={12} /> Session</button>
                {token && <button onClick={() => setIsSocialOpen(true)} className="relative flex items-center gap-2 text-white/40 hover:text-white transition-colors cursor-pointer"><Users size={12} /> Social{socketObj.unreadSenders.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-xl" />}</button>}
              </div>
              <div className="flex-1 max-w-md ml-8 relative hidden sm:block">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30`} />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-full py-1.5 pl-10 pr-4 text-[11px] outline-none text-white focus:bg-white/10" placeholder="Search frequency..." />
              </div>
            </div>
            <div className="flex items-center gap-3 md:gap-6">
              {token ? (
                <div className="flex items-center gap-2 md:gap-4">
                  <button onClick={() => setShowUpload(true)} className="bg-brand-primary text-black px-3 md:px-4 py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase flex items-center gap-2 hover:scale-105 transition-all cursor-pointer"><Plus size={14}/> <span className="hidden xs:inline">Upload</span></button>
                  <button onClick={handleLogout} className="cursor-pointer text-white/40 hover:text-red-400"><LogOut size={16}/></button>
                  <div onClick={() => setIsProfileOpen(true)} className={`w-7 h-7 md:w-8 md:h-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center cursor-pointer overflow-hidden text-[10px] font-bold`}>
                    {resolvedProfilePic ? <img src={resolvedProfilePic} className="w-full h-full object-cover" /> : (user?.username?.[0] || "U")}
                  </div>
                  <button onClick={() => setIsSocialOpen(true)} className="lg:hidden text-white/40"><Menu size={20}/></button>
                </div>
              ) : ( <button onClick={() => setIsAuthModalOpen(true)} className="px-5 py-2 rounded-full text-[10px] font-bold uppercase bg-white text-black hover:scale-105 transition-all cursor-pointer">Sign In</button> )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <div className="flex flex-1 min-h-0 overflow-hidden z-10">
        <AnimatePresence>
          {!isFocusMode && (
            <motion.aside initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} className={`w-64 border-r border-white/5 hidden md:flex flex-col shrink-0 p-8`}>
                <div className="flex-1 overflow-y-auto flex flex-col gap-10 scrollbar-hide">
                    <div>
                      <div className="flex items-center justify-between mb-6"><h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Playlists</h3><Plus size={14} className="hover:text-brand-primary cursor-pointer transition-all" onClick={() => setIsCreatePlaylistOpen(true)} /></div>
                      <ul className="space-y-4 text-[13px] font-medium">
                        <li key="stream-all" className={`cursor-pointer transition-all ${activePlaylistId === "all" ? "text-brand-primary" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("all"); setShowModeration(false); setSelectedAlbumName(null); }}>Global Stream</li>
                        <li key="liked-songs" className={`flex items-center gap-2 cursor-pointer transition-all ${activePlaylistId === "liked" ? "text-red-500 font-bold" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("liked"); setShowModeration(false); setSelectedAlbumName(null); }}>
                            <Heart size={14} fill={activePlaylistId === "liked" ? "currentColor" : "none"} /> Liked Tracks
                        </li>
                        {playlists.map(p => (
                            <li key={p.id} className="group flex items-center justify-between cursor-pointer">
                                <span onClick={() => { setActivePlaylistId(p.id.toString()); setShowModeration(false); setSelectedAlbumName(null); }} className={`truncate transition-all ${activePlaylistId === p.id.toString() ? "text-brand-primary" : "text-white/50 hover:text-white"}`}>{p.name}</span>
                                <Trash2 size={12} className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-red-500 transition-all" onClick={(e) => { e.stopPropagation(); handleDeletePlaylist(p.id); }} />
                            </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col gap-6">
                        <h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Aura Sync</h3>
                        <div className="h-24 border border-white/10 bg-white/5 rounded-2xl overflow-hidden p-4 w-full">
                            <Visualizer analyser={audioObj.analyserRef.current} active={isPlaying} color={dynamicColor} />
                        </div>
                    </div>
                    <div><h3 className="text-[10px] uppercase font-bold text-white/30 mb-6 tracking-widest flex items-center gap-2"><Clock size={12}/> History</h3><div className="space-y-4">{recentlyPlayed.map((song) => (<div key={song.id} className="flex items-center gap-4 group cursor-pointer" onClick={() => { if(isMinigameActive) handleMinigameGuess(song); else handlePlaySong(song); }}><div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/10 group-hover:scale-105 transition-transform"><img src={song.coverUrl} className="w-full h-full object-cover" /></div><div className="overflow-hidden"><p className="text-[11px] font-bold tabular-nums truncate text-white">{song.title}</p></div></div>))}</div></div>
                </div>
                <div className="mt-auto pt-6"><div onClick={() => setIsPersonalizationOpen(true)} className="p-5 rounded-[28px] border border-white/5 bg-white/5 cursor-pointer flex items-center gap-4 hover:bg-white/[0.08] transition-all"><Palette size={18} className="text-brand-primary" /><span className="text-[10px] font-bold uppercase tracking-widest text-white/80">Aesthetic</span></div></div>
            </motion.aside>
          )}
        </AnimatePresence>

        <main className={`flex-1 min-h-0 overflow-y-auto p-4 md:p-10 flex flex-col gap-8 md:gap-12 pb-8 scrollbar-hide transition-all duration-700 ${isFocusMode ? 'items-center justify-center pt-0' : ''}`}>
            {/* MINIGAME HUD */}
            <AnimatePresence>
                {isMinigameActive && (
                    <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="w-full bg-orange-500/10 border border-orange-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_40px_rgba(249,115,22,0.15)] relative overflow-hidden backdrop-blur-md">
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 via-orange-500/5 to-orange-500/0 pointer-events-none animate-pulse" />
                        <div className="flex items-center gap-6 z-10">
                            <div className="text-orange-500 flex items-center gap-2">
                                <Trophy size={20} /> <span className="font-black text-2xl font-mono">{minigameScore}</span>
                            </div>
                            <div className="flex items-center gap-2 border-l border-white/10 pl-6">
                                {[...Array(3)].map((_, i) => (
                                    <Heart key={i} size={20} className={i < minigameLives ? "text-red-500 fill-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]" : "text-white/10"} />
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-4 z-10">
                            <button onClick={replayMinigameSnippet} className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 cursor-pointer"><Play size={14} /> Replay</button>
                            <button onClick={() => endMinigame(minigameScore)} className="text-white/30 hover:text-red-500 transition-colors cursor-pointer"><X size={20} /></button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {!isFocusMode ? (
              <>
                <AnimatePresence>{showUpload && <MusicUpload onClose={() => setShowUpload(false)} onUploadComplete={() => loadContent()} />}</AnimatePresence>
                
                {/* HERO BANNER - Hidden during minigame for cleaner UI */}
                {!isMinigameActive && (
                    <section className="relative h-48 md:h-72 shrink-0 flex flex-col justify-end p-6 md:p-10 rounded-[30px] md:rounded-[40px] overflow-hidden group shadow-2xl">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent z-10" />
                        <motion.div key={currentSong?.id} initial={{ scale: 1.1, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute inset-0 -z-10 bg-[#0a0a0a]">
                            {currentSong && !heroImageError ? <img src={resolvedCoverUrl || undefined} className="w-full h-full object-cover grayscale-[0.3] brightness-75 transition-transform duration-1000" onError={() => setHeroImageError(true)} /> : <div className="w-full h-full flex flex-col items-center justify-center text-white/5"><Music2 size={80} /></div>}
                        </motion.div>
                        <div className="z-20">
                            <p className="text-[9px] md:text-[11px] uppercase tracking-[0.4em] text-brand-primary font-bold mb-2 md:mb-3">{currentSong ? "Now Streaming" : "Library Core"}</p>
                            <h1 className="text-3xl md:text-6xl font-serif italic text-white mb-2 leading-none truncate">{currentSong?.title || "AURA Library"}</h1>
                            {currentSong && <p className="text-white/60 italic mb-4 md:mb-6 font-serif text-sm md:text-lg">{currentSong.artist}</p>}
                            <div className="flex gap-4"><button onClick={() => currentSong && setIsPlaying(!isPlaying)} className="px-6 md:px-8 py-2 md:py-2.5 rounded-full bg-white text-black font-bold text-[9px] md:text-[10px] uppercase shadow-xl hover:scale-105 transition-all cursor-pointer">{isPlaying ? "Pause" : "Resume"}</button></div>
                        </div>
                    </section>
                )}

                <section>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-white/5 pb-4 text-white gap-4">
                        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 w-full">
                            <h2 className="text-[10px] md:text-[11px] uppercase tracking-[0.3em] md:tracking-[0.4em] font-bold text-white/40">{isMinigameActive ? "RECON MINIGAME - CLICK TO GUESS" : (selectedAlbumName ? `ALBUM: ${selectedAlbumName.toUpperCase()}` : (showModeration ? "PENDING QUEUE" : (activePlaylistId === 'all' ? "Global Top Tracks" : (activePlaylistId === 'liked' ? "Favorite Tracks" : "Playlist Stream"))))}</h2>
                            {!selectedAlbumName && !showModeration && !isMinigameActive && (
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className={`flex p-1 rounded-full border border-white/5 bg-white/5`}>
                                        {(['all', 'mp3', 'flac'] as const).map(f => (<button key={f} onClick={() => setFormatFilter(f)} className={`px-3 md:px-4 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all cursor-pointer ${formatFilter === f ? 'bg-brand-primary text-black' : 'text-white/30 hover:text-white'}`}>{f}</button>))}
                                    </div>
                                    <div className={`flex items-center gap-2 p-1 rounded-full border border-white/5 bg-white/5`}>
                                        <div className="px-2 text-white/20"><ArrowUpDown size={12}/></div>
                                        {(['first', 'name', 'album', 'artist'] as const).map(s => (<button key={s} onClick={() => setSortBy(s)} className={`px-3 md:px-4 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all cursor-pointer ${sortBy === s ? 'bg-white text-black' : 'text-white/30 hover:text-white'}`}>{s}</button>))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {selectedAlbumName && <button onClick={() => setSelectedAlbumName(null)} className="cursor-pointer text-[10px] font-bold text-brand-primary uppercase tracking-widest">Back</button>}
                    </div>
                    {/* RESPONSIVE GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-8">
                        {displayItems.map((item: any) => (
                            <div
    key={item.id}
    draggable={canReorderPlaylist && item.type !== 'album'}
    onDragStart={(e) => {
    if (canReorderPlaylist && item.type !== 'album') {
        setDraggedSongId(item.id);

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
    }
}}
    onDragOver={(e) => {
    if (canReorderPlaylist && item.type !== 'album') {
        e.preventDefault();
        e.stopPropagation();

        e.dataTransfer.dropEffect = 'move';
    }
}}

onDragEnter={(e) => {
    if (canReorderPlaylist && item.type !== 'album') {
        e.preventDefault();

        console.log("🟢 DRAG ENTER", item.id);
    }
}}

onDragLeave={() => {
    if (canReorderPlaylist && item.type !== 'album') {
        console.log("🔴 DRAG LEAVE", item.id);
    }
}}

   onDrop={(e) => {
    e.preventDefault();
    e.stopPropagation();

        console.log("🔥 DROP DETECTADO", item.id);

    const draggedId = e.dataTransfer.getData('text/plain') || draggedSongId;

    console.log('DROP:', {
        draggedId,
        targetId: item.id,
        canReorderPlaylist,
        itemType: item.type
    });

    if (
        !canReorderPlaylist ||
        !draggedId ||
        draggedId === item.id ||
        item.type === 'album'
    ) {
        setDraggedSongId(null);
        return;
    }

    const currentIndex = songs.findIndex(
        s => s.id === draggedId
    );

    const targetIndex = songs.findIndex(
        s => s.id === item.id
    );

    console.log('INDICES:', {
        currentIndex,
        targetIndex
    });

    if (currentIndex === -1 || targetIndex === -1) {
        setDraggedSongId(null);
        return;
    }

    const newSongs = [...songs];

    const [movedSong] = newSongs.splice(currentIndex, 1);

    newSongs.splice(targetIndex, 0, movedSong);

    console.log('NUEVO ORDEN:', newSongs.map(s => s.id));

    setSongs(newSongs);

    handleReorderPlaylist(newSongs);

    setDraggedSongId(null);
}}
    onDragEnd={() => setDraggedSongId(null)}
    className={`relative group ${
        isMinigameActive
            ? 'hover:scale-105 transition-transform'
            : ''
    } ${
        draggedSongId === item.id
            ? 'opacity-40'
            : ''
    } ${
        canReorderPlaylist && item.type !== 'album'
            ? 'cursor-grab active:cursor-grabbing'
            : ''
    }`}
>
                                {item.type === 'album' ? (
                                    <div onClick={() => setSelectedAlbumName(item.title)} className="group p-5 md:p-4 rounded-[32px] md:rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition-all"><div className="aspect-square rounded-[24px] md:rounded-2xl overflow-hidden mb-4 relative"><img src={item.coverUrl} className="w-full h-full object-cover transition-transform duration-700" alt={item.title} /></div><h3 className="text-xl md:text-sm font-bold truncate text-white">{item.title}</h3><p className="text-sm md:text-[10px] uppercase font-bold tracking-widest text-white/40">{item.trackCount} Tracks Found</p></div>
                                ) : (
                                    <div
    className="relative"
    style={{
        pointerEvents:
            draggedSongId && draggedSongId !== item.id
                ? 'none'
                : 'auto'
    }}
>
                                      <MusicCard 
    song={item}
    isActive={!isMinigameActive && currentSong?.id === item.id}
    isPlaying={!isMinigameActive && currentSong?.id === item.id && isPlaying}
    playlists={playlists}
    userRole={userRole}
    isLiked={likedIds.includes(item.id)}
    onToggleLike={() => handleToggleLike(item.id)}
    onAddToPlaylist={(pid) => handleAddToPlaylist(item.id, pid)}

    onRemoveFromPlaylist={
        activePlaylistId !== 'all' && activePlaylistId !== 'liked'
            ? () => handleRemoveFromPlaylist(item.id)
            : undefined
    }

    onOpenTabs={() => setTabsSong(item)} 
    onDelete={() => setTrackToDelete(item.id)}
    onPlayNext={() => handlePlayNext(item)}
    onAddToQueue={() => handleAddToQueue(item)}
    onEdit={() => setSongToEdit(item)}
    onClick={() => {
        if (isMinigameActive) {
            handleMinigameGuess(item);
        } else {
            handlePlaySong(item);
        }
    }} 
/>
                                      {showModeration && (
                                        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-2 z-50 animate-in fade-in zoom-in duration-200">
                                          <button onClick={(e) => { e.stopPropagation(); handleModerate(item.id, 'approved'); }} className="cursor-pointer bg-green-500 text-black px-3 py-1.5 rounded-full text-[8px] md:text-[9px] font-black uppercase shadow-xl hover:scale-105 transition-all">Approve</button>
                                          <button onClick={(e) => { e.stopPropagation(); handleModerate(item.id, 'rejected'); }} className="cursor-pointer bg-red-500 text-white px-3 py-1.5 rounded-full text-[8px] md:text-[9px] font-black uppercase shadow-xl hover:scale-105 transition-all">Reject</button>
                                        </div>
                                      )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
              </>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                <button 
                  onClick={() => setIsFocusMode(false)} 
                  className="absolute top-10 left-10 z-50 px-8 py-3 rounded-full border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <ChevronLeft size={14}/> Back to Library
                </button>

                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-12 w-full max-w-4xl text-center px-10">
                  <div className="relative group">
                    <div className="absolute -inset-20 blur-[120px] rounded-full animate-pulse transition-all duration-1000" style={{ backgroundColor: `${dynamicColor}33` }} />
                    <div className="relative w-80 h-80 md:w-[500px] md:h-[500px] rounded-[60px] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10"><img src={resolvedCoverUrl || undefined} className="w-full h-full object-cover" /></div>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-6xl md:text-8xl font-serif italic text-white tracking-tighter leading-none">{currentSong?.title}</h2>
                    <p className="text-2xl md:text-3xl text-white/40 font-serif italic">{currentSong?.artist}</p>
                  </div>
                  <div className="w-full h-40 max-w-5xl">
                    <Visualizer analyser={audioObj.analyserRef.current} active={isPlaying} color={dynamicColor} />
                  </div>
                </motion.div>
              </div>
            )}
        </main>
      </div>

      <audio ref={audioObj.audioRef} src={resolvedAudioUrl || undefined} onTimeUpdate={(e) => audioObj.setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => audioObj.setDuration(e.currentTarget.duration)} onEnded={handleNext} crossOrigin="anonymous" />
      
      {/* MODIFIED: multiplexing props into the PlayerBar depending on minigame state */}
      <AnimatePresence initial={false}>
  {!isFocusMode && (currentSong || isMinigameActive) && (
    <motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: 20 }}
  transition={{ type: "spring", damping: 25, stiffness: 120 }}
  className="relative z-[100] w-full shrink-0 overflow-visible"
>
  <PlayerBar
    currentSong={isMinigameActive ? mysterySong : currentSong!}
    isPlaying={isMinigameActive ? isMinigamePlaying : isPlaying}
    currentTime={isMinigameActive ? minigameTime : audioObj.currentTime}
    duration={isMinigameActive ? 10 : audioObj.duration}
    volume={volume}
    onTogglePlay={(e: any) => {
      e.stopPropagation();
      if (isMinigameActive) {
        if (isMinigamePlaying) {
          minigameAudioRef.current?.pause();
          if (minigameTimeoutRef.current) {
            clearTimeout(minigameTimeoutRef.current);
          }
        } else {
          minigameAudioRef.current?.play();
          const remaining = 10000 - (minigameTime * 1000);
          if (remaining > 0) {
            minigameTimeoutRef.current = setTimeout(() => {
              minigameAudioRef.current?.pause();
            }, remaining);
          } else {
            replayMinigameSnippet();
          }
        }
      } else {
        handlePlaySong(currentSong!);
      }
    }}
    onNext={isMinigameActive ? () => {} : handleNext}
    onPrevious={isMinigameActive ? () => {} : handlePrevious}
    isShuffle={socketObj.isShuffle}
    isLoop={socketObj.isLoop}
    onToggleShuffle={(e: any) => {
      e.stopPropagation();
      if (!isMinigameActive) {
        toggleShuffle();
      }
    }}
    onToggleLoop={(e: any) => {
      e.stopPropagation();
      if (!isMinigameActive) {
        toggleLoop();
      }
    }}
    onSeek={(t: any) => {
      if (isMinigameActive) {
        if (minigameAudioRef.current && t <= 10) {
          minigameAudioRef.current.currentTime = t;
        }
      } else {
        if (audioObj.audioRef.current) {
          audioObj.audioRef.current.currentTime = t;
          socketObj.emitCommand("seek", { time: t });
        }
      }
    }}
    onVolumeChange={setVolume}
    onToggleLyrics={(e: any) => {
      e.stopPropagation();
      if (!isMinigameActive) {
        setIsLyricsOpen(!isLyricsOpen);
      }
    }}
    onOpenFullPlayer={() => {
      if (!isMinigameActive) {
        setIsFullPlayerOpen(true);
      }
    }}
    onToggleFocusMode={() => {
      if (!isMinigameActive) {
        setIsFocusMode(!isFocusMode);
      }
    }}
    isFocusMode={isFocusMode}
    activeTheme={activeTheme}
  />
</motion.div>
  )}
</AnimatePresence>

      <MinigameLobbyOverlay isOpen={isMinigameLobbyOpen} onClose={() => setIsMinigameLobbyOpen(false)} onStart={startMinigame} />
      <AnimatePresence>{tabsSong && <TabsOverlay song={tabsSong} onClose={() => setTabsSong(null)} />}</AnimatePresence>
      <AnimatePresence>{isLyricsOpen && <LyricsOverlay isOpen={isLyricsOpen} onClose={() => setIsLyricsOpen(false)} currentSong={currentSong} currentTime={audioObj.currentTime} onSeek={(t:any) => { if(audioObj.audioRef.current) audioObj.audioRef.current.currentTime = t; }} />}</AnimatePresence>
      <AnimatePresence>{isFullPlayerOpen && <FullPlayerOverlay isOpen={isFullPlayerOpen} onClose={() => setIsFullPlayerOpen(false)} currentSong={currentSong} isPlaying={isPlaying} onTogglePlay={() => { handlePlaySong(currentSong!); }} onNext={handleNext} onPrevious={handlePrevious} currentTime={audioObj.currentTime} duration={audioObj.duration} onSeek={(t) => {
    if (audioObj.audioRef.current) {
        audioObj.audioRef.current.currentTime = t;
    }
}} volume={volume} onVolumeChange={setVolume} isShuffle={socketObj.isShuffle} isLoop={socketObj.isLoop} onToggleShuffle={toggleShuffle} onToggleLoop={toggleLoop} onToggleLyrics={() => { setIsFullPlayerOpen(false); setIsLyricsOpen(true); }} onToggleQueue={() => setIsQueueOpen(true)} activeTheme={activeTheme} onOpenMinigameLobby={() => { setIsFullPlayerOpen(false); setIsMinigameLobbyOpen(true); }} />}</AnimatePresence>
      <AnimatePresence>{isQueueOpen && <QueueOverlay
  isOpen={isQueueOpen}
  onClose={() => setIsQueueOpen(false)}
  queue={getCurrentPlayPool()}
  currentSong={currentSong}
  onPlayFromQueue={handlePlaySong}
  onReorderQueue={handleReorderQueue}
  isShuffle={socketObj.isShuffle}
  activeTheme={activeTheme}
/>}</AnimatePresence>
      <AnimatePresence>{isSocialOpen && <SocialSidebar token={token} user={user} socket={socketObj.socketRef.current} unreadSenders={socketObj.unreadSenders} setUnreadSenders={socketObj.setUnreadSenders} currentSession={socketObj.currentSession} onClose={() => setIsSocialOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{socketObj.activeInvite && ( <div className="fixed top-20 right-8 z-[500]"><motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="bg-[#121212] border border-brand-primary/30 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-white"><p className="text-xs font-bold tabular-nums">{socketObj.activeInvite.from} invited you.</p><button onClick={() => { handleJoinSession(socketObj.activeInvite!.code); socketObj.setActiveInvite(null); }} className="bg-brand-primary text-black font-bold py-2 rounded-lg text-[10px]">Join</button></motion.div></div> )}</AnimatePresence>
      <AnimatePresence>{isAuthModalOpen && ( <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"><motion.div className="bg-[#121212] border border-white/10 rounded-2xl p-8 w-full max-w-sm relative text-white shadow-2xl"><AuthForm onSuccess={handleLoginSuccess} onCancel={() => setIsAuthModalOpen(false)} /></motion.div></div> )}</AnimatePresence>
      <AnimatePresence>{isPersonalizationOpen && <PersonalizationOverlay token={token} activeTheme={activeTheme} onThemeSelect={(id: string) => { setActiveTheme(id); localStorage.setItem('aura_theme', id); }} onBackgroundUpload={(url: string) => {setCustomBg(url);}} onClose={() => setIsPersonalizationOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{isProfileOpen && ( <ProfileOverlay token={token} isNormalizerEnabled={isNormalizerEnabled} onToggleNormalizer={(val: boolean) => { setIsNormalizerEnabled(val); localStorage.setItem('aura_norm', String(val)); }} onClose={() => setIsProfileOpen(false)} /> )}</AnimatePresence>
      <AnimatePresence>{isSessionOpen && ( <SessionOverlay onClose={() => setIsSessionOpen(false)} token={token} user={user} currentSession={socketObj.currentSession} messages={socketObj.sessionMessages} onSendMessage={handleSendChat} onCreateSession={handleStartSession} onJoinSession={handleJoinSession} onLeaveSession={() => { socketObj.setCurrentSession(null); socketObj.setSessionMessages([]); }} /> )}</AnimatePresence>

      <AnimatePresence>{isCreatePlaylistOpen && ( 
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 text-white">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-2xl p-8 w-full max-w-sm relative text-white shadow-2xl">
            <h3 className="text-xl font-bold uppercase mb-4 text-white">Create Playlist</h3>
            <form onSubmit={handleCreatePlaylist}> 
              <input 
                type="text" placeholder="Playlist Name" required 
                value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} 
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white mb-6 outline-none focus:border-brand-primary transition-all font-bold" 
              />
              <div className="flex gap-4">
                <button type="button" onClick={() => setIsCreatePlaylistOpen(false)} className="flex-1 text-[10px] font-bold uppercase text-white/40">Cancel</button>
                <button type="submit" className="flex-1 bg-brand-primary text-black py-3 rounded-xl font-bold uppercase text-xs">Create</button>
              </div>
            </form>
          </motion.div>
        </div> 
      )}</AnimatePresence>

      <AnimatePresence>{songToEdit && ( <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 text-white overflow-y-auto py-10"><motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-3xl p-8 w-full max-w-lg relative text-white shadow-2xl"><button onClick={() => setSongToEdit(null)} className="absolute top-6 right-6 cursor-pointer text-white/40 hover:text-white transition-colors"><X size={24}/></button><form onSubmit={handleUpdateMetadata} className="space-y-6"><h3 className="text-2xl uppercase font-bold font-serif italic mb-8">Edit Track Metadata</h3><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Title</label><input value={songToEdit.title} onChange={e => setSongToEdit({...songToEdit, title: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" /></div><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Artist</label><input value={songToEdit.artist} onChange={e => setSongToEdit({...songToEdit, artist: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" /></div></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Album</label><input value={songToEdit.album || ""} onChange={e => setSongToEdit({...songToEdit, album: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" /></div><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Track Number</label><input type="number" value={songToEdit.track_number || ""} onChange={e => setSongToEdit({...songToEdit, track_number: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" /></div></div><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Tabs URL</label><input placeholder="Songsterr / Ultimate Guitar URL" value={songToEdit.tabs_url || ""} onChange={e => setSongToEdit({...songToEdit, tabs_url: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" /></div><div className="space-y-1"><label className="text-[10px] uppercase font-bold text-white/30 ml-2">Cover Art</label><div className="flex items-center gap-4"><div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10">{newEditCover ? ( <img src={URL.createObjectURL(newEditCover)} className="w-full h-full object-cover" /> ) : ( <img src={songToEdit.coverUrl} className="w-full h-full object-cover" /> )}</div><label className="flex-1 cursor-pointer bg-white/5 border-2 border-dashed border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center hover:bg-white/10 transition-all"><ImageIcon size={20} className="text-white/20 mb-1"/><span className="text-[10px] font-bold uppercase text-white/40">Change Artwork</span><input type="file" accept="image/*" onChange={e => e.target.files && setNewEditCover(e.target.files[0])} className="hidden" /></label></div></div><div className="pt-4 flex gap-4"><button type="button" onClick={() => setSongToEdit(null)} className="flex-1 bg-white/5 py-4 rounded-2xl uppercase font-bold text-[10px] tracking-widest hover:bg-white/10 transition-all">Cancel</button><button type="submit" className="flex-1 bg-white text-black py-4 rounded-2xl uppercase font-bold text-[10px] tracking-widest hover:scale-[1.02] transition-all">Save Changes</button></div></form></motion.div></div> )}</AnimatePresence>

      <AnimatePresence>{trackToDelete && ( 
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 text-white">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="bg-[#121212] border border-red-500/20 rounded-3xl p-10 w-full max-w-md shadow-2xl text-center text-white">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
                    <AlertTriangle size={32} />
                </div>
                <h3 className="text-xl font-bold uppercase tracking-tighter mb-2 font-serif italic text-white text-glow">Permanent Removal</h3>
                <p className="text-white/40 text-sm font-medium mb-10 leading-relaxed">This will erase the song from the database AND the hard drive. This cannot be undone.</p>
                <div className="flex gap-4">
                    <button onClick={() => setTrackToDelete(null)} className="flex-1 bg-white/5 py-3 rounded-xl font-bold uppercase text-[10px] tracking-widest hover:bg-white/10 transition-all">Cancel</button>
                    <button onClick={confirmDeleteTrack} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-bold uppercase text-[10px] tracking-widest shadow-2xl transition-all">Confirm Erase</button>
                </div>
            </motion.div>
        </div> 
      )}</AnimatePresence>
    </div>
  );
}