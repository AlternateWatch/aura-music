import { useState, useEffect, useRef, useMemo, FormEvent, lazy, Suspense } from "react";
import { Background } from "./components/Background";
import { PlayerBar } from "./components/PlayerBar";
import { MusicCard } from "./components/MusicCard";
import { Visualizer } from "./components/Visualizer";
import { type Song, type Playlist } from "./constants";
import { THEMES } from "./constants/themes";
import { useFileUrl, resolveFileUrl } from "./hooks/useFileUrl";
import {
 Plus, Trash2, LogOut, ShieldCheck, Search, AlertTriangle, Edit2, Palette, Users,
  MinusCircle, ListPlus, SquarePlay, DoorOpen, ArrowUpDown, Filter, Clock, Image as ImageIcon,
  ChevronLeft, ChevronRight, Menu, Heart, Play, Trophy, Disc, FileText, Film,Library,
Music2,
MessageCircle,
Settings,
User,
X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { FullPlayerOverlay } from "./components/FullPlayerOverlay";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import AuraMedia from './plugins/auraMedia';

// Pantallas que no hacen falta en el primer render (solo se abren bajo
// demanda desde un botón/menú) — se cargan en su propio "trozo" (chunk)
// aparte, no como parte del bundle principal. Así el bundle principal pesa
// menos y arranca más rápido; estos componentes se descargan en paralelo,
// sin bloquear nada, y para cuando el usuario los abre normalmente ya están
// listos. No cambia ni el aspecto ni el comportamiento de ninguno de ellos.
const LazyTabsOverlay = lazy(() => import("./components/TabsOverlay").then(m => ({ default: m.TabsOverlay })));
const LazyProfileOverlay = lazy(() => import("./components/ProfileOverlay").then(m => ({ default: m.ProfileOverlay })));
const LazyPersonalizationOverlay = lazy(() => import("./components/PersonalizationOverlay").then(m => ({ default: m.PersonalizationOverlay })));
const LazyQueueOverlay = lazy(() => import("./components/QueueOverlay").then(m => ({ default: m.QueueOverlay })));
const LazySessionOverlay = lazy(() => import("./components/SessionOverlay").then(m => ({ default: m.SessionOverlay })));
const LazyMinigameLobbyOverlay = lazy(() => import("./components/MinigameLobbyOverlay").then(m => ({ default: m.MinigameLobbyOverlay })));
const LazyLyricsOverlay = lazy(() => import("./components/LyricsOverlay").then(m => ({ default: m.LyricsOverlay })));
const LazyMusicUpload = lazy(() => import("./components/MusicUpload").then(m => ({ default: m.MusicUpload })));
const LazySocialSidebar = lazy(() => import("./hooks/SocialSidebar").then(m => ({ default: m.SocialSidebar })));

// MODULED IMPORTS AND HOOKS
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSocketLogic } from "./hooks/useSocketLogic";
import { AuthForm } from "./hooks/AuthSection";
import { useMediaSession } from "./hooks/useMediaSession";
import { useWindowsThumbbar } from "./hooks/useWindowsThumbbar";
import { prefetchAudio } from "./utils/audioCache";

// HELPER: Extrae múltiples artistas separados por punto y coma (;)
const parseArtists = (artistStr?: string | null): string[] => {
  if (!artistStr) return [];
  return artistStr.split(';').map(a => a.trim()).filter(Boolean);
};

// HELPER: Detecta si un archivo es vídeo (.mp4, .webm)
const isVideoUrl = (url?: string | null) => {
  if (!url) return false;
  return /\.(mp4|webm|mov)($|\?)/i.test(url);
};

export default function App() {
  // --- DETECCIÓN Y ACCIONES DE ESCRITORIO ---
  const isDesktop = typeof window !== 'undefined' && (
    window.location.search.includes('app=desktop') ||
    Boolean((window as any).__TAURI__) ||
    Boolean((window as any).__TAURI_INTERNALS__)
  );

  const handleMinimize = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
      return;
    } catch (err) {}
    try {
      if ((window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|minimize');
      }
    } catch (err) {}
  };

  const handleMaximize = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
      return;
    } catch (err) {}
    try {
      if ((window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|toggle_maximize');
      }
    } catch (err) {}
  };

  const handleClose = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return;
    } catch (err) {}
    try {
      if ((window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close');
      }
    } catch (err) {}
  };

  const API_BASE = "https://aura.basildo.me";

  const resolveMediaUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;

  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('firestore-file://')
  ) {
    return url;
  }

  if (url.startsWith('/uploads/')) {
    return `${API_BASE}${url}`;
  }

  return url;
};

  // --- CORE STATE ---
  const [token, setToken] = useState<string | null>(localStorage.getItem('aura_token'));
  const [user, setUser] = useState<any>(localStorage.getItem('aura_user') ? JSON.parse(localStorage.getItem('aura_user')!) : null);
  const [userRole, setUserRole] = useState(localStorage.getItem('aura_role') || "user");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  

  // 1. CARGA INMEDIATA DE LA ÚLTIMA CANCIÓN DESDE DISCO
  const [currentSong, setCurrentSong] = useState<Song | null>(() => {
    try {
      const saved = localStorage.getItem('aura_last_song');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isNormalizerEnabled, setIsNormalizerEnabled] = useState(localStorage.getItem('aura_norm') === 'true');
  const [activePlaylistId, setActivePlaylistId] = useState<string>("all");
  const [playlists, setPlaylists] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showModeration, setShowModeration] = useState(false);
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [artistBio, setArtistBio] = useState<string | null>(null);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [newBioText, setNewBioText] = useState("");
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  // Se pone a true cuando la primera carga de canciones + las carátulas que
  // se ven primero ya están precargadas en el navegador (ver loadContent /
  // el efecto de precarga de la rejilla / loadLastTrack).
  const [initialContentReady, setInitialContentReady] = useState(false);
  const initialContentReadyRef = useRef(false);
  useEffect(() => { initialContentReadyRef.current = initialContentReady; }, [initialContentReady]);
  const splashGateRef = useRef({ minElapsed: false });
  // Dos señales independientes: la rejilla de la biblioteca (primeras
  // tarjetas visibles) y el hero banner (carátula de currentSong). Solo
  // cuando las dos están listas consideramos el contenido inicial "listo".
  const readinessRef = useRef({ grid: false, hero: false });
  const gridPreloadedRef = useRef(false);
  const hasHandledLastTrackRef = useRef(false);
  const maybeMarkInitialContentReady = () => {
    if (readinessRef.current.grid && readinessRef.current.hero) {
      setInitialContentReady(true);
    }
  };

  // El splash se queda visible hasta que el contenido inicial (canciones +
  // carátulas que se ven primero) esté precargado, para que el usuario nunca
  // vea cómo "aparecen" las imágenes al entrar. MIN_SPLASH_MS evita que
  // parpadee si todo carga muy rápido; MAX_SPLASH_MS es un límite de
  // seguridad por si la red va lenta o algo falla, para no dejar al usuario
  // atascado en el splash para siempre.
  //
  // splashGateRef guarda si ya pasó el tiempo mínimo en un ref para que el
  // efecto de arranque (que solo corre una vez) y el efecto que reacciona a
  // "initialContentReady" puedan comprobar la misma cosa sin reiniciarse
  // el uno al otro.
  useEffect(() => {
    if (splashGateRef.current.minElapsed && initialContentReady) {
      setShowSplash(false);
    }
  }, [initialContentReady]);

  useEffect(() => {
    const MIN_SPLASH_MS = 1000;
    const MAX_SPLASH_MS = 4500;
    const gate = splashGateRef.current;

    const minTimer = setTimeout(() => {
      gate.minElapsed = true;
      if (initialContentReadyRef.current) {
        setShowSplash(false);
      }
    }, MIN_SPLASH_MS);

    const maxTimer = setTimeout(() => {
      setShowSplash(false);
    }, MAX_SPLASH_MS);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  // ESTADO DE FOTOS DE PERFIL DE ARTISTAS
  const [artistImageUrl, setArtistImageUrl] = useState<string | null>(null);
  const resolvedArtistImageUrl = useFileUrl(artistImageUrl);
  const [artistsMap, setArtistsMap] = useState<Record<string, { bio: string | null; image_url: string | null }>>({});

  const [formatFilter, setFormatFilter] = useState<'all' | 'mp3' | 'flac'>('all');
  const [sortBy, setSortBy] = useState<string>('first');
  const [searchQuery, setSearchQuery] = useState(""); 
  const [activeQueue, setActiveQueue] = useState<Song[]>([]);
  const [activeTheme, setActiveTheme] = useState(localStorage.getItem('aura_theme') || 'dark');
  const [customBg, setCustomBg] = useState(user?.custom_bg_path || null);
  const [isSocialOpen, setIsSocialOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  
  // METADATA EDITING STATES
  const [songToEdit, setSongToEdit] = useState<any | null>(null);
  const [newEditCover, setNewEditCover] = useState<File | null>(null);
  const [newEditAnimatedCover, setNewEditAnimatedCover] = useState<File | null>(null);
  
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPersonalizationOpen, setIsPersonalizationOpen] = useState(false);
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [tabsSong, setTabsSong] = useState<Song | null>(null);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [heroImageError, setHeroImageError] = useState(false);
  const isGoingBackRef = useRef(false);

  // HISTORIAL
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>(() => {
    try {
      const saved = localStorage.getItem('aura_recent');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const navigationHistoryRef = useRef<
  Array<{
    playlistId: string;
    albumName: string | null;
    artistName: string | null;
  }>
>([]);

const previousNavigationRef = useRef({
  playlistId: activePlaylistId,
  albumName: selectedAlbumName,
  artistName: selectedArtistName,
});

useEffect(() => {
  const previous = previousNavigationRef.current;

  const changed =
    previous.playlistId !== activePlaylistId ||
    previous.albumName !== selectedAlbumName ||
    previous.artistName !== selectedArtistName;

  if (!changed) return;

  if (isGoingBackRef.current) {
    isGoingBackRef.current = false;
  } else {
    navigationHistoryRef.current.push(previous);
  }

  previousNavigationRef.current = {
    playlistId: activePlaylistId,
    albumName: selectedAlbumName,
    artistName: selectedArtistName,
  };
}, [
  activePlaylistId,
  selectedAlbumName,
  selectedArtistName,
]);
  const [dynamicColor, setDynamicColor] = useState<string>('#6366f1');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [likedIds, setLikedIds] = useState<string[]>([]);

  // --- REGLAS DE COLA: CONTEXTO DE REPRODUCCIÓN ---
  const [playbackContext, setPlaybackContext] = useState<'library' | 'album' | 'playlist'>('library');
  const [contextAlbumName, setContextAlbumName] = useState<string | null>(null);

  // --- MINIGAME STATE ---
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
  const resolvedAnimatedCoverUrl = useFileUrl((currentSong as any)?.animated_cover_path || (currentSong as any)?.animatedCoverUrl);
  const resolvedAudioUrl = useFileUrl(currentSong?.audioUrl);
  const resolvedCustomBg = useFileUrl(customBg);
  const resolvedProfilePic = useFileUrl(user?.profile_pic_path);

  // --- LOGIC MODULES ---
  const audioObj = useAudioEngine(currentSong, isPlaying, volume, isNormalizerEnabled, setIsPlaying, resolvedAudioUrl);
  const socketObj = useSocketLogic(user, handlePlaySongRef, setIsPlaying, audioObj.audioRef.current, setActiveQueue);
  const mainRef = useRef<HTMLElement | null>(null);
  
  useEffect(() => { handlePlaySongRef.current = handlePlaySong; });

 useEffect(() => {
  const main = mainRef.current;
  if (!main) return;

  let lastScrollTop = main.scrollTop;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;

  // La lógica real solo se ejecuta una vez por frame (rAF), aunque el
  // navegador dispare el evento "scroll" muchas más veces durante el
  // fling/momentum scroll — mismo comportamiento, menos trabajo.
  const processScroll = () => {
    rafId = null;

    // En escritorio la barra siempre permanece visible
    if (window.innerWidth >= 768) {
      setMobileNavVisible(true);
      lastScrollTop = main.scrollTop;
      return;
    }

    const currentScrollTop = main.scrollTop;
    const delta = currentScrollTop - lastScrollTop;

    // Reiniciamos el temporizador cada vez que hay movimiento
    if (showTimer) {
      clearTimeout(showTimer);
    }

    // Si estamos arriba del todo, mostrar inmediatamente
    if (currentScrollTop <= 10) {
      setMobileNavVisible(true);
    }
    // Scroll hacia abajo → ocultar
    else if (delta > 4) {
      setMobileNavVisible(false);
    }
    // Scroll hacia arriba → mostrar
    else if (delta < -4) {
      setMobileNavVisible(true);
    }

    lastScrollTop = currentScrollTop;

    // Si pasan 2 segundos sin movimiento → mostrar
    showTimer = setTimeout(() => {
      setMobileNavVisible(true);
    }, 2000);
  };

  const handleScroll = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(processScroll);
    }
  };

  main.addEventListener("scroll", handleScroll, { passive: true });

  return () => {
    main.removeEventListener("scroll", handleScroll);

    if (showTimer) {
      clearTimeout(showTimer);
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  };
}, []);


useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  const handleBackButton = async () => {
    // 1. Overlays/modales: cerrar primero
    if (isLyricsOpen) {
      setIsLyricsOpen(false);
      return;
    }

    if (isQueueOpen) {
      setIsQueueOpen(false);
      return;
    }

    if (isFullPlayerOpen) {
      setIsFullPlayerOpen(false);
      return;
    }

    if (isSocialOpen) {
      setIsSocialOpen(false);
      return;
    }

    if (isSessionOpen) {
      setIsSessionOpen(false);
      return;
    }

    if (isProfileOpen) {
      setIsProfileOpen(false);
      return;
    }

    if (isPersonalizationOpen) {
      setIsPersonalizationOpen(false);
      return;
    }

    if (showUpload) {
      setShowUpload(false);
      return;
    }

    if (isCreatePlaylistOpen) {
      setIsCreatePlaylistOpen(false);
      return;
    }

    if (tabsSong) {
      setTabsSong(null);
      return;
    }

    if (songToEdit) {
      setSongToEdit(null);
      return;
    }

    // 2. Si tenemos navegación anterior, volver a ella
    const previous = navigationHistoryRef.current.pop();

    if (previous) {
  isGoingBackRef.current = true;

  setActivePlaylistId(previous.playlistId);
  setSelectedAlbumName(previous.albumName);
  setSelectedArtistName(previous.artistName);

  return;
}

    // 3. Si no hay navegación interna, comportamiento normal de Android
    CapacitorApp.exitApp();
  };

  const listener = CapacitorApp.addListener("backButton", handleBackButton);

  return () => {
    listener.then(handle => handle.remove());
  };
}, [
  isLyricsOpen,
  isQueueOpen,
  isFullPlayerOpen,
  isSocialOpen,
  isSessionOpen,
  isProfileOpen,
  isPersonalizationOpen,
  showUpload,
  isCreatePlaylistOpen,
  tabsSong,
  songToEdit,
]);
  

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

 useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  SystemBars.setStyle({
    style: SystemBarsStyle.Dark,
  });

  SystemBars.hide();
}, []);

  useEffect(() => {
    if (!socketObj.currentSession || !isPlaying || !currentSong) return;
    const heartbeat = setInterval(() => {
        socketObj.emitCommand('sync-time', { position: audioObj.getCurrentTime(), songId: currentSong.id });
    }, 10000); 
    return () => clearInterval(heartbeat);
  }, [socketObj.currentSession, isPlaying, currentSong?.id]);

  // CARGAR BIOGRAFÍA Y FOTO DEL ARTISTA
  useEffect(() => {
    if (!selectedArtistName) {
      setArtistBio(null);
      setArtistImageUrl(null);
      return;
    }
    setIsBioExpanded(false);

    const cached = artistsMap[selectedArtistName];
    if (cached) {
      setArtistBio(cached.bio);
      setNewBioText(cached.bio || "");
      setArtistImageUrl(cached.image_url);
    } else {
      setArtistBio(null);
      setArtistImageUrl(null);
    }

    fetch(`${API_BASE}/api/artists/${encodeURIComponent(selectedArtistName)}`)
      .then(res => res.json())
      .then(data => {
        setArtistBio(data.bio || null);
        setNewBioText(data.bio || "");
        setArtistImageUrl(data.image_url || null);
        setArtistsMap(prev => ({
          ...prev,
          [selectedArtistName]: { bio: data.bio || null, image_url: data.image_url || null }
        }));
      })
      .catch(() => {
        setArtistBio(null);
        setArtistImageUrl(null);
      });
  }, [selectedArtistName]);

  const handleSaveArtistBio = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedArtistName) return;
    try {
      const res = await fetch(`${API_BASE}/api/artists/${encodeURIComponent(selectedArtistName)}/bio`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ bio: newBioText })
      });
      if (res.ok) {
        setArtistBio(newBioText);
        setArtistsMap(prev => ({
          ...prev,
          [selectedArtistName]: { ...prev[selectedArtistName], bio: newBioText }
        }));
        setIsEditingBio(false);
      }
    } catch (err) {
      console.error("Error guardando biografía:", err);
    }
  };

  const handleUploadArtistImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedArtistName) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch(`${API_BASE}/api/artists/${encodeURIComponent(selectedArtistName)}/image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        setArtistImageUrl(data.image_url);
        setArtistsMap(prev => ({
          ...prev,
          [selectedArtistName]: { ...prev[selectedArtistName], image_url: data.image_url }
        }));
      } else {
        alert("No se pudo subir la foto del artista.");
      }
    } catch (err) {
      console.error("Error al subir foto del artista:", err);
    }
  };
  
  const handleLoginSuccess = (t: string, u: any, r: string) => {
    localStorage.setItem('aura_token', t); localStorage.setItem('aura_user', JSON.stringify(u)); localStorage.setItem('aura_role', r);
    window.location.reload(); 
  };
  const handleLogout = () => { localStorage.clear(); window.location.reload(); };

  const handleStartSession = async () => {
    const activeToken = token || localStorage.getItem('aura_token');
    const res = await fetch(`${API_BASE}/api/sessions/create`, { method: 'POST', headers: { 'Authorization': `Bearer ${activeToken}` } });
    const data = await res.json();
    if (res.ok) { socketObj.setCurrentSession(data.code); socketObj.socketRef.current?.emit('join-session', { code: data.code, user }); }
  };
  const handleJoinSession = (code: string) => { socketObj.setCurrentSession(code); socketObj.socketRef.current?.emit('join-session', { code, user }); };
  const handleSendChat = (message: string) => { if (socketObj.currentSession) socketObj.socketRef.current?.emit('send-chat', { code: socketObj.currentSession, user, message }); };

  // Precarga una imagen en el caché del navegador antes de que ningún <img>
  // la pida "de verdad". Nunca rechaza (un fallo o timeout cuentan como
  // "resuelta") para que una sola carátula rota/lenta no bloquee el resto.
  const preloadImage = (src?: string): Promise<void> => {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const img = new Image();
      img.onload = () => {
        // onload solo garantiza que ya han llegado los bytes; decode()
        // fuerza además a que el bitmap quede completamente decodificado y
        // listo para pintarse sin coste extra. Sin esto, el <img> real del
        // Full Player podía disparar su propia decodificación "en frío"
        // justo durante la animación de apertura del panel, que es cuando
        // se notaba que la carátula tardaba en aparecer.
        if (typeof img.decode === "function") {
          img.decode().then(finish).catch(finish);
        } else {
          finish();
        }
      };
      img.onerror = finish;
      img.src = src;
      setTimeout(finish, 3000);
    });
  };

  // Igual que preloadImage, pero primero resuelve la URL (por si es una
  // referencia firestore-file:// que necesita ir a buscar la URL real a
  // Firebase antes de poder precargarla) — la misma resolución que usa el
  // hero banner internamente vía useFileUrl.
  const preloadHeroCover = async (rawUrl?: string): Promise<void> => {
    if (!rawUrl) return;
    try {
      const resolved = await resolveFileUrl(rawUrl);
      await preloadImage(resolved);
    } catch (e) {
      // Si la resolución falla, no bloqueamos nada más.
    }
  };

  const isAnimatedCoverVideo = (url?: string | null) => {
    if (!url) return false;
    return /\.(mp4|webm|mov|mkv)($|\?)/i.test(url);
  };

  // Como preloadImage, pero para vídeo: crea un <video> fuera del DOM y
  // espera a que decodifique el primer frame (loadeddata), no solo a que
  // lleguen los bytes. Es justo ese trabajo — fetch + arranque del decoder —
  // el que se nota como lag la primera vez que se monta un <video> "en
  // frío" (por ejemplo, al abrir el Full Player por primera vez tras
  // arrancar la app). Los vídeos pesan más que una imagen, así que el
  // timeout de seguridad es más largo.
  const preloadVideo = (src?: string): Promise<void> => {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const video = document.createElement('video');
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('error', finish);
        resolve();
      };
      video.muted = true;
      video.preload = 'auto';
      (video as any).playsInline = true;
      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('error', finish, { once: true });
      video.src = src;
      video.load();
      setTimeout(finish, 6000);
    });
  };

  // Precarga en segundo plano (sin bloquear el splash) la portada animada
  // de la canción actual. No forma parte de la condición que oculta el
  // splash a propósito: un vídeo puede pesar varios MB y no queremos que
  // eso alargue el arranque — solo queremos que empiece a descargarse y
  // decodificarse cuanto antes, para que si el usuario abre el Full Player
  // o el Modo Focus poco después, ya esté listo.
  const preloadAnimatedCover = async (rawUrl?: string | null) => {
    if (!rawUrl) return;
    try {
      const resolved = await resolveFileUrl(rawUrl);
      if (!resolved) return;
      if (isAnimatedCoverVideo(resolved)) {
        await preloadVideo(resolved);
      } else {
        await preloadImage(resolved);
      }
    } catch (e) {
      // Best-effort: si falla, no pasa nada — se cargará normal al abrir.
    }
  };

  const loadContent = async () => {
    setIsLoading(true);
    try {
      const activeToken = token || localStorage.getItem('aura_token');
      const endpoint = activePlaylistId === 'all' || activePlaylistId === 'liked' ? `/api/tracks?status=${showModeration ? 'pending' : 'approved'}` : `/api/playlists/${activePlaylistId}/tracks`;
      const res = await fetch(`${API_BASE}${endpoint}`, { headers: { 'Authorization': `Bearer ${activeToken}` } });
      const data = await res.json();
      if (Array.isArray(data)) {
        const mapped = data.map((s: any) => ({
            ...s,
            id: s.id.toString(),
            coverUrl: resolveMediaUrl(s.cover_path),
            animatedCoverUrl: resolveMediaUrl(s.animated_cover_path),
            audioUrl: resolveMediaUrl(s.file_path),
            uploaderId: s.added_by?.toString(),
            tabs_url: s.tabs_url,
            track_number: s.track_number,
            format: s.format,
            video_url: s.video_url
        }));
        setSongs(mapped);
        setLikedIds(data.filter((s: any) => s.is_liked).map((s: any) => s.id.toString()));

        const allIndividualArtists = Array.from(new Set(
          data.flatMap((s: any) => parseArtists(s.artist))
        ));

        allIndividualArtists.forEach((artistName: any) => {
          fetch(`${API_BASE}/api/artists/${encodeURIComponent(artistName)}`)
            .then(r => r.json())
            .then(artistData => {
              if (artistData && (artistData.image_url || artistData.bio)) {
                setArtistsMap(prev => ({
                  ...prev,
                  [artistName]: { bio: artistData.bio, image_url: artistData.image_url }
                }));
              }
            })
            .catch(() => {});
        });
      }
    } catch (e) {
      console.error("Load failed");
    }
    setIsLoading(false);
  };

  const loadPlaylists = async () => {
    const activeToken = token || localStorage.getItem('aura_token');
    if (!activeToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/playlists`, { headers: { 'Authorization': `Bearer ${activeToken}` } });
      const data = await res.json();
      if (Array.isArray(data)) setPlaylists(data);
    } catch (e) { console.error("Playlists failed"); }
  };

  const loadLastTrack = async () => {
    // El hero banner muestra currentSong.coverUrl desde el primer render
    // (viene del último dato guardado en localStorage). Aquí solo nos
    // interesa: (a) precargar esa carátula por si el navegador no la tiene
    // ya en caché, y (b) si el servidor dice que la última canción es OTRA
    // distinta, precargar la nueva ANTES de aplicarla, para que el hero
    // banner nunca cambie de imagen "en vivo" delante del usuario.
    const isFirstRun = !hasHandledLastTrackRef.current;
    const markHeroReady = () => {
      if (!isFirstRun) return;
      hasHandledLastTrackRef.current = true;
      readinessRef.current.hero = true;
      maybeMarkInitialContentReady();
    };

    const localCoverPreload = preloadHeroCover(currentSong?.coverUrl);

    const activeToken = token || localStorage.getItem('aura_token');
    if (!activeToken) {
      await localCoverPreload;
      markHeroReady();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/users/me/last-track`, {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (!res.ok) { await localCoverPreload; markHeroReady(); return; }
      const data = await res.json();
      if (!data) { await localCoverPreload; markHeroReady(); return; }

      const lastSong: Song = {
        ...data,
        id: data.id.toString(),
        coverUrl: resolveMediaUrl(data.cover_path),
        animatedCoverUrl: resolveMediaUrl(data.animated_cover_path),
        audioUrl: resolveMediaUrl(data.file_path),
        uploaderId: data.added_by?.toString(),
        tabs_url: data.tabs_url,
        track_number: data.track_number,
        format: data.format,
        video_url: data.video_url
      };

      if (lastSong.id === currentSong?.id) {
        await localCoverPreload;
      } else {
        await preloadHeroCover(lastSong.coverUrl);
      }

      setCurrentSong(lastSong);
      setIsPlaying(false);
      localStorage.setItem('aura_last_song', JSON.stringify(lastSong));
      markHeroReady();
    } catch (error) {
      console.error("Error loading last track from server:", error);
      markHeroReady();
    }
  };

  useEffect(() => { loadContent(); }, [showModeration, activePlaylistId]);
  useEffect(() => { loadPlaylists(); }, [token]);
  useEffect(() => { loadLastTrack(); }, [token]);

  // En cuanto se sabe cuál es la canción actual —ya sea la del arranque
  // (recuperada de localStorage) o una nueva que el usuario acaba de
  // seleccionar—, nos adelantamos y precargamos tanto su portada animada
  // como su portada estática normal. Antes esto solo pasaba para la canción
  // inicial, así que al elegir una canción distinta y abrir el Full Player
  // justo después, su <img> se montaba "en frío" (sin decodificar todavía)
  // y no se veía hasta que el navegador encontraba un hueco libre, que
  // solía ser justo al terminar la animación de apertura del panel.
  useEffect(() => {
    const raw =
      (currentSong as any)?.animated_cover_path ||
      (currentSong as any)?.animatedCoverUrl;
    preloadAnimatedCover(raw);
    preloadHeroCover(currentSong?.coverUrl);
  }, [currentSong?.id]);

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
    updatedAt: '',
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
    const activeToken = token || localStorage.getItem('aura_token');
    if (!activeToken) return setIsAuthModalOpen(true);
    const res = await fetch(`${API_BASE}/api/tracks/${songId}/like`, { method: 'POST', headers: { 'Authorization': `Bearer ${activeToken}` } });
    if (res.ok) {
        setLikedIds(prev => prev.includes(songId) ? prev.filter(id => id !== songId) : [...prev, songId]);
    }
  };

  // --- PLAYBACK ENGINE Y GUARDADO DE ÚLTIMA CANCIÓN ---
  const handlePlaySong = async (
    song: Song,
    fromSocket = false,
    initialPos = 0,
    preserveQueue = false
  ) => {
    if (currentSong?.id === song.id) {
      const nextState = !isPlaying;
      setIsPlaying(nextState);
      if (!fromSocket) socketObj.emitCommand('toggle-play', { isPlaying: nextState });
      return;
    }

    let finalQueue = activeQueue;

    if (!fromSocket && !preserveQueue) {
      // 1. DESDE UN ÁLBUM
      if (selectedAlbumName) {
        setPlaybackContext('album');
        setContextAlbumName(selectedAlbumName);

        const albumTracks = songs
          .filter(s => s.album === selectedAlbumName)
          .sort((a, b) => (Number(a.track_number) || 9999) - (Number(b.track_number) || 9999));

        const libraryTracks = songs
          .filter(s => s.album !== selectedAlbumName)
          .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        if (socketObj.isShuffle) {
          const otherAlbumSongs = albumTracks.filter(s => s.id !== song.id).sort(() => Math.random() - 0.5);
          const shuffledAlbum = [song, ...otherAlbumSongs];
          const shuffledLibrary = [...libraryTracks].sort(() => Math.random() - 0.5);
          finalQueue = [...shuffledAlbum, ...shuffledLibrary];
          socketObj.setShuffledQueue(finalQueue);
        } else {
          finalQueue = [...albumTracks, ...libraryTracks];
        }
        setActiveQueue(finalQueue);

      // 2. DESDE UNA PLAYLIST
      } else if (activePlaylistId !== 'all') {
        setPlaybackContext('playlist');
        setContextAlbumName(null);

        const playlistSongs = getFlattenedSongs();

        if (socketObj.isShuffle) {
          const otherSongs = playlistSongs.filter(s => s.id !== song.id).sort(() => Math.random() - 0.5);
          finalQueue = [song, ...otherSongs];
          socketObj.setShuffledQueue(finalQueue);
        } else {
          finalQueue = playlistSongs;
        }
        setActiveQueue(finalQueue);

      // 3. DESDE LA BIBLIOTECA GENERAL
      } else {
        setPlaybackContext('library');
        setContextAlbumName(null);

        const allSongs = getFlattenedSongs();

        if (socketObj.isShuffle) {
          const otherSongs = allSongs.filter(s => s.id !== song.id).sort(() => Math.random() - 0.5);
          finalQueue = [song, ...otherSongs];
          socketObj.setShuffledQueue(finalQueue);
        } else {
          finalQueue = allSongs;
        }
        setActiveQueue(finalQueue);
      }
    }

    try {
      localStorage.setItem('aura_last_song', JSON.stringify(song));
    } catch (e) {}

    setRecentlyPlayed(prev => {
      const nextRecent = [song, ...prev.filter(s => s.id !== song.id)].slice(0, 4);
      try {
        localStorage.setItem('aura_recent', JSON.stringify(nextRecent));
      } catch (e) {}
      return nextRecent;
    });

    setCurrentSong(song);
    setIsPlaying(true);
    socketObj.setTrackId(song.id);

    const activeToken = token || localStorage.getItem('aura_token');
    if (!fromSocket && activeToken) {
      fetch(`${API_BASE}/api/users/me/last-track`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ trackId: song.id })
      }).catch(error => console.error("ERROR GUARDANDO LAST TRACK EN SERVIDOR:", error));
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

  const handleNext = async () => {
    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

    if (pool.length === 0) return;

    if (socketObj.isLoop && currentSong) {
      if (audioObj.audioRef.current) {
        audioObj.audioRef.current.currentTime = 0;

        try {
          await audioObj.audioRef.current.play();
        } catch (error) {
          console.error(
            'Error reiniciando canción en loop:',
            error
          );
        }
      }

      setIsPlaying(true);
      return;
    }

    const currentIndex = pool.findIndex((s) => s.id === currentSong?.id);

    if (playbackContext === 'playlist' && currentIndex >= pool.length - 1) {
      if (!socketObj.isLoop) {
        setIsPlaying(false);
        setCurrentSong(null);
        try { localStorage.removeItem('aura_last_song'); } catch (e) {}
        setActiveQueue([]);
        socketObj.setShuffledQueue([]);
        if (audioObj.audioRef.current) {
          audioObj.audioRef.current.pause();
          audioObj.audioRef.current.currentTime = 0;
        }
        socketObj.emitCommand('toggle-play', { isPlaying: false });
        return;
      }
    }

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

    if (audioObj.getCurrentTime() > 3) {
      if (audioObj.audioRef.current) audioObj.audioRef.current.currentTime = 0;
      return;
    }

    if (currentIndex === -1 || currentIndex === 0) {
      if (playbackContext === 'playlist') {
        if (audioObj.audioRef.current) audioObj.audioRef.current.currentTime = 0;
        return;
      }
      handlePlaySong(pool[0], false, 0, true);
      return;
    }

    const previousSong = pool[(currentIndex - 1 + pool.length) % pool.length];
    handlePlaySong(previousSong, false, 0, true);
  };

  // Precarga en segundo plano de la SIGUIENTE canción de la cola en cuanto
  // empieza a sonar la actual (mismo patrón que Spotify/Tidal), para que el
  // salto de pista sea instantáneo y sobreviva a cortes de conexión. Si el
  // SW aún no la ha terminado de cachear cuando el usuario pulsa "siguiente",
  // simplemente se reproduce en streaming normal — no bloquea nada.
  useEffect(() => {
    if (!currentSong) return;

    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

    if (pool.length < 2) return;

    const currentIndex = pool.findIndex((s) => s.id === currentSong.id);
    if (currentIndex === -1) return;

    const nextSong = pool[(currentIndex + 1) % pool.length];
    if (!nextSong || nextSong.id === currentSong.id) return;

    let cancelled = false;
    resolveFileUrl(nextSong.audioUrl).then((url) => {
      if (!cancelled) prefetchAudio(url);
    });

    return () => {
      cancelled = true;
    };
  }, [currentSong?.id, activeQueue, socketObj.isShuffle, socketObj.shuffledQueue]);

  const toggleShuffle = (forcedState?: boolean) => {
    const nextShuffleState =
      forcedState !== undefined
        ? forcedState
        : !socketObj.isShuffle;
    socketObj.setIsShuffle(nextShuffleState);

    AuraMedia.setShuffle({
      enabled: nextShuffleState
    })
      .catch((error) => {
        console.error(
          '[AURA MEDIA] Error enviando shuffle:',
          error
        );
      });
    let newShuffled: Song[] = [];

    if (nextShuffleState) {
      if (playbackContext === 'album' && contextAlbumName) {
        const albumTracks = songs
          .filter(s => s.album === contextAlbumName)
          .sort((a, b) => (Number(a.track_number) || 9999) - (Number(b.track_number) || 9999));
        const libraryTracks = songs
          .filter(s => s.album !== contextAlbumName)
          .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        const otherAlbumSongs = albumTracks.filter(s => s.id !== currentSong?.id).sort(() => Math.random() - 0.5);
        const shuffledAlbum = currentSong ? [currentSong, ...otherAlbumSongs] : otherAlbumSongs;
        const shuffledLibrary = [...libraryTracks].sort(() => Math.random() - 0.5);
        newShuffled = [...shuffledAlbum, ...shuffledLibrary];
      } else {
        const currentPool = activeQueue.length > 0 ? activeQueue : getFlattenedSongs();
        const otherSongs = currentPool.filter(s => s.id !== currentSong?.id).sort(() => Math.random() - 0.5);
        newShuffled = currentSong ? [currentSong, ...otherSongs] : [...currentPool].sort(() => Math.random() - 0.5);
      }
      socketObj.setShuffledQueue(newShuffled);
    } else {
      if (playbackContext === 'album' && contextAlbumName) {
        const albumTracks = songs
          .filter(s => s.album === contextAlbumName)
          .sort((a, b) => (Number(a.track_number) || 9999) - (Number(b.track_number) || 9999));
        const libraryTracks = songs
          .filter(s => s.album !== contextAlbumName)
          .sort((a, b) => parseInt(a.id) - parseInt(b.id));
        setActiveQueue([...albumTracks, ...libraryTracks]);
      }
    }

    socketObj.emitCommand('toggle-shuffle', { isShuffle: nextShuffleState, shuffledQueue: newShuffled });
  };

  const toggleLoop = (forcedState?: boolean) => {
    const nextLoop =
      forcedState !== undefined
        ? forcedState
        : !socketObj.isLoop;

    socketObj.setIsLoop(nextLoop);

    AuraMedia.setRepeat({
      enabled: nextLoop
    })
      .catch((error) => {
        console.error(
          '[AURA MEDIA] Error enviando repeat:',
          error
        );
      });
    socketObj.emitCommand('toggle-loop', {
      isLoop: nextLoop
    });
  };

  const handlePlayNext = (song: Song) => {
    const pool = activeQueue.length > 0 ? [...activeQueue] : [...getFlattenedSongs()];
    const filtered = pool.filter(s => s.id !== song.id);
    const curIdx = filtered.findIndex(s => s.id === currentSong?.id);
    const insertIdx = curIdx !== -1 ? curIdx + 1 : 0;
    filtered.splice(insertIdx, 0, song);
    setActiveQueue(filtered);
    socketObj.emitCommand('play-track', { 
      id: currentSong?.id, 
      song: currentSong, 
      queue: filtered, 
      position: audioObj.audioRef.current?.currentTime || audioObj.getCurrentTime() 
    });
  };

  const handleAddToQueue = (song: Song) => {
    const pool = activeQueue.length > 0 ? [...activeQueue] : [...getFlattenedSongs()];
    const filtered = pool.filter(s => s.id !== song.id);
    const newQueue = [...filtered, song];
    setActiveQueue(newQueue);
    socketObj.emitCommand('play-track', { 
      id: currentSong?.id, 
      song: currentSong, 
      queue: newQueue, 
      position: audioObj.audioRef.current?.currentTime || audioObj.getCurrentTime() 
    });
  };

  const handleReorderQueue = (newQueue: Song[]) => {
    setActiveQueue(newQueue);
    if (socketObj.isShuffle) socketObj.setShuffledQueue(newQueue);
    socketObj.emitCommand('play-track', {
      id: currentSong?.id,
      song: currentSong,
      queue: newQueue,
      position: audioObj.getCurrentTime()
    });
  };

  const handleModerate = async (songId: string, status: string) => {
      const activeToken = token || localStorage.getItem('aura_token');
      await fetch(`${API_BASE}/api/moderation/${songId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeToken}` }, body: JSON.stringify({ status }) });
      loadContent();
  };

  const handleUpdateMetadata = async (e: FormEvent) => {
    e.preventDefault();
    if (!songToEdit) return;
    const activeToken = token || localStorage.getItem('aura_token');
    const formData = new FormData();
    formData.append('title', songToEdit.title);
    formData.append('artist', songToEdit.artist);
    formData.append('album', songToEdit.album || "");
    formData.append('track_number', songToEdit.track_number ? String(songToEdit.track_number) : "");
    formData.append('tabs_url', songToEdit.tabs_url || "");
    formData.append('video_url', songToEdit.video_url || "");
    formData.append('cover_path', songToEdit.coverUrl || "");
    formData.append('animated_cover_path', songToEdit.animated_cover_path || "");
    
    if (newEditCover) { formData.append('cover', newEditCover); }
    if (newEditAnimatedCover) { formData.append('animated_cover', newEditAnimatedCover); }
    
    const res = await fetch(`${API_BASE}/api/tracks/${songToEdit.id}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${activeToken}` }, body: formData });
    if (res.ok) { 
      setSongToEdit(null); 
      setNewEditCover(null); 
      setNewEditAnimatedCover(null);
      loadContent(); 
    }
  };

  const confirmDeleteTrack = async () => {
    if (!trackToDelete) return;
    const activeToken = token || localStorage.getItem('aura_token');
    const res = await fetch(`${API_BASE}/api/tracks/${trackToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activeToken}` } });
    if (res.ok) { setTrackToDelete(null); loadContent(); }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const activeToken = token || localStorage.getItem('aura_token');
    try {
        const res = await fetch(`${API_BASE}/api/playlists`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeToken}` }, 
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
    const activeToken = token || localStorage.getItem('aura_token');
    await fetch(`${API_BASE}/api/playlists/${playlistId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activeToken}` } });
    if (activePlaylistId === playlistId) setActivePlaylistId("all");
    loadPlaylists();
  };

  const handleRemoveFromPlaylist = async (songId: string) => {
    const activeToken = token || localStorage.getItem('aura_token');
    await fetch(`${API_BASE}/api/playlists/${activePlaylistId}/tracks/${songId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activeToken}` } });
    loadContent();
  };

  const handleReorderPlaylist = async (newOrder: Song[]) => {
    if (activePlaylistId === 'all' || activePlaylistId === 'liked') return;
    const activeToken = token || localStorage.getItem('aura_token');
    try {
        await fetch(
            `${API_BASE}/api/playlists/${activePlaylistId}/tracks/reorder`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeToken}`
                },
                body: JSON.stringify({ trackIds: newOrder.map(song => song.id) })
            }
        );
    } catch (err) {
        console.error("Error reordering playlist:", err);
    }
  };

  const handleAddToPlaylist = async (songId: string, playlistId: string) => {
    const activeToken = token || localStorage.getItem('aura_token');
    await fetch(`${API_BASE}/api/playlists/${playlistId}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeToken}` }, body: JSON.stringify({ trackId: songId }) });
  };

  // --- MEMORIZACIÓN DE LA BIBLIOTECA (ORDENADA POR PISTA) ---
  const flattenedSongs = useMemo(() => {
    if (selectedAlbumName) {
      return songs
        .filter(s => s.album === selectedAlbumName)
        .sort((a, b) => {
          const numA = Number(a.track_number);
          const numB = Number(b.track_number);
          if (numA && numB) return numA - numB;
          if (numA && !numB) return -1;
          if (!numA && numB) return 1;
          return parseInt(a.id) - parseInt(b.id);
        });
    }

    if (selectedArtistName) {
      return songs
        .filter(s => parseArtists(s.artist).includes(selectedArtistName))
        .sort((a, b) => {
          const albumDiff = (a.album || '').localeCompare(b.album || '');
          if (albumDiff !== 0) return albumDiff;
          return (Number(a.track_number) || 9999) - (Number(b.track_number) || 9999);
        });
    }

    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked') {
      return songs.filter(s => formatFilter === 'all' || s.format === formatFilter);
    }

    let list = songs.filter(
      s => formatFilter === 'all' || s.format === formatFilter
    );

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        s =>
          s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q) ||
          (s.album && s.album.toLowerCase().includes(q))
      );
    }

    if (activePlaylistId === 'liked') {
      list = list.filter(s => likedIds.includes(s.id));
    }

    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'album') {
        const albumDiff = (a.album || '').localeCompare(b.album || '');
        if (albumDiff !== 0) return albumDiff;
        return (Number(a.track_number) || 9999) - (Number(b.track_number) || 9999);
      }
      if (sortBy === 'artist') {
        const artistDiff = a.artist.localeCompare(b.artist);
        if (artistDiff !== 0) return artistDiff;
        return (a.album || '').localeCompare(b.album || '');
      }
      return parseInt(a.id) - parseInt(b.id);
    });

    return sorted;
  }, [songs, formatFilter, searchQuery, activePlaylistId, likedIds, selectedAlbumName, selectedArtistName, sortBy]);

  // ELEMENTOS PARA LA CUADRÍCULA
  const displayItems = useMemo(() => {
    const list = flattenedSongs;

    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked') return list;
    if (selectedAlbumName || selectedArtistName) return list;

    const items: any[] = [];
    const groupedAlbums = new Set<string>();
    const groupedArtists = new Set<string>();
    const queryLower = searchQuery.trim().toLowerCase();

    // 1. ARTISTAS COINCIDENTES EN BÚSQUEDA
    if (queryLower.length > 1) {
      songs.forEach(song => {
        const artists = parseArtists(song.artist);

        artists.forEach(individualArtist => {
          if (
            individualArtist.toLowerCase().includes(queryLower) &&
            !groupedArtists.has(individualArtist)
          ) {
            const artistTracks = songs.filter(s => parseArtists(s.artist).includes(individualArtist));
            const artistAlbums = new Set(artistTracks.map(s => s.album).filter(Boolean));
            const customArtistPhoto = artistsMap[individualArtist]?.image_url;

            items.push({
              id: `artist-${individualArtist}`,
              type: 'artist',
              title: individualArtist,
              artist: 'Artista Oficial',
              coverUrl: customArtistPhoto || artistTracks[0]?.coverUrl,
              trackCount: artistTracks.length,
              albumCount: artistAlbums.size
            });

            groupedArtists.add(individualArtist);
          }
        });
      });
    }

    // 2. AGRUPACIÓN Y BÚSQUEDA DE ÁLBUMES
    list.forEach(song => {
      if (song.album && !groupedAlbums.has(song.album)) {
        const albumMatchesSearch = queryLower.length > 0 && song.album.toLowerCase().includes(queryLower);
        const allAlbumTracks = songs.filter(s => s.album === song.album);

        if (albumMatchesSearch || (queryLower.length === 0 && allAlbumTracks.length > 1)) {
          items.push({
            id: `album-${song.album}`,
            type: 'album',
            title: song.album,
            artist: song.artist,
            coverUrl: song.coverUrl,
            trackCount: allAlbumTracks.length
          });
          groupedAlbums.add(song.album);
        } else if (queryLower.length === 0) {
          items.push(song);
        } else if (!albumMatchesSearch) {
          items.push(song);
        }
      } else if (!song.album) {
        items.push(song);
      }
    });

    return items;
  }, [flattenedSongs, songs, artistsMap, activePlaylistId, selectedAlbumName, selectedArtistName, searchQuery]);

  // PRECARGA DE LAS PRIMERAS CARÁTULAS DE LA REJILLA (solo una vez, al
  // arrancar la app) usando displayItems — el mismo array, en el mismo
  // orden, que se usa para pintar las tarjetas — para que lo que se
  // precarga sea EXACTAMENTE lo primero que el usuario va a ver, tanto si
  // son canciones sueltas como tarjetas de álbum/artista agrupadas.
  useEffect(() => {
    if (gridPreloadedRef.current) return;
    if (isLoading) return; // el primer intento de carga aún no ha terminado

    gridPreloadedRef.current = true;

    const GRID_PRELOAD_COUNT = 24;
    Promise.allSettled(
      displayItems.slice(0, GRID_PRELOAD_COUNT).map((item: any) => preloadImage(item.coverUrl))
    ).then(() => {
      readinessRef.current.grid = true;
      maybeMarkInitialContentReady();
    });
  }, [isLoading, displayItems]);

  // ÁLBUMES DEL ARTISTA SELECCIONADO
  const artistAlbums = useMemo(() => {
    if (!selectedArtistName) return [];
    const artistTracks = songs.filter(s => 
      parseArtists(s.artist).includes(selectedArtistName) && s.album
    );
    const map = new Map<string, any>();

    artistTracks.forEach(t => {
      if (!map.has(t.album!)) {
        map.set(t.album!, {
          title: t.album,
          coverUrl: t.coverUrl,
          trackCount: artistTracks.filter(s => s.album === t.album).length
        });
      }
    });

    return Array.from(map.values());
  }, [selectedArtistName, songs]);

  const getFlattenedSongs = () => flattenedSongs;

  const canReorderPlaylist =
      activePlaylistId !== 'all' &&
      activePlaylistId !== 'liked' &&
      !showModeration &&
      !isMinigameActive &&
      sortBy === 'first' &&
      formatFilter === 'all' &&
      !searchQuery.trim() &&
      !selectedAlbumName &&
      !selectedArtistName;

  const getCurrentPlayPool = () => {
    if (socketObj.isShuffle) return socketObj.shuffledQueue;
    return activeQueue.length > 0 ? activeQueue : flattenedSongs;
  };

  const currentThemeConfig = THEMES.find(t => t.id === activeTheme) || THEMES[0];
  const getThemeBg = () => activeTheme === 'light' ? '#ffffff' : '#050505';

  // Controles de transporte del sistema para web/escritorio (auriculares,
  // teclas multimedia, SMTC de Windows). En Android nativo se desactiva
  // porque AuraMedia ya cubre lo mismo de forma nativa.
  useMediaSession({
    currentSong,
    isPlaying,
    duration: audioObj.duration,
    getCurrentTime: audioObj.getCurrentTime,
    subscribeToTime: audioObj.subscribeToTime,
    setIsPlaying,
    onNext: handleNext,
    onPrevious: handlePrevious,
    onSeekTo: (seconds) => {
      if (audioObj.audioRef.current) {
        audioObj.audioRef.current.currentTime = seconds;
      }
    },
    isNativePlatform: Capacitor.isNativePlatform(),
  });

  // Los 3 botones del thumbnail toolbar en el preview de la ventana de
  // Windows (ver src-tauri/src/thumbbar.rs). No hace nada fuera de Tauri.
  useWindowsThumbbar({
    isDesktop,
    isPlaying,
    onNext: handleNext,
    onPrevious: handlePrevious,
    onTogglePlay: () => setIsPlaying(!isPlaying),
  });

  useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  let removed = false;
  let listeners: Array<{ remove: () => Promise<void> }> = [];

  const setupAuraMedia = async () => {
    try {
      await AuraMedia.start();

      const playListener = await AuraMedia.addListener(
        'play',
        () => {
          setIsPlaying(true);
        }
      );

      const pauseListener = await AuraMedia.addListener(
        'pause',
        () => {
          setIsPlaying(false);
        }
      );

      const nextListener = await AuraMedia.addListener(
        'next',
        () => {
          handleNext();
        }
      );

      const previousListener = await AuraMedia.addListener(
        'previous',
        () => {
          handlePrevious();
        }
      );

      const shuffleListener = await AuraMedia.addListener(
        'shuffleChanged',
        (data) => {
          const enabled = Boolean(data?.enabled);

          if (enabled === socketObj.isShuffle) {
            return;
          }

          toggleShuffle(enabled);
        }
      );

      const repeatListener = await AuraMedia.addListener(
        'repeatChanged',
        (data) => {
          const repeatMode = Number(data?.repeatMode);
          const enabled = repeatMode !== 0;

          if (enabled === socketObj.isLoop) {
            return;
          }

          toggleLoop(enabled);
        }
      );

      const seekListener = await AuraMedia.addListener(
        'seek',
        (data) => {
          const positionMs = Number(data?.positionMs);

          if (!Number.isFinite(positionMs)) {
            return;
          }

          if (audioObj.audioRef.current) {
            audioObj.audioRef.current.currentTime =
              positionMs / 1000;
          }
        }
      );

      listeners = [
        playListener,
        pauseListener,
        nextListener,
        previousListener,
        shuffleListener,
        repeatListener,
        seekListener
      ];

      if (removed) {
        for (const listener of listeners) {
          await listener.remove();
        }
      }
    } catch (error) {
      console.error(
        'Error iniciando controles multimedia de Android:',
        error
      );
    }
  };

  setupAuraMedia();

  return () => {
    removed = true;

    for (const listener of listeners) {
      listener.remove().catch(() => {});
    }
  };
}, [
  handleNext,
  handlePrevious
]);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  const durationMs = Math.max(
    0,
    Math.round((audioObj.duration || 0) * 1000)
  );

  const artworkUrl = currentSong.coverUrl || undefined;
  AuraMedia.setTrack({
    id: String(currentSong.id),
    title: currentSong.title || 'Aura Music',
    artist: currentSong.artist || '',
    album: currentSong.album || '',
    artworkUrl,
    durationMs
  }).catch((error) => {
    console.error(
      'Error actualizando canción en Android:',
      error
    );
  });
}, [
  currentSong?.id,
  currentSong?.title,
  currentSong?.artist,
  currentSong?.album,
  audioObj.duration
]);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  AuraMedia.setPlaying({
    playing: isPlaying
  }).catch((error) => {
    console.error(
      'Error sincronizando Play/Pause con Android:',
      error
    );
  });
}, [
  currentSong?.id,
  isPlaying
]);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  const syncPosition = () => {
    const currentTime = audioObj.getCurrentTime();

    const positionMs = Math.max(
      0,
      Math.round(currentTime * 1000)
    );

    AuraMedia.setPosition({
      positionMs
    }).catch(() => {});
  };

  syncPosition();

  const unsubscribe = audioObj.subscribeToTime(
    syncPosition
  );

  return unsubscribe;
}, [
  currentSong?.id,
  audioObj.getCurrentTime,
  audioObj.subscribeToTime
]);

  return (

    
    <div className={`relative h-[100dvh] flex flex-col font-sans overflow-hidden transition-all duration-1000 ${currentThemeConfig.className}`}>
      {/* Barra superior de escritorio integrada con el fondo */}
      {isDesktop && (
        <div 
          className={`h-8 border-b flex items-center justify-between pl-3 pr-0 select-none z-50 shrink-0 backdrop-blur-md transition-colors duration-1000 ${
            activeTheme === 'light' 
              ? 'border-black/5 bg-white/40 text-black' 
              : 'border-white/5 bg-black/20 text-white'
          }`}
        >
          {/* ZONA DE ARRASTRE */}
          <div data-tauri-drag-region className="flex-1 h-full flex items-center gap-1.5 cursor-default">
            <span className="text-[10px] font-bold tracking-widest uppercase opacity-40 pointer-events-none">AURA</span>
            <span className="text-brand-primary font-black text-xs leading-none pointer-events-none">.</span>
          </div>
          
          {/* BOTONES DE VENTANA */}
          <div className="flex items-center shrink-0 z-50">
            <button 
              type="button" 
              onClick={handleMinimize} 
              className={`w-9 h-8 flex items-center justify-center transition-colors cursor-pointer outline-none ${
                activeTheme === 'light' ? 'hover:bg-black/5 text-black/50 hover:text-black' : 'hover:bg-white/10 text-white/50 hover:text-white'
              }`}
            >
              ─
            </button>
            <button 
              type="button" 
              onClick={handleMaximize} 
              className={`w-9 h-8 flex items-center justify-center transition-colors cursor-pointer text-xs outline-none ${
                activeTheme === 'light' ? 'hover:bg-black/5 text-black/50 hover:text-black' : 'hover:bg-white/10 text-white/50 hover:text-white'
              }`}
            >
              □
            </button>
            <button 
              type="button" 
              onClick={handleClose} 
              className="w-9 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-red-600/90 transition-colors cursor-pointer outline-none"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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

      <AnimatePresence>
    {showSplash && (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.7,
          ease: "easeInOut",
        }}
        className="fixed inset-0 z-[99999] bg-black flex items-center justify-center"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 0.45,
            ease: "easeOut",
          }}
          className="flex items-center justify-center"
        >
          <div className="text-5xl md:text-6xl font-bold tracking-tighter text-white">
            AURA<span className="text-brand-primary">.</span>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>

      {/* TOP NAVIGATION */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.nav
  initial={{ y: -100 }}
  animate={{ y: mobileNavVisible ? 0 : "-100%" }}
  exit={{ y: -100 }}
  transition={{
    duration: 0.25,
    ease: "easeOut",
  }}
  className={`fixed top-0 left-0 right-0 min-h-[5.5rem] flex items-center justify-between px-4 md:px-8 pt-[env(safe-area-inset-top)] z-20 backdrop-blur-md transition-all duration-1000 md:border-b ${
    activeTheme === 'light'
      ? 'md:border-black/5 bg-white'
      : 'md:border-white/10 bg-black'
  }`}
>
            <div className="flex items-center gap-4 md:gap-12 flex-1">
              <span className="text-lg md:text-xl font-bold tracking-tighter uppercase cursor-pointer shrink-0" onClick={() => { setSelectedAlbumName(null); setSelectedArtistName(null); }}>AURA<span className="text-brand-primary">.</span></span>
              <div className={`hidden lg:flex gap-8 text-[10px] font-bold uppercase`}>
                <button onClick={() => {setShowModeration(false); setActivePlaylistId("all"); setSelectedAlbumName(null); setSelectedArtistName(null);}} className={`transition-colors ${!showModeration && activePlaylistId === "all" ? (activeTheme === 'light' ? 'text-black border-b border-brand-primary' : 'text-white border-b border-brand-primary pb-1') : ""}`}>Library</button>
                {(userRole === "admin" || userRole === "moderator") && <button onClick={() => setShowModeration(true)} className={`flex items-center gap-2 ${showModeration ? 'text-amber-500 border-b border-amber-500 pb-1' : ''}`}><ShieldCheck size={12}/> Moderation</button>}
                <button onClick={() => setIsSessionOpen(true)} className={`flex items-center gap-2 transition-colors ${socketObj.currentSession ? 'text-brand-primary animate-pulse font-black' : 'text-white/40'}`}><Users size={12} /> Session</button>
                {token && <button onClick={() => setIsSocialOpen(true)} className="relative flex items-center gap-2 text-white/40 hover:text-white transition-colors cursor-pointer"><Users size={12} /> Social{socketObj.unreadSenders.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-xl" />}</button>}
              </div>
              <div className="flex-1 min-w-0 max-w-md ml-2 md:ml-8 relative -translate-x-[12px]">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
  <input
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    className="w-full bg-white/5 border border-white/10 rounded-full py-1.5 pl-10 pr-3 md:pr-4 text-[10px] md:text-[11px] outline-none text-white focus:bg-white/10"
    placeholder="Search..."
  />
</div>
            </div>
            <div className="flex items-center gap-3 md:gap-6">
              {token ? (
                   <div className="flex items-center gap-2 md:gap-4">
  <button
    onClick={() => setShowUpload(true)}
    className="bg-brand-primary text-black px-3 md:px-4 py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase flex items-center gap-2 hover:scale-105 transition-all cursor-pointer"
  >
    <Plus size={14}/>
    <span className="hidden xs:inline">Upload</span>
  </button>

  <button
    onClick={() => setIsMobileMenuOpen(prev => !prev)}
    aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
    aria-expanded={isMobileMenuOpen}
    className={`lg:hidden w-9 h-9 -mr-1.5 rounded-full flex items-center justify-center transition-colors active:scale-90 duration-150 ${
      isMobileMenuOpen
        ? (activeTheme === 'light' ? 'bg-black/5 text-black' : 'bg-white/10 text-white')
        : 'text-white/40 hover:text-white'
    }`}
  >
    <span className="flex transition-transform duration-150" style={{ transform: isMobileMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      {isMobileMenuOpen ? <X size={20}/> : <Menu size={20}/>}
    </span>
  </button>
</div>
              ) : ( <button onClick={() => setIsAuthModalOpen(true)} className="px-5 py-2 rounded-full text-[10px] font-bold uppercase bg-white text-black hover:scale-105 transition-all cursor-pointer">Sign In</button> )}
            </div>
          </motion.nav>
          
          
        )}
<AnimatePresence>
  {isMobileMenuOpen && (
    <>
      {/* Fondo oscuro detrás del menú */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[9998] bg-black/60 md:hidden"
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* MENÚ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0, y: -8 }}
transition={{
  duration: 0.16,
  ease: "easeOut",
}}
        className={`fixed top-[5.5rem] left-3 right-3 z-[9999] md:hidden rounded-2xl border shadow-lg overflow-hidden will-change-transform ${
          activeTheme === "light"
            ? "bg-white border-black/10 text-black"
            : "bg-[#080808] border-white/10 text-white"
        }`}
      >

        {/* CABECERA */}
        <div
          className={`px-4 py-4 border-b ${
            activeTheme === "light"
              ? "border-black/5"
              : "border-white/10"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">
                Aura
              </div>

              <div className="text-lg font-bold tracking-tight">
                Menu
              </div>
            </div>

            <button
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="Close menu"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 duration-150 ${
                activeTheme === "light"
                  ? "bg-black/5 hover:bg-black/10 active:bg-black/15"
                  : "bg-white/5 hover:bg-white/10 active:bg-white/15"
              }`}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* CONTENIDO */}
        <div className="max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-hide">

          {/* LIBRARY */}
          <button
            onClick={() => {
              setShowModeration(false);
              setActivePlaylistId("all");
              setSelectedAlbumName(null);
              setSelectedArtistName(null);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:scale-[0.98] duration-150 ${
              activePlaylistId === "all" && !showModeration
                ? "text-brand-primary bg-brand-primary/10"
                : activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              activePlaylistId === "all" && !showModeration
                ? "bg-brand-primary/15 text-brand-primary"
                : activeTheme === "light" ? "bg-black/5" : "bg-white/5"
            }`}>
              <Library size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                Library
              </div>

              <div className="text-[10px] opacity-40">
                Your music collection
              </div>
            </div>

            <ChevronRight size={15} className="opacity-20 shrink-0" />
          </button>

          {/* PLAYLISTS */}
          <div
            className={`px-4 pt-4 pb-2 ${
              activeTheme === "light"
                ? "border-t border-black/5"
                : "border-t border-white/5"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-40">
                Playlists
              </div>

              <button
                onClick={() => {
                  setIsCreatePlaylistOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-6 h-6 rounded-full bg-brand-primary text-black flex items-center justify-center hover:scale-105 transition-transform"
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="max-h-40 overflow-y-auto scrollbar-hide">

              {playlists.length === 0 ? (
                <button
                  onClick={() => {
                    setIsCreatePlaylistOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs opacity-40 hover:opacity-70 transition-opacity ${
                    activeTheme === "light"
                      ? "hover:bg-black/5"
                      : "hover:bg-white/5"
                  }`}
                >
                  No playlists yet. Create one.
                </button>
              ) : (
                playlists.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center rounded-lg ${
                      activePlaylistId === p.id.toString()
                        ? "bg-brand-primary/10"
                        : activeTheme === "light"
                          ? "active:bg-black/5"
                          : "active:bg-white/5"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setActivePlaylistId(p.id.toString());
                        setShowModeration(false);
                        setSelectedAlbumName(null);
                        setSelectedArtistName(null);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex-1 min-w-0 text-left px-3 py-2.5 text-xs truncate transition-colors ${
                        activePlaylistId === p.id.toString()
                          ? "text-brand-primary font-semibold"
                          : activeTheme === "light"
                            ? "text-black/60"
                            : "text-white/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Music2 size={13} className="shrink-0 opacity-50" />
                        <span className="truncate">
                          {p.name}
                        </span>
                      </div>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePlaylist(p.id);
                      }}
                      className="mr-1.5 p-2 rounded-md text-red-500/50 active:text-red-500 active:bg-red-500/10 transition-colors shrink-0"
                      aria-label={`Delete playlist ${p.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}

            </div>
          </div>

          {/* CREATE PLAYLIST */}
          <button
            onClick={() => {
              setIsCreatePlaylistOpen(true);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
              activeTheme === "light"
                ? "hover:bg-black/5 active:bg-black/10"
                : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-brand-primary/15 text-brand-primary flex items-center justify-center shrink-0">
              <Plus size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                Create playlist
              </div>

              <div className="text-[10px] opacity-40">
                Make a new collection
              </div>
            </div>
          </button>

          {/* SEPARADOR */}
          <div
            className={`mx-4 h-px ${
              activeTheme === "light"
                ? "bg-black/5"
                : "bg-white/5"
            }`}
          />

          {/* ETIQUETA DE SECCIÓN */}
          <div className="px-4 pt-4 pb-1 text-[10px] uppercase tracking-[0.18em] font-bold opacity-40">
            More
          </div>

          {/* SESSION */}
          <button
            onClick={() => {
              setIsSessionOpen(true);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
              activeTheme === "light"
                ? "hover:bg-black/5 active:bg-black/10"
                : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              socketObj.currentSession
                ? "bg-brand-primary/15 text-brand-primary"
                : activeTheme === "light" ? "bg-black/5" : "bg-white/5"
            }`}>
              <Users size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                Session
              </div>

              <div className="text-[10px] opacity-40">
                Listen together
              </div>
            </div>

            {socketObj.currentSession ? (
              <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse shrink-0" />
            ) : (
              <ChevronRight size={15} className="opacity-20 shrink-0" />
            )}
          </button>

          {/* SOCIAL */}
          {token && (
            <button
              onClick={() => {
                setIsSocialOpen(true);
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
                activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTheme === "light" ? "bg-black/5" : "bg-white/5"}`}>
                <MessageCircle size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Social
                </div>

                <div className="text-[10px] opacity-40">
                  Friends and messages
                </div>
              </div>

              {socketObj.unreadSenders.length > 0 ? (
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              ) : (
                <ChevronRight size={15} className="opacity-20 shrink-0" />
              )}
            </button>
          )}

          {/* PERSONALIZATION */}
          <button
            onClick={() => {
              setIsPersonalizationOpen(true);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
              activeTheme === "light"
                ? "hover:bg-black/5 active:bg-black/10"
                : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTheme === "light" ? "bg-black/5" : "bg-white/5"}`}>
              <Settings size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                Personalization
              </div>

              <div className="text-[10px] opacity-40">
                Appearance and preferences
              </div>
            </div>

            <ChevronRight size={15} className="opacity-20 shrink-0" />
          </button>

          {/* MODERATION */}
          {(userRole === "admin" || userRole === "moderator") && (
            <button
              onClick={() => {
                setShowModeration(true);
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
                activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                <ShieldCheck size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Moderation
                </div>

                <div className="text-[10px] opacity-40">
                  Manage Aura
                </div>
              </div>

              <ChevronRight size={15} className="opacity-20 shrink-0" />
            </button>
          )}

          {/* PROFILE */}
          {token && (
            <button
              onClick={() => {
                setIsProfileOpen(true);
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
                activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTheme === "light" ? "bg-black/5" : "bg-white/5"}`}>
                <User size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Profile
                </div>

                <div className="text-[10px] opacity-40">
                  Your Aura profile
                </div>
              </div>

              <ChevronRight size={15} className="opacity-20 shrink-0" />
            </button>
          )}

          {/* LOGOUT */}
          {token && (
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                handleLogout();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-red-400 hover:bg-red-500/10 active:bg-red-500/15 active:scale-[0.98] transition-colors duration-150"
            >
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                <LogOut size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Log out
                </div>

                <div className="text-[10px] text-red-400/50">
                  Sign out of Aura
                </div>
              </div>
            </button>
          )}

          {/* ESPACIO INFERIOR */}
          <div className="h-2" />

        </div>
      </motion.div>
    </>
  )}
</AnimatePresence>
      </AnimatePresence>

      <div className="flex flex-1 min-h-0 overflow-hidden z-10">
        <AnimatePresence>
          {!isFocusMode && (
            <motion.aside initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} className={`w-64 border-r border-white/5 hidden md:flex flex-col shrink-0 p-8`}>
                <div className="flex-1 overflow-y-auto flex flex-col gap-10 scrollbar-hide">
                    <div>
                      <div className="flex items-center justify-between mb-6"><h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Playlists</h3><Plus size={14} className="hover:text-brand-primary cursor-pointer transition-all" onClick={() => setIsCreatePlaylistOpen(true)} /></div>
                      <ul className="space-y-4 text-[13px] font-medium">
                        <li key="stream-all" className={`cursor-pointer transition-all ${activePlaylistId === "all" ? "text-brand-primary" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("all"); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>Global Stream</li>
                        <li key="liked-songs" className={`flex items-center gap-2 cursor-pointer transition-all ${activePlaylistId === "liked" ? "text-red-500 font-bold" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("liked"); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>
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
                            {/*<Visualizer analyser={audioObj.analyserRef.current} active={isPlaying} color={dynamicColor} />*/}
                        </div>
                    </div>
                    <div><h3 className="text-[10px] uppercase font-bold text-white/30 mb-6 tracking-widest flex items-center gap-2"><Clock size={12}/> History</h3><div className="space-y-4">{recentlyPlayed.map((song) => (<div key={song.id} className="flex items-center gap-4 group cursor-pointer" onClick={() => { if(isMinigameActive) handleMinigameGuess(song); else handlePlaySong(song); }}><div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/10 group-hover:scale-105 transition-transform"><img src={song.coverUrl} className="w-full h-full object-cover" /></div><div className="overflow-hidden"><p className="text-[11px] font-bold tabular-nums truncate text-white">{song.title}</p></div></div>))}</div></div>
                </div>
                <div className="mt-auto pt-6"><div onClick={() => setIsPersonalizationOpen(true)} className="p-5 rounded-[28px] border border-white/5 bg-white/5 cursor-pointer flex items-center gap-4 hover:bg-white/[0.08] transition-all"><Palette size={18} className="text-brand-primary" /><span className="text-[10px] font-bold uppercase tracking-widest text-white/80">Aesthetic</span></div></div>
            </motion.aside>
          )}
        </AnimatePresence>

       <main
  ref={mainRef}
  className={`flex-1 min-h-0 overflow-y-auto p-4 md:p-10 pt-[calc(5.5rem+env(safe-area-inset-top))] flex flex-col gap-8 md:gap-12 pb-8 scrollbar-hide transition-all duration-700 ${
    isFocusMode ? 'items-center justify-center pt-0' : ''
  }`}
>
            {/* VISTA ESPECIAL: PERFIL DE ARTISTA */}
            {selectedArtistName ? (
              <section className="space-y-10 animate-in fade-in duration-500">
                <div className="relative p-8 md:p-12 rounded-[40px] bg-white/[0.03] border border-white/10 overflow-hidden flex flex-col md:flex-row items-center gap-8 shadow-2xl">
                  <div className="relative group/avatar w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden shrink-0 border-2 border-brand-primary/40 shadow-[0_0_50px_rgba(99,102,241,0.2)] bg-white/5">
                    <img 
                      key={selectedArtistName}
                      src={resolvedArtistImageUrl || flattenedSongs[0]?.coverUrl || '/default-cover.jpg'} 
                      alt={selectedArtistName} 
                      className="w-full h-full object-cover"
                    />
                    
                    {(userRole === 'admin' || userRole === 'moderator') && (
                      <label 
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover/avatar:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity duration-300 text-white select-none"
                        title="Cambiar foto de perfil del artista"
                      >
                        <ImageIcon size={28} className="text-brand-primary mb-1" />
                        <span className="text-[9px] uppercase font-bold tracking-widest text-white">Cambiar Foto</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleUploadArtistImage} 
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex-1 text-center md:text-left space-y-3">
                    <div className="flex items-center justify-center md:justify-start gap-2">
                      <User size={14} className="text-brand-primary" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-primary">Perfil de Artista Oficial</span>
                    </div>
                    <h1 className="text-4xl md:text-7xl font-serif italic font-bold text-white tracking-tight">{selectedArtistName}</h1>
                    <p className="text-xs font-mono text-white/40 uppercase tracking-widest">
                      {artistAlbums.length} Álbumes · {flattenedSongs.length} Pistas en AURA
                    </p>
                    <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                      <button 
                        onClick={() => flattenedSongs[0] && handlePlaySong(flattenedSongs[0])} 
                        className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-[10px] uppercase tracking-wider hover:scale-105 transition-all shadow-xl cursor-pointer flex items-center gap-2"
                      >
                        <Play size={14} fill="black" /> Reproducir Todo
                      </button>
                      <button 
                        onClick={() => setSelectedArtistName(null)} 
                        className="px-6 py-2.5 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white font-bold text-[10px] uppercase tracking-wider hover:bg-white/10 transition-all cursor-pointer"
                      >
                        Volver a Biblioteca
                      </button>
                    </div>
                  </div>
                </div>

                {/* SECCIÓN BIOGRAFÍA CON "VER MÁS" */}
                <div className="p-6 md:p-8 rounded-3xl bg-white/[0.02] border border-white/5 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                      <FileText size={14} /> Biografía / Información
                    </h3>
                    {(userRole === 'admin' || userRole === 'moderator') && (
                      <button 
                        onClick={() => setIsEditingBio(true)}
                        className="text-[9px] font-bold uppercase text-brand-primary hover:underline flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit2 size={12} /> {artistBio ? 'Editar Descripción' : 'Añadir Descripción'}
                      </button>
                    )}
                  </div>

                  {artistBio ? (
                    <div>
                      <p className={`text-sm md:text-base text-white/70 leading-relaxed font-normal italic whitespace-pre-line transition-all duration-300 ${
                        !isBioExpanded ? 'line-clamp-3' : ''
                      }`}>
                        {artistBio}
                      </p>
                      
                      {artistBio.length > 180 && (
                        <button
                          type="button"
                          onClick={() => setIsBioExpanded(!isBioExpanded)}
                          className="mt-2 text-xs font-bold text-orange-400 hover:text-orange-300 transition-colors cursor-pointer inline-flex items-center gap-1 outline-none"
                        >
                          {isBioExpanded ? 'Ver menos' : '... Ver más'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm md:text-base text-white/40 leading-relaxed font-normal italic">
                      {userRole === 'admin' || userRole === 'moderator' 
                        ? "Este artista aún no tiene una biografía. Haz clic en 'Añadir Descripción' para escribirla." 
                        : "Este artista aún no tiene una biografía disponible."}
                    </p>
                  )}
                </div>

                {/* ÁLBUMES DEL ARTISTA */}
                {artistAlbums.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/40 flex items-center gap-2">
                      <Disc size={14} /> Discografía ({artistAlbums.length})
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {artistAlbums.map(alb => (
                        <div 
                          key={alb.title} 
                          onClick={() => { setSelectedArtistName(null); setSelectedAlbumName(alb.title); }}
                          className="group p-4 rounded-3xl bg-white/5 border border-white/5 hover:border-brand-primary/40 cursor-pointer transition-all flex flex-col"
                        >
                          <div className="aspect-square rounded-2xl overflow-hidden mb-3 bg-white/5">
                            <img src={alb.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="" />
                          </div>
                          <p className="text-sm font-bold text-white truncate">{alb.title}</p>
                          <p className="text-[10px] text-white/40 font-mono mt-0.5">{alb.trackCount} Pistas</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CANCIONES DEL ARTISTA */}
                <div className="space-y-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/40">
                    Todas las canciones ({flattenedSongs.length})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {flattenedSongs.map(song => (
                      <MusicCard 
                        key={song.id}
                        song={song}
                        isActive={!isMinigameActive && currentSong?.id === song.id}
                        isPlaying={!isMinigameActive && currentSong?.id === song.id && isPlaying}
                        playlists={playlists}
                        userRole={userRole}
                        isLiked={likedIds.includes(song.id)}
                        onToggleLike={() => handleToggleLike(song.id)}
                        onAddToPlaylist={(pid) => handleAddToPlaylist(song.id, pid)}
                        onOpenTabs={() => setTabsSong(song)} 
                        onDelete={() => setTrackToDelete(song.id)}
                        onPlayNext={() => handlePlayNext(song)}
                        onAddToQueue={() => handleAddToQueue(song)}
                        onEdit={() => setSongToEdit(song)}
                        onClick={() => handlePlaySong(song)} 
                      />
                    ))}
                  </div>
                </div>
              </section>
            ) : !isFocusMode ? (
              <>
                <Suspense fallback={null}><AnimatePresence>{showUpload && <LazyMusicUpload onClose={() => setShowUpload(false)} onUploadComplete={() => loadContent()} />}</AnimatePresence></Suspense>
                
                {/* HERO BANNER */}
                {!isMinigameActive && !selectedAlbumName && (
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
                                draggable={canReorderPlaylist && item.type !== 'album' && item.type !== 'artist'}
                                onDragStart={(e) => {
                                  if (canReorderPlaylist && item.type !== 'album' && item.type !== 'artist') {
                                      setDraggedSongId(item.id);
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', item.id);
                                  }
                                }}
                                onDragOver={(e) => {
                                  if (canReorderPlaylist && item.type !== 'album' && item.type !== 'artist') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      e.dataTransfer.dropEffect = 'move';
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  const draggedId = e.dataTransfer.getData('text/plain') || draggedSongId;

                                  if (!canReorderPlaylist || !draggedId || draggedId === item.id || item.type === 'album' || item.type === 'artist') {
                                      setDraggedSongId(null);
                                      return;
                                  }

                                  const currentIndex = songs.findIndex(s => s.id === draggedId);
                                  const targetIndex = songs.findIndex(s => s.id === item.id);

                                  if (currentIndex === -1 || targetIndex === -1) {
                                      setDraggedSongId(null);
                                      return;
                                  }

                                  const newSongs = [...songs];
                                  const [movedSong] = newSongs.splice(currentIndex, 1);
                                  newSongs.splice(targetIndex, 0, movedSong);

                                  setSongs(newSongs);
                                  handleReorderPlaylist(newSongs);
                                  setDraggedSongId(null);
                                }}
                                onDragEnd={() => setDraggedSongId(null)}
                                className={`relative group ${
                                    isMinigameActive ? 'hover:scale-105 transition-transform' : ''
                                } ${draggedSongId === item.id ? 'opacity-40' : ''} ${
                                    canReorderPlaylist && item.type !== 'album' && item.type !== 'artist' ? 'cursor-grab active:cursor-grabbing' : ''
                                }`}
                            >
                                {/* 1. TARJETA DE ARTISTA (REDONDA CON FOTO PERSONALIZADA) */}
                                {item.type === 'artist' ? (
                                    <div 
                                      onClick={() => setSelectedArtistName(item.title)} 
                                      className="group p-5 md:p-4 rounded-[32px] md:rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition-all duration-300 flex flex-col justify-between shadow-lg"
                                    >
                                      <div className="w-full aspect-square rounded-full overflow-hidden mb-4 relative bg-white/5 shadow-2xl border border-white/10">
                                        <img 
                                          src={item.coverUrl || '/default-cover.jpg'} 
                                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 pointer-events-none" 
                                          alt={item.title} 
                                        />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-300">
                                          <div className="w-12 h-12 md:w-10 md:h-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl">
                                            <Play size={20} fill="black" className="ml-0.5 md:w-4 md:h-4" />
                                          </div>
                                        </div>
                                      </div>

                                      <div className="space-y-1 md:space-y-0.5 min-w-0 w-full pt-1">
                                        <h3 className="text-lg md:text-sm font-bold truncate text-white leading-tight tracking-tight" title={item.title}>
                                          {item.title}
                                        </h3>
                                        <p className="text-sm md:text-[10px] uppercase font-bold tracking-widest text-brand-primary truncate">
                                          Artista · {item.albumCount} Álbumes · {item.trackCount} Pistas
                                        </p>
                                      </div>
                                    </div>

                                /* 2. TARJETA DE ÁLBUM */
                                ) : item.type === 'album' ? (
                                    <div onClick={() => setSelectedAlbumName(item.title)} className="group p-5 md:p-4 rounded-[32px] md:rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition-all">
                                      <div className="aspect-square rounded-[24px] md:rounded-2xl overflow-hidden mb-4 relative">
                                        <img src={item.coverUrl} className="w-full h-full object-cover transition-transform duration-700" alt={item.title} />
                                      </div>
                                      <h3 className="text-xl md:text-sm font-bold truncate text-white">{item.title}</h3>
                                      <p className="text-sm md:text-[10px] uppercase font-bold tracking-widest text-white/40">{item.trackCount} Tracks Found</p>
                                    </div>

                                /* 3. TARJETA DE CANCIÓN */
                                ) : (
                                    <div
                                      className="relative"
                                      style={{ pointerEvents: draggedSongId && draggedSongId !== item.id ? 'none' : 'auto' }}
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
              /* MODO FOCUS (CON SOPORTE PARA PORTADA ANIMADA) */
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
                    <div className="relative w-80 h-80 md:w-[500px] md:h-[500px] rounded-[60px] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10 bg-black">
                      {resolvedAnimatedCoverUrl ? (
                        isVideoUrl(resolvedAnimatedCoverUrl) ? (
                          <video
                            src={resolvedAnimatedCoverUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img src={resolvedAnimatedCoverUrl} className="w-full h-full object-cover" alt="" />
                        )
                      ) : (
                        <img src={resolvedCoverUrl || undefined} className="w-full h-full object-cover" alt="" />
                      )}
                    </div>
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

     <audio
  ref={audioObj.audioRef}
  src={resolvedAudioUrl || undefined}
  onTimeUpdate={(e) => {
    audioObj.handleTimeUpdate(
      e.currentTarget.currentTime
    );
  }}
  onLoadedMetadata={(e) => {
    const duration = e.currentTarget.duration;

    audioObj.setDuration(duration);

    if (Capacitor.isNativePlatform() && Number.isFinite(duration)) {
      AuraMedia.setDuration({
        durationMs: Math.round(duration * 1000)
      }).catch(() => {});
    }
  }}
  onEnded={handleNext}
  crossOrigin="anonymous"
/>
      
      {/* PLAYER BAR */}
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
              currentTime={isMinigameActive ? minigameTime : audioObj.getCurrentTime()}
              duration={isMinigameActive ? 10 : audioObj.duration}
              getCurrentTime={audioObj.getCurrentTime}
              subscribeToTime={audioObj.subscribeToTime}
              volume={volume}
              onTogglePlay={(e: any) => {
                e.stopPropagation();
                if (isMinigameActive) {
                  if (isMinigamePlaying) {
                    minigameAudioRef.current?.pause();
                    if (minigameTimeoutRef.current) clearTimeout(minigameTimeoutRef.current);
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
                if (!isMinigameActive) toggleShuffle();
              }}
              onToggleLoop={(e: any) => {
                e.stopPropagation();
                if (!isMinigameActive) toggleLoop();
              }}
              onSeek={(t: any) => {
                if (isMinigameActive) {
                  if (minigameAudioRef.current && t <= 10) minigameAudioRef.current.currentTime = t;
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
                if (!isMinigameActive) setIsLyricsOpen(!isLyricsOpen);
              }}
              onOpenFullPlayer={() => {
                if (!isMinigameActive) setIsFullPlayerOpen(true);
              }}
              onToggleFocusMode={() => {
                if (!isMinigameActive) setIsFocusMode(!isFocusMode);
              }}
              isFocusMode={isFocusMode}
              activeTheme={activeTheme}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}><LazyMinigameLobbyOverlay isOpen={isMinigameLobbyOpen} onClose={() => setIsMinigameLobbyOpen(false)} onStart={startMinigame} /></Suspense>
      <Suspense fallback={null}><AnimatePresence>{tabsSong && <LazyTabsOverlay song={tabsSong} onClose={() => setTabsSong(null)} />}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isLyricsOpen && <LazyLyricsOverlay isOpen={isLyricsOpen} onClose={() => setIsLyricsOpen(false)} currentSong={currentSong} currentTime={audioObj.getCurrentTime()} getCurrentTime={audioObj.getCurrentTime}
  subscribeToTime={audioObj.subscribeToTime} onSeek={(t:any) => { if(audioObj.audioRef.current) audioObj.audioRef.current.currentTime = t; }} />}</AnimatePresence></Suspense>
      <AnimatePresence>{isFullPlayerOpen && <FullPlayerOverlay isOpen={isFullPlayerOpen} liveCurrentTime={audioObj.getCurrentTime()} subscribeToTime={audioObj.subscribeToTime}
getCurrentTime={audioObj.getCurrentTime}
 onClose={() => setIsFullPlayerOpen(false)} currentSong={currentSong} isPlaying={isPlaying} onTogglePlay={() => { handlePlaySong(currentSong!); }} onNext={handleNext} onPrevious={handlePrevious} duration={audioObj.duration} onSeek={(t) => {
          if (audioObj.audioRef.current) audioObj.audioRef.current.currentTime = t;
      }} volume={volume} onVolumeChange={setVolume} isShuffle={socketObj.isShuffle} isLoop={socketObj.isLoop} onToggleShuffle={toggleShuffle} onToggleLoop={toggleLoop} onToggleLyrics={() => { setIsFullPlayerOpen(false); setIsLyricsOpen(true); }} onToggleQueue={() => setIsQueueOpen(true)} activeTheme={activeTheme} onOpenMinigameLobby={() => { setIsFullPlayerOpen(false); setIsMinigameLobbyOpen(true); }} />}</AnimatePresence>
      <Suspense fallback={null}><AnimatePresence>{isQueueOpen && <LazyQueueOverlay
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        queue={getCurrentPlayPool()}
        currentSong={currentSong}
        onPlayFromQueue={handlePlaySong}
        onReorderQueue={handleReorderQueue}
        isShuffle={socketObj.isShuffle}
        activeTheme={activeTheme}
      />}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isSocialOpen && <LazySocialSidebar token={token} user={user} socket={socketObj.socketRef.current} unreadSenders={socketObj.unreadSenders} setUnreadSenders={socketObj.setUnreadSenders} currentSession={socketObj.currentSession} onClose={() => setIsSocialOpen(false)} />}</AnimatePresence></Suspense>
      <AnimatePresence>{socketObj.activeInvite && ( <div className="fixed top-20 right-8 z-[500]"><motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="bg-[#121212] border border-brand-primary/30 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-white"><p className="text-xs font-bold tabular-nums">{socketObj.activeInvite.from} invited you.</p><button onClick={() => { handleJoinSession(socketObj.activeInvite!.code); socketObj.setActiveInvite(null); }} className="bg-brand-primary text-black font-bold py-2 rounded-lg text-[10px]">Join</button></motion.div></div> )}</AnimatePresence>
      <AnimatePresence>{isAuthModalOpen && ( <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"><motion.div className="bg-[#121212] border border-white/10 rounded-2xl p-8 w-full max-w-sm relative text-white shadow-2xl"><AuthForm onSuccess={handleLoginSuccess} onCancel={() => setIsAuthModalOpen(false)} /></motion.div></div> )}</AnimatePresence>
      <Suspense fallback={null}><AnimatePresence>{isPersonalizationOpen && <LazyPersonalizationOverlay token={token} activeTheme={activeTheme} onThemeSelect={(id: string) => { setActiveTheme(id); localStorage.setItem('aura_theme', id); }} onBackgroundUpload={(url: string) => {setCustomBg(url);}} onClose={() => setIsPersonalizationOpen(false)} />}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isProfileOpen && ( <LazyProfileOverlay token={token} isNormalizerEnabled={isNormalizerEnabled} onToggleNormalizer={(val: boolean) => { setIsNormalizerEnabled(val); localStorage.setItem('aura_norm', String(val)); }} onClose={() => setIsProfileOpen(false)} /> )}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isSessionOpen && ( <LazySessionOverlay onClose={() => setIsSessionOpen(false)} token={token} user={user} currentSession={socketObj.currentSession} messages={socketObj.sessionMessages} onSendMessage={handleSendChat} onCreateSession={handleStartSession} onJoinSession={handleJoinSession} onLeaveSession={() => { socketObj.setCurrentSession(null); socketObj.setSessionMessages([]); }} /> )}</AnimatePresence></Suspense>

      {/* MODAL CREAR PLAYLIST */}
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

      {/* MODAL EDITAR BIOGRAFÍA DE ARTISTA */}
      <AnimatePresence>{isEditingBio && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 text-white">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-3xl p-8 w-full max-w-lg relative text-white shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h3 className="text-xl uppercase font-bold font-serif italic">Editar Biografía: {selectedArtistName}</h3>
              <button onClick={() => setIsEditingBio(false)} className="text-white/40 hover:text-white cursor-pointer"><X size={20}/></button>
            </div>
            <form onSubmit={handleSaveArtistBio} className="space-y-4">
              <textarea 
                rows={6}
                value={newBioText}
                onChange={e => setNewBioText(e.target.value)}
                placeholder="Escribe la historia o información del artista aquí..."
                className="w-full bg-white/5 p-4 rounded-2xl text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-sans leading-relaxed resize-none"
              />
              <div className="flex gap-4">
                <button type="button" onClick={() => setIsEditingBio(false)} className="flex-1 bg-white/5 py-3 rounded-xl uppercase font-bold text-[10px] tracking-widest hover:bg-white/10 transition-all cursor-pointer">Cancelar</button>
                <button type="submit" className="flex-1 bg-brand-primary text-black py-3 rounded-xl uppercase font-bold text-[10px] tracking-widest hover:scale-105 transition-all cursor-pointer">Guardar Biografía</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}</AnimatePresence>

      {/* MODAL EDITAR METADATOS DE CANCIÓN CON PORTADA ANIMADA */}
      <AnimatePresence>{songToEdit && ( 
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 text-white overflow-y-auto py-10">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-3xl p-8 w-full max-w-lg relative text-white shadow-2xl">
            <button onClick={() => setSongToEdit(null)} className="absolute top-6 right-6 cursor-pointer text-white/40 hover:text-white transition-colors">
              <X size={24}/>
            </button>
            <form onSubmit={handleUpdateMetadata} className="space-y-6">
              <h3 className="text-2xl uppercase font-bold font-serif italic mb-8">Edit Track Metadata</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Title</label>
                  <input value={songToEdit.title} onChange={e => setSongToEdit({...songToEdit, title: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Artist</label>
                  <input value={songToEdit.artist} onChange={e => setSongToEdit({...songToEdit, artist: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Album</label>
                  <input value={songToEdit.album || ""} onChange={e => setSongToEdit({...songToEdit, album: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Track Number</label>
                  <input type="number" value={songToEdit.track_number || ""} onChange={e => setSongToEdit({...songToEdit, track_number: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Tabs URL</label>
                  <input placeholder="Songsterr / Tabs URL" value={songToEdit.tabs_url || ""} onChange={e => setSongToEdit({...songToEdit, tabs_url: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">YouTube Video URL</label>
                  <input placeholder="https://www.youtube.com/watch?v=..." value={songToEdit.video_url || ""} onChange={e => setSongToEdit({...songToEdit, video_url: e.target.value})} className="bg-white/5 p-4 rounded-2xl w-full text-sm text-white outline-none border border-white/10 focus:border-brand-primary transition-all font-bold" />
                </div>
              </div>

              {/* SECCIÓN DE PORTADAS: ESTÁTICA Y ANIMADA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/30 ml-2">Cover Art (Estática)</label>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
                      {newEditCover ? ( 
                        <img src={URL.createObjectURL(newEditCover)} className="w-full h-full object-cover" /> 
                      ) : ( 
                        <img src={songToEdit.coverUrl} className="w-full h-full object-cover" /> 
                      )}
                    </div>
                    <label className="flex-1 cursor-pointer bg-white/5 border-2 border-dashed border-white/10 rounded-2xl p-3 flex flex-col items-center justify-center hover:bg-white/10 transition-all text-center">
                      <ImageIcon size={18} className="text-white/20 mb-1"/>
                      <span className="text-[9px] font-bold uppercase text-white/40">Cambiar Foto</span>
                      <input type="file" accept="image/*" onChange={e => e.target.files && setNewEditCover(e.target.files[0])} className="hidden" />
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-brand-primary ml-2 flex items-center gap-1">
                    <Film size={12} /> Portada Animada (Focus)
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0 flex items-center justify-center bg-black">
                      {newEditAnimatedCover ? (
                        newEditAnimatedCover.type.startsWith('video') ? (
                          <video src={URL.createObjectURL(newEditAnimatedCover)} autoPlay loop muted className="w-full h-full object-cover" />
                        ) : (
                          <img src={URL.createObjectURL(newEditAnimatedCover)} className="w-full h-full object-cover" />
                        )
                      ) : songToEdit.animated_cover_path ? (
                        isVideoUrl(songToEdit.animated_cover_path) ? (
                          <video src={songToEdit.animated_cover_path.startsWith('/') ? songToEdit.animated_cover_path : `/${songToEdit.animated_cover_path}`} autoPlay loop muted className="w-full h-full object-cover" />
                        ) : (
                          <img src={songToEdit.animated_cover_path.startsWith('/') ? songToEdit.animated_cover_path : `/${songToEdit.animated_cover_path}`} className="w-full h-full object-cover" />
                        )
                      ) : (
                        <Film size={20} className="text-white/20" />
                      )}
                    </div>
                    <label className="flex-1 cursor-pointer bg-white/5 border-2 border-dashed border-brand-primary/20 rounded-2xl p-3 flex flex-col items-center justify-center hover:bg-brand-primary/5 transition-all text-center">
                      <Film size={18} className="text-brand-primary/40 mb-1"/>
                      <span className="text-[9px] font-bold uppercase text-brand-primary/60">Subir MP4/GIF</span>
                      <input type="file" accept="video/mp4,video/webm,image/gif" onChange={e => e.target.files && setNewEditAnimatedCover(e.target.files[0])} className="hidden" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setSongToEdit(null)} className="flex-1 bg-white/5 py-4 rounded-2xl uppercase font-bold text-[10px] tracking-widest hover:bg-white/10 transition-all">Cancel</button>
                <button type="submit" className="flex-1 bg-white text-black py-4 rounded-2xl uppercase font-bold text-[10px] tracking-widest hover:scale-[1.02] transition-all">Save Changes</button>
              </div>
            </form>
          </motion.div>
        </div> 
      )}</AnimatePresence>

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