import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useSyncExternalStore, FormEvent, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Background } from "./components/Background";
import { PlayerBar } from "./components/PlayerBar";
import { MusicCard } from "./components/MusicCard";
import { AlbumDetailView } from "./components/AlbumDetailView";
import { DEFAULT_COVER, getResponsiveCoverSrcSet, getThumbnailUrl, resolveApiUrl } from "./utils/api";
import { Visualizer } from "./components/Visualizer";
import { type Song, type Playlist } from "./constants";
import { THEMES, type MobilePlayerStyle } from "./constants/themes";
import { useFileUrl, resolveFileUrl } from "./hooks/useFileUrl";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import {
 Plus, Trash2, LogOut, ShieldCheck, Search, AlertTriangle, Edit2, Palette, Users,
  MinusCircle, ListPlus, SquarePlay, DoorOpen, ArrowUpDown, Filter, Clock, Image as ImageIcon,
  ChevronLeft, ChevronRight, Menu, Heart, Play, Trophy, Disc, FileText, Film, Library,
  Download,
Upload as UploadIcon,
Music2,
MessageCircle,
Settings,
User,
X,
Minus,
Square,
Copy,
  Sparkles,
  Moon,
  MoreHorizontal,
  SlidersHorizontal,
  CheckCircle2,
  Loader2,
  Shuffle,
  UserPlus,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { FullPlayerOverlay } from "./components/FullPlayerOverlay";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import AuraMedia from './plugins/auraMedia';
import { PlaylistImportOverlay } from "./components/PlaylistImportOverlay";


// Pantallas que no hacen falta en el primer render (solo se abren bajo
// demanda desde un botón/menú) — se cargan en su propio "trozo" (chunk)
// aparte, no como parte del bundle principal. Así el bundle principal pesa
// menos y arranca más rápido; estos componentes se descargan en paralelo,
// sin bloquear nada, y para cuando el usuario los abre normalmente ya están
// listos. No cambia ni el aspecto ni el comportamiento de ninguno de ellos.
const LazyTabsOverlay = lazy(() => import("./components/TabsOverlay").then(m => ({ default: m.TabsOverlay })));
const LazyProfileOverlay = lazy(() => import("./components/ProfileOverlay").then(m => ({ default: m.ProfileOverlay })));
const LazyPersonalizationOverlay = lazy(() => import("./components/PersonalizationOverlay").then(m => ({ default: m.PersonalizationOverlay })));
const LazyAudioSettingsOverlay = lazy(() => import("./components/AudioSettingsOverlay").then(m => ({ default: m.AudioSettingsOverlay })));
const LazyQueueOverlay = lazy(() => import("./components/QueueOverlay").then(m => ({ default: m.QueueOverlay })));
const LazySessionOverlay = lazy(() => import("./components/SessionOverlay").then(m => ({ default: m.SessionOverlay })));
const LazySocialOverlay = lazy(() => import("./components/SocialOverlay"));
const LazyMinigameLobbyOverlay = lazy(() => import("./components/MinigameLobbyOverlay").then(m => ({ default: m.MinigameLobbyOverlay })));
const LazyLyricsOverlay = lazy(() => import("./components/LyricsOverlay").then(m => ({ default: m.LyricsOverlay })));
const LazyMusicUpload = lazy(() => import("./components/MusicUpload").then(m => ({ default: m.MusicUpload })));
const LazySocialSidebar = lazy(() => import("./hooks/SocialSidebar").then(m => ({ default: m.SocialSidebar })));
const LazyWrappedOverlay = lazy(() => import("./components/WrappedOverlay").then(m => ({ default: m.WrappedOverlay })));
const LazySleepTimerOverlay = lazy(() => import("./components/SleepTimerOverlay").then(m => ({ default: m.SleepTimerOverlay })));
const LazyAuraDjOverlay = lazy(() => import("./components/AuraDjOverlay").then(m => ({ default: m.AuraDjOverlay })));

// MODULED IMPORTS AND HOOKS
import { DiscordLinkModal } from "./components/DiscordLinkModal";
import { fetchAndSyncGeminiKey } from "./services/aiDj";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { UpdateModal } from "./components/UpdateModal";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSleepTimer } from "./hooks/useSleepTimer";
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from "./audio/audioSettings";
import { useSocketLogic } from "./hooks/useSocketLogic";
import { AuthForm } from "./hooks/AuthSection";
import { useMediaSession } from "./hooks/useMediaSession";
import { useWindowsThumbbar } from "./hooks/useWindowsThumbbar";
import { prefetchAudio } from "./utils/audioCache";
import {
  getAllOfflineSongs,
  getCachedOfflineBlobUrl,
  subscribeOfflineStore,
  getOfflineIdsSnapshot,
  getDownloadNoticeSnapshot,
  getOfflinePlaylistIdsSnapshot,
  getPlaylistSyncProgressSnapshot,
  isPlaylistOffline,
  isPlaylistSyncing,
  getAllOfflinePlaylists,
  getOfflinePlaylistTracks,
  syncPlaylistOffline,
  removePlaylistOffline,
  syncAlbumOffline,
  downloadSongOffline,
} from "./utils/offlineDb";
import {
  useSongFuseIndex,
  useAlbumFuseIndex,
  useArtistFuseIndex,
  searchSongsWithFuse,
  searchAlbumsWithFuse,
  searchArtistsWithFuse,
  normalizeSearchText,
} from "./utils/searchEngine";

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


const getViewKey = (
  album: string | null,
  artist: string | null,
  playlistId: string,
  section: string,
  search: string
) => {
  if (search.trim()) return 'search:' + search.trim();
  if (album) return 'album:' + album;
  if (artist) return 'artist:' + artist;
  return 'lib:' + playlistId + ':' + section;
};

export default function App() {
  // --- DETECCIÓN Y ACCIONES DE ESCRITORIO ---
  const isDesktop = typeof window !== 'undefined' && (
    window.location.search.includes('app=desktop') ||
    Boolean((window as any).__TAURI__) ||
    Boolean((window as any).__TAURI_INTERNALS__)
  );

  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();

        const syncMaximized = async () => {
          try {
            const maxed = await win.isMaximized();
            if (!cancelled) setIsWindowMaximized(maxed);
          } catch {}
        };

        await syncMaximized();

        // Detecta también cuando se maximiza/restaura desde fuera de
        // nuestros botones: doble clic en la zona de arrastre, Snap de
        // Windows, atajos de teclado, etc.
        const stop = await win.onResized(() => {
          syncMaximized();
        });

        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // No estamos en Tauri (o la API no está disponible en esta
        // plataforma): el botón se queda con el icono por defecto.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isDesktop]);

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
      const win = getCurrentWindow();
      await win.toggleMaximize();
      try {
        setIsWindowMaximized(await win.isMaximized());
      } catch {}
      return;
    } catch (err) {}
    try {
      if ((window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|toggle_maximize');
        setIsWindowMaximized((prev) => !prev);
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

  // --- IN-APP UPDATER (ANDROID) ---
  const {
    updateInfo,
    currentVersion,
    isUpdateModalOpen,
    isWhatsNewModal,
    openWhatsNewModal,
    isChecking: isCheckingUpdate,
    checkMessage: updateCheckMessage,
    checkForUpdates,
    dismissUpdate
  } = useAppUpdate();

  // --- CORE STATE ---
  const [token, setToken] = useState<string | null>(localStorage.getItem('aura_token'));
  const [user, setUser] = useState<any>(localStorage.getItem('aura_user') ? JSON.parse(localStorage.getItem('aura_user')!) : null);
  const [userRole, setUserRole] = useState("user");

  useEffect(() => {
    const tokenValue = localStorage.getItem('aura_token');
    if (tokenValue) {
      try {
        const base64Url = tokenValue.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        const decoded = JSON.parse(jsonPayload);
        if (decoded.role) {
          setUserRole(decoded.role);
        }
      } catch (e) {
        console.error("Error decoding token for role:", e);
      }
    }
  }, []);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [discordLinkCode, setDiscordLinkCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('code') || null;
  });

  useEffect(() => {
    const isLinkPath = window.location.pathname === '/link' || window.location.pathname.startsWith('/link');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code || isLinkPath) {
      if (code) setDiscordLinkCode(code);
      if (!user) {
        setIsAuthModalOpen(true);
      }
    }
  }, [user]);
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
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const isNormalizerEnabled = audioSettings.normalizer.enabled;
  const updateAudioSettings = (next: AudioSettings) => {
    setAudioSettings(next);
    saveAudioSettings(next);
  };
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string>("all");
  const [playlists, setPlaylists] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showModeration, setShowModeration] = useState(false);
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [librarySection, setLibrarySection] = useState<'songs' | 'albums' | 'artists'>('songs');
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
  const [manualQueueIds, setManualQueueIds] = useState<string[]>([]);
  const [radioQueueIds, setRadioQueueIds] = useState<Set<string>>(new Set());
  const [activeTheme, setActiveTheme] = useState(localStorage.getItem('aura_theme') || 'dark');
  const [customBg, setCustomBg] = useState(user?.custom_bg_path || null);
  const [isSocialOpen, setIsSocialOpen] = useState(false);
  const [isSocialHubOpen, setIsSocialHubOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [isWrappedOpen, setIsWrappedOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeStats, setPurgeStats] = useState<{ albums: number; tracks: number; files: number } | null>(null);

  // METADATA EDITING STATES
  const [songToEdit, setSongToEdit] = useState<any | null>(null);
  const [newEditCover, setNewEditCover] = useState<File | null>(null);
  const [newEditAnimatedCover, setNewEditAnimatedCover] = useState<File | null>(null);
  
  const [allLibrarySongs, setAllLibrarySongs] = useState<Song[]>([]);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<any | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDescription, setNewPlaylistDescription] = useState("");
  const [playlistCoverFile, setPlaylistCoverFile] = useState<File | null>(null);
  const [playlistCoverPreview, setPlaylistCoverPreview] = useState<string | null>(null);
  const [playlistRemoveCover, setPlaylistRemoveCover] = useState(false);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);
  const [newPlaylistIsCollaborative, setNewPlaylistIsCollaborative] = useState(false);
  const [collaboratorsList, setCollaboratorsList] = useState<any[]>([]);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [isJoinPlaylistModalOpen, setIsJoinPlaylistModalOpen] = useState(false);
  const [manualJoinCode, setManualJoinCode] = useState("");
  const [isJoiningPlaylist, setIsJoiningPlaylist] = useState(false);
  const playlistInviteHandledRef = useRef<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPersonalizationOpen, setIsPersonalizationOpen] = useState(false);
  const [mobilePlayerStyle, setMobilePlayerStyle] = useState<MobilePlayerStyle>(() => {
    return (localStorage.getItem('aura_mobile_player_style') as MobilePlayerStyle) || 'floating';
  });
  const [mobileColumns, setMobileColumns] = useState<1 | 2 | 3>(() => {
    const saved = localStorage.getItem('aura_mobile_columns');
    return saved === '1' ? 1 : saved === '3' ? 3 : 2;
  });

  const getMobileSongGridClass = (cols: 1 | 2 | 3) => {
    if (cols === 1) {
      return "grid grid-cols-1 gap-3.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-6";
    }
    if (cols === 3) {
      return "grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-6";
    }
    return "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-6";
  };

  const getMobileAlbumGridClass = (cols: 1 | 2 | 3) => {
    if (cols === 1) {
      return "grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4 md:gap-6 animate-in fade-in duration-200 w-full max-w-full";
    }
    if (cols === 3) {
      return "grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3 md:gap-6 animate-in fade-in duration-200 w-full max-w-full";
    }
    return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-6 animate-in fade-in duration-200 w-full max-w-full";
  };
  const [isAiEnabled, setIsAiEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('aura_enable_ai');
    return saved !== null ? saved === 'true' : true;
  });
  const [bgOpacity, setBgOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('aura_bg_opacity');
    return saved ? parseInt(saved, 10) : 50;
  });
  const [ambientGlow, setAmbientGlow] = useState<'off' | 'soft' | 'vibrant'>(() => {
    return (localStorage.getItem('aura_ambient_glow') as any) || 'soft';
  });
  const [accentColor, setAccentColor] = useState<string>(() => {
    return localStorage.getItem('aura_accent_color') || '#F27D26';
  });
  const [ambientGlowColor, setAmbientGlowColor] = useState<string>(() => {
    return localStorage.getItem('aura_ambient_glow_color') || '#6366f1';
  });
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('aura_haptics_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const getAccentGradientColors = (hex: string): [string, string, string] => {
    try {
      let c = hex.replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const r = parseInt(c.substring(0, 2), 16) / 255;
      const g = parseInt(c.substring(2, 4), 16) / 255;
      const b = parseInt(c.substring(4, 6), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0, l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h = Math.round(h * 60);
      }
      s = Math.round(s * 100);
      l = Math.round(l * 100);

      const toHex = (hue: number, sat: number, lit: number) => {
        hue = ((hue % 360) + 360) % 360;
        const sa = Math.max(0, Math.min(100, sat)) / 100;
        const la = Math.max(0, Math.min(100, lit)) / 100;
        const a = sa * Math.min(la, 1 - la);
        const fn = (n: number) => {
          const k = (n + hue / 30) % 12;
          const color = la - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
          return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${fn(0)}${fn(8)}${fn(4)}`;
      };

      const c1 = toHex(h - 18, Math.min(100, s + 6), Math.min(84, l + 8));
      const c2 = hex;
      const c3 = toHex(h + 24, Math.max(30, s), Math.max(22, l - 6));
      return [c1, c2, c3];
    } catch {
      return ['#f59e0b', hex, '#ef4444'];
    }
  };

  const applyAccentColor = (hex: string) => {
    if (typeof document === 'undefined' || !hex) return;
    const [c1, c2, c3] = getAccentGradientColors(hex);
    document.documentElement.style.setProperty('--brand-primary', hex);
    document.documentElement.style.setProperty('--color-brand-primary', hex);
    document.documentElement.style.setProperty('--accent-tone', hex);
    document.documentElement.style.setProperty('--accent-glow', `${hex}40`);
    document.documentElement.style.setProperty('--aura-dj-gradient', `linear-gradient(135deg, ${c1}, ${c2}, ${c3})`);
    document.documentElement.style.setProperty('--aura-dj-subtle', `linear-gradient(135deg, ${c1}33, ${c2}26, ${c3}26)`);

    let tag = document.getElementById('aura-accent-override');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'aura-accent-override';
      document.head.appendChild(tag);
    }
    tag.textContent = `
      :root, html, body {
        --brand-primary: ${hex} !important;
        --color-brand-primary: ${hex} !important;
        --accent-tone: ${hex} !important;
        --accent-glow: ${hex}40 !important;
        --aura-dj-gradient: linear-gradient(135deg, ${c1}, ${c2}, ${c3}) !important;
        --aura-dj-subtle: linear-gradient(135deg, ${c1}33, ${c2}26, ${c3}26) !important;
      }
      .text-brand-primary { color: ${hex} !important; }
      .bg-brand-primary { background-color: ${hex} !important; }
      .border-brand-primary { border-color: ${hex} !important; }
      .fill-brand-primary { fill: ${hex} !important; }
      .stroke-brand-primary { stroke: ${hex} !important; }
      .ring-brand-primary { --tw-ring-color: ${hex} !important; }
      .accent-brand-primary { accent-color: ${hex} !important; }
      .aura-dj-btn {
        background: linear-gradient(135deg, ${c1}, ${c2}, ${c3}) !important;
        box-shadow: 0 10px 25px ${hex}40 !important;
        color: #ffffff !important;
      }
      .aura-dj-badge {
        background: linear-gradient(135deg, ${c1}33, ${c2}26, ${c3}26) !important;
        border-color: ${hex}66 !important;
        color: ${hex} !important;
      }
    `;
  };

  useEffect(() => {
    if (accentColor) {
      applyAccentColor(accentColor);
    }
  }, [accentColor]);
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [tabsSong, setTabsSong] = useState<Song | null>(null);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [isSleepTimerOpen, setIsSleepTimerOpen] = useState(false);
  const [isAuraDjOpen, setIsAuraDjOpen] = useState(false);
  const [isDesktopMenuOpen, setIsDesktopMenuOpen] = useState(false);
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
      librarySection: 'songs' | 'albums' | 'artists';
    }>
  >([]);

  const previousNavigationRef = useRef({
    playlistId: activePlaylistId,
    albumName: selectedAlbumName,
    artistName: selectedArtistName,
    librarySection: librarySection,
  });

  useEffect(() => {
    const previous = previousNavigationRef.current;

    const changed =
      previous.playlistId !== activePlaylistId ||
      previous.albumName !== selectedAlbumName ||
      previous.artistName !== selectedArtistName ||
      previous.librarySection !== librarySection;

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
      librarySection: librarySection,
    };
  }, [
    activePlaylistId,
    selectedAlbumName,
    selectedArtistName,
    librarySection,
  ]);

  const handleNavigateBack = useCallback(() => {
    const previous = navigationHistoryRef.current.pop();

    if (previous) {
      isGoingBackRef.current = true;
      setActivePlaylistId(previous.playlistId);
      setSelectedAlbumName(previous.albumName);
      setSelectedArtistName(previous.artistName);
      if (previous.librarySection) {
        setLibrarySection(previous.librarySection);
      }
      return;
    }

    if (selectedAlbumName) {
      setSelectedAlbumName(null);
    } else if (selectedArtistName) {
      setSelectedArtistName(null);
    } else if (activePlaylistId !== 'all') {
      setActivePlaylistId('all');
    }
  }, [selectedAlbumName, selectedArtistName, activePlaylistId]);
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
  const [tvVideoError, setTvVideoError] = useState(false);
  useEffect(() => {
    setTvVideoError(false);
  }, [currentSong?.id, resolvedAnimatedCoverUrl]);
  const resolvedAudioUrl = useFileUrl(currentSong?.audioUrl);
  const resolvedCustomBg = useFileUrl(customBg);
  const resolvedProfilePic = useFileUrl(user?.profile_pic_path);

  // --- LOGIC MODULES ---
  const handleSongEndedRef = useRef<() => void>(() => {});
  const getNextTrackInfoRef = useRef<(() => { song: Song; resolveUrl: () => Promise<string | undefined> } | null)>(() => null);
  const handleGaplessNextRef = useRef<((s: Song) => void)>(() => {});

  const visualizerActive = audioSettings.visualizer.enabled && (isFocusMode || isSessionOpen);
  const audioObj = useAudioEngine(
    currentSong,
    isPlaying,
    volume,
    audioSettings,
    setIsPlaying,
    resolvedAudioUrl,
    visualizerActive,
    () => handleSongEndedRef.current(),
    () => getNextTrackInfoRef.current(),
    (s) => handleGaplessNextRef.current(s)
  );
  const socketObj = useSocketLogic(user, handlePlaySongRef, setIsPlaying, audioObj.audioRef, setActiveQueue);

  const handlePauseForSleepTimer = useCallback(() => {
    if (audioObj.audioRef.current) {
      audioObj.audioRef.current.pause();
    }
    setIsPlaying(false);
    socketObj.emitCommand('toggle-play', { isPlaying: false });
  }, [audioObj.audioRef, setIsPlaying, socketObj]);

  const sleepTimer = useSleepTimer({
    isPlaying,
    onPause: handlePauseForSleepTimer,
    currentSong,
    getCurrentTime: audioObj.getCurrentTime,
    duration: audioObj.duration,
    volume,
    setVolume,
  });

  const sleepTimerRemainingText = useMemo(() => {
    const secs = sleepTimer.remainingSeconds;
    if (secs <= 0) return '0m';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}h ${m % 60}m`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [sleepTimer.remainingSeconds]);

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

// EFECTO PARA DISCORD RICH PRESENCE (Solo en Desktop / Tauri)
useEffect(() => {
  if (!isDesktop) return;

  const audio = audioObj.audioRef.current;

  const updateDiscord = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Discord necesita una URL absoluta para la carátula
      let cover = currentSong?.coverUrl || '';
      if (cover.startsWith('/')) cover = window.location.origin + cover;

      const dur = audioObj.duration;
      await invoke('update_discord_rpc', {
        title: currentSong?.title ?? '',
        artist: currentSong?.artist ?? '',
        album: currentSong?.album ?? '',
        coverUrl: cover,
        positionMs: Math.round((audioObj.getCurrentTime() || 0) * 1000),
        durationMs: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) : 0,
        sessionCode: socketObj.currentSession ?? '',
        isPlaying,
      });
    } catch (err) {
      console.error("Error actualizando Discord RPC:", err);
    }
  };

  updateDiscord();
  // Si el usuario salta a otro punto de la canción, se recalcula la barra
  audio?.addEventListener('seeked', updateDiscord);
  return () => audio?.removeEventListener('seeked', updateDiscord);
}, [isDesktop, currentSong?.id, currentSong?.coverUrl, isPlaying, audioObj.duration, socketObj.currentSession]);


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

    if (isAudioSettingsOpen) {
      setIsAudioSettingsOpen(false);
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
    if (navigationHistoryRef.current.length > 0) {
      handleNavigateBack();
      return;
    }

    if (selectedAlbumName || selectedArtistName || activePlaylistId !== 'all') {
      handleNavigateBack();
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
  isAudioSettingsOpen,
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
    if (!currentSong || !token) return;

    const updateActivity = () => {
      if (socketObj.socketRef.current) {
        socketObj.socketRef.current.emit('update-activity', {
          trackId: currentSong.id,
          title: currentSong.title,
          artist: currentSong.artist,
        });
      }
    };

    updateActivity();
    const interval = setInterval(updateActivity, 30000);
    return () => clearInterval(interval);
  }, [currentSong?.id, token]);

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
    localStorage.setItem('aura_token', t); localStorage.setItem('aura_user', JSON.stringify(u));
    setUserRole(r);
    window.location.reload();
  };
  const handleLogout = () => { localStorage.clear(); window.location.reload(); };

  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSessionNotice = (msg: string) => {
    setSessionNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setSessionNotice(null), 5000);
  };
  const joinErrorMessage = (code: string, error?: string) => {
    switch (error) {
      case 'SESSION_NOT_FOUND': return `La sesión ${code} no existe o ya se cerró.`;
      case 'INVALID_CODE': return 'El código de sesión no es válido.';
      case 'TIMEOUT': return 'No se pudo conectar con el servidor. Inténtalo de nuevo.';
      default: return 'No se pudo unir a la sesión.';
    }
  };

  const handleStartSession = async () => {
    const activeToken = token || localStorage.getItem('aura_token');
    try {
      const res = await fetch(`${API_BASE}/api/sessions/create`, { method: 'POST', headers: { 'Authorization': `Bearer ${activeToken}` } });
      const data = await res.json();
      if (!res.ok) return showSessionNotice('No se pudo crear la sesión.');
      const result = await socketObj.joinSession(data.code, { asLeader: true });
      if (!result.ok) {
        showSessionNotice(joinErrorMessage(data.code, result.error));
      } else {
        // Enviar inmediatamente la canción actual, la cola y el estado al servidor para que el snapshot esté completo
        if (currentSong) {
          socketObj.emitCommand('play-track', {
            id: currentSong.id,
            song: currentSong,
            queue: activeQueue.length > 0 ? activeQueue : [currentSong],
            position: audioObj.getCurrentTime?.() || 0,
            isPlaying: isPlaying
          });
        }
        if (socketObj.isShuffle) {
          socketObj.emitCommand('toggle-shuffle', { isShuffle: true, shuffledQueue: socketObj.shuffledQueue });
        }
        if (socketObj.isLoop) {
          socketObj.emitCommand('toggle-loop', { isLoop: true });
        }
        showSessionNotice(`Sesión ${data.code} creada. ¡Eres el anfitrión!`);
      }
    } catch (e) {
      showSessionNotice('No se pudo crear la sesión.');
    }
  };
  const handleJoinSession = async (rawCode: string) => {
    const code = (rawCode || '').trim().toUpperCase();
    const result = await socketObj.joinSession(code);
    if (!result.ok) {
      showSessionNotice(joinErrorMessage(code, result.error));
    } else {
      setIsSessionOpen(true);
      if ((result.members ?? 1) <= 1) {
        showSessionNotice(`Te has unido a ${code}, pero ahora mismo no hay nadie más conectado.`);
      }
    }
    return result;
  };
  // Unirse a una sesión desde un enlace ?join=CODIGO (botón de Discord)
  const joinFromUrlDoneRef = useRef(false);

  // Si el enlace se abre en un NAVEGADOR normal (no dentro de la app de escritorio)
  // y Aura está instalada, se intenta pasar el testigo a la app con aura://join/CODIGO.
  // Si no está instalada, el navegador simplemente ignora el esquema y no pasa nada raro.
  useEffect(() => {
    if (isDesktop) return; // ya estamos dentro de la app: no hace falta relanzarla
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (!code) return;
    window.location.href = `aura://join/${encodeURIComponent(code)}`;
  }, [isDesktop]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (!code || joinFromUrlDoneRef.current) return;
    // Hace falta estar logueado: se conserva el ?join= y se pide iniciar sesión
    // (tras el login la página se recarga y el enlace sigue ahí).
    if (!user) { setIsAuthModalOpen(true); return; }
    joinFromUrlDoneRef.current = true;
    handleJoinSession(code);
    params.delete('join');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
  }, [user]);
  const handleSendChat = (message: string) => { if (socketObj.currentSession) socketObj.socketRef.current?.emit('send-chat', { code: socketObj.currentSession, user, message }); };

  // ESTADÍSTICAS DE ESCUCHA (para el "Wrapped"): un aviso cada 30s de reproducción
  // real de la misma canción. Si se cambia de canción o se pausa, se corta sin más
  // (perder los últimos segundos sueltos no afecta a un resumen de este tipo).
  useEffect(() => {
    if (!isPlaying || !currentSong || !token) return;
    const interval = setInterval(() => {
      const activeToken = token || localStorage.getItem('aura_token');
      fetch(`${API_BASE}/api/stats/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({
          trackId: currentSong.id,
          title: currentSong.title,
          artist: currentSong.artist,
          album: currentSong.album,
          ms: 30000,
        }),
      }).catch(() => {}); // no pasa nada si un aviso suelto no llega
    }, 30000);
    return () => clearInterval(interval);
  }, [isPlaying, currentSong?.id, token]);

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
        if (!Capacitor.isNativePlatform()) {
          await preloadVideo(resolved);
        }
      } else {
        await preloadImage(resolved);
      }
    } catch (e) {
      // Best-effort: si falla, no pasa nada — se cargará normal al abrir.
    }
  };

  const offlineIds = useSyncExternalStore(subscribeOfflineStore, getOfflineIdsSnapshot, getOfflineIdsSnapshot);
  const downloadNotice = useSyncExternalStore(subscribeOfflineStore, getDownloadNoticeSnapshot, getDownloadNoticeSnapshot);
  const offlinePlaylistIds = useSyncExternalStore(subscribeOfflineStore, getOfflinePlaylistIdsSnapshot, getOfflinePlaylistIdsSnapshot);
  const playlistSyncProgress = useSyncExternalStore(subscribeOfflineStore, getPlaylistSyncProgressSnapshot, getPlaylistSyncProgressSnapshot);

  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 12000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const applyOfflineFallback = async () => {
    // Si estamos en una playlist específica y está guardada offline, cargamos sus canciones
    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked' && activePlaylistId !== 'offline') {
      const playlistTracks = await getOfflinePlaylistTracks(activePlaylistId);
      if (playlistTracks.length > 0) {
        setSongs(playlistTracks);
        if (!currentSong || !playlistTracks.some(s => String(s.id) === String(currentSong.id))) {
          setCurrentSong(playlistTracks[0]);
          setHeroImageError(false);
        }
        return;
      }
    }

    const offlineTracks = await getAllOfflineSongs();
    setSongs(offlineTracks);
    if (offlineTracks.length > 0 && (!currentSong || !offlineTracks.some(s => String(s.id) === String(currentSong.id)))) {
      setCurrentSong(offlineTracks[0]);
      setHeroImageError(false);
    }
  };

  const loadContent = async () => {
    setIsLoading(true);
    try {
      const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (activePlaylistId === 'offline' || isBrowserOffline) {
        await applyOfflineFallback();
        setIsLoading(false);
        return;
      }
      const activeToken = token || localStorage.getItem('aura_token');
      const endpoint = activePlaylistId === 'all' || activePlaylistId === 'liked' ? `/api/tracks?status=${showModeration ? 'pending' : 'approved'}` : `/api/playlists/${activePlaylistId}/tracks`;
      let res = await fetchWithTimeout(`${API_BASE}${endpoint}`, { headers: { 'Authorization': `Bearer ${activeToken}` } }, 12000);
      if (!res.ok) {
        // Reintento automático tras 1.2s en caso de reinicio de servidor o corte temporal
        await new Promise(r => setTimeout(r, 1200));
        res = await fetchWithTimeout(`${API_BASE}${endpoint}`, { headers: { 'Authorization': `Bearer ${activeToken}` } }, 12000);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        if (activePlaylistId === 'all') {
          setAllLibrarySongs(mapped);
        }
        setLikedIds(data.filter((s: any) => s.is_liked).map((s: any) => s.id.toString()));

        // Sincronizar metadatos frescos (carátula, audio, título) en currentSong si proviene de caché antigua
        setCurrentSong(prev => {
          if (!prev) return prev;
          const fresh = mapped.find((s: any) => String(s.id) === String(prev.id));
          if (fresh && (fresh.coverUrl !== prev.coverUrl || fresh.audioUrl !== prev.audioUrl || fresh.title !== prev.title)) {
            const merged = { ...prev, ...fresh };
            try { localStorage.setItem('aura_last_song', JSON.stringify(merged)); } catch {}
            return merged;
          }
          return prev;
        });

        // Sincronizar carátulas frescas en recentlyPlayed
        setRecentlyPlayed(prev => {
          if (!prev || prev.length === 0) return prev;
          let changed = false;
          const updated = prev.map(oldSong => {
            const fresh = mapped.find((s: any) => String(s.id) === String(oldSong.id));
            if (fresh && fresh.coverUrl !== oldSong.coverUrl) {
              changed = true;
              return { ...oldSong, ...fresh };
            }
            return oldSong;
          });
          if (changed) {
            try { localStorage.setItem('aura_recent', JSON.stringify(updated)); } catch {}
          }
          return changed ? updated : prev;
        });

        // Cargar todos los artistas en una sola petición ligera para no saturar conexiones ni bloquear imágenes
        fetch(`${API_BASE}/api/artists`)
          .then(r => r.ok ? r.json() : null)
          .then(allArtists => {
            if (allArtists && typeof allArtists === 'object') {
              setArtistsMap(prev => ({ ...prev, ...allArtists }));
            }
          })
          .catch(() => {});
      } else {
        await applyOfflineFallback();
      }
    } catch (e) {
      console.warn("Load failed, falling back to offline tracks:", e);
      await applyOfflineFallback();
    }
    setIsLoading(false);
  };

  const loadPlaylists = async () => {
    const activeToken = token || localStorage.getItem('aura_token');
    const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!activeToken || isBrowserOffline) {
      const offlinePlaylists = await getAllOfflinePlaylists();
      if (offlinePlaylists.length > 0) {
        setPlaylists(offlinePlaylists.map(p => ({
          id: p.id,
          name: p.name,
          songIds: p.songIds,
          color: p.color || '#a855f7',
          description: p.description,
          cover_path: p.cover_path,
          ownerId: '',
          createdAt: new Date(p.syncedAt).toISOString()
        })));
      }
      return;
    }
    try {
      let res = await fetchWithTimeout(`${API_BASE}/api/playlists`, { headers: { 'Authorization': `Bearer ${activeToken}` } }, 12000);
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 1200));
        res = await fetchWithTimeout(`${API_BASE}/api/playlists`, { headers: { 'Authorization': `Bearer ${activeToken}` } }, 12000);
      }
      if (!res.ok) {
        const offlinePlaylists = await getAllOfflinePlaylists();
        if (offlinePlaylists.length > 0) {
          setPlaylists(offlinePlaylists.map(p => ({
            id: p.id,
            name: p.name,
            songIds: p.songIds,
            color: p.color || '#a855f7',
            description: p.description,
            cover_path: p.cover_path,
            ownerId: '',
            createdAt: new Date(p.syncedAt).toISOString()
          })));
        }
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) setPlaylists(data);
    } catch (e) {
      console.error("Playlists failed, loading offline playlists:", e);
      const offlinePlaylists = await getAllOfflinePlaylists();
      if (offlinePlaylists.length > 0) {
        setPlaylists(offlinePlaylists.map(p => ({
          id: p.id,
          name: p.name,
          songIds: p.songIds,
          color: p.color || '#a855f7',
          description: p.description,
          cover_path: p.cover_path,
          ownerId: '',
          createdAt: new Date(p.syncedAt).toISOString()
        })));
      }
    }
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
    const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!activeToken || isBrowserOffline) {
      await localCoverPreload;
      markHeroReady();
      return;
    }

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/users/me/last-track`, {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      }, 4000);
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
  useEffect(() => { if (token) void fetchAndSyncGeminiKey(token); }, [token]);

  useEffect(() => {
    const handleOnline = () => {
      loadContent();
      loadPlaylists();
    };
    const handleOffline = () => {
      loadContent();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [activePlaylistId, showModeration, token]);

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
  const handleToggleLike = async (rawSongId: string | number) => {
    const songId = String(rawSongId);
    const activeToken = token || localStorage.getItem('aura_token');
    if (!activeToken) return setIsAuthModalOpen(true);

    // Actualización optimista inmediata en la UI
    const wasLiked = likedIds.some(id => String(id) === songId);
    setLikedIds(prev =>
      wasLiked
        ? prev.filter(id => String(id) !== songId)
        : [...prev.filter(id => String(id) !== songId), songId]
    );

    try {
      const res = await fetch(`${API_BASE}/api/tracks/${songId}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.liked === 'boolean') {
          setLikedIds(prev => {
            const clean = prev.filter(id => String(id) !== songId);
            return data.liked ? [...clean, songId] : clean;
          });
        }
      } else {
        // Revertir si falló
        setLikedIds(prev => {
          const clean = prev.filter(id => String(id) !== songId);
          return wasLiked ? [...clean, songId] : clean;
        });
      }
    } catch {
      // Revertir en error de red
      setLikedIds(prev => {
        const clean = prev.filter(id => String(id) !== songId);
        return wasLiked ? [...clean, songId] : clean;
      });
    }
  };

  // --- PLAYBACK ENGINE Y GUARDADO DE ÚLTIMA CANCIÓN ---
  // Aviso breve de "solo el anfitrión controla" (2.5s y desaparece solo).
  const [hostOnlyNotice, setHostOnlyNotice] = useState<string | null>(null);
  const hostOnlyNoticeTimer = useRef<any>(null);

  // true si estamos en una sesión y no somos quien la controla: en ese caso
  // los controles de reproducción no hacen nada (el servidor los rechazaría igualmente).
  const isSessionGuest = () => !!socketObj.currentSession && !socketObj.isLeader();

  const blockIfGuest = (): boolean => {
    if (!isSessionGuest()) return false;
    setHostOnlyNotice('Solo el anfitrión de la sesión controla la reproducción');
    clearTimeout(hostOnlyNoticeTimer.current);
    hostOnlyNoticeTimer.current = setTimeout(() => setHostOnlyNotice(null), 2500);
    return true;
  };

  // Obtiene las pistas de los álbumes siguientes en la biblioteca en orden alfabético
  // y después las canciones sueltas sin álbum, evitando volver al inicio de la BD al terminar un álbum.
  const getSubsequentLibraryTracksForAlbum = (targetAlbum: string, allSongs: Song[]): Song[] => {
    if (!targetAlbum || !allSongs || allSongs.length === 0) return [];

    const albumMap = new Map<string, Song[]>();
    const nonAlbumSongs: Song[] = [];

    allSongs.forEach(song => {
      const alb = song.album?.trim();
      if (alb) {
        if (!albumMap.has(alb)) {
          albumMap.set(alb, []);
        }
        albumMap.get(alb)!.push(song);
      } else {
        nonAlbumSongs.push(song);
      }
    });

    const sortTracks = (tracks: Song[]) => {
      return [...tracks].sort((a, b) => {
        const numA = Number(a.track_number);
        const numB = Number(b.track_number);
        if (numA && numB) return numA - numB;
        if (numA && !numB) return -1;
        if (!numA && numB) return 1;
        return a.title.localeCompare(b.title);
      });
    };

    const sortedAlbumNames = Array.from(albumMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const normTarget = targetAlbum.trim().toLowerCase();
    const targetIdx = sortedAlbumNames.findIndex(name => name.trim().toLowerCase() === normTarget);

    let subsequentAlbumNames: string[] = [];
    if (targetIdx !== -1) {
      subsequentAlbumNames = [
        ...sortedAlbumNames.slice(targetIdx + 1),
        ...sortedAlbumNames.slice(0, targetIdx)
      ];
    } else {
      subsequentAlbumNames = sortedAlbumNames.filter(name => name.trim().toLowerCase() !== normTarget);
    }

    const result: Song[] = [];
    for (const albName of subsequentAlbumNames) {
      const tracks = albumMap.get(albName);
      if (tracks && tracks.length > 0) {
        result.push(...sortTracks(tracks));
      }
    }

    if (nonAlbumSongs.length > 0) {
      const sortedNonAlbum = [...nonAlbumSongs].sort((a, b) => {
        const artCmp = (a.artist || '').localeCompare(b.artist || '');
        if (artCmp !== 0) return artCmp;
        return a.title.localeCompare(b.title);
      });
      result.push(...sortedNonAlbum);
    }

    return result;
  };

  const handlePlaySong = async (
    song: Song,
    fromSocket = false,
    initialPos = 0,
    preserveQueue = false,
    albumContextName?: string | null
  ) => {
    // Si es un invitado que hace click en la canción actual que estaba pausada (ej. por bloqueo de autoplay),
    // le permitimos iniciar su reproducción local y resincronizarse con la sesión sin bloquearlo
    if (!fromSocket && isSessionGuest()) {
      if (currentSong?.id === song.id && !isPlaying) {
        setIsPlaying(true);
        socketObj.resyncSession();
        return;
      }
      if (blockIfGuest()) return;
    }

    if (currentSong?.id === song.id) {
      if (song.coverUrl && song.coverUrl !== currentSong.coverUrl) {
        setCurrentSong(prev => prev ? { ...prev, ...song } : song);
        try { localStorage.setItem('aura_last_song', JSON.stringify({ ...currentSong, ...song })); } catch {}
      }
      if (fromSocket) {
        setIsPlaying(true);
        if (initialPos > 0 && Math.abs(audioObj.getCurrentTime() - initialPos) > 1.5) {
          audioObj.seek(initialPos);
        }
        return;
      }
      const nextState = !isPlaying;
      setIsPlaying(nextState);
      socketObj.emitCommand('toggle-play', { isPlaying: nextState });
      if (nextState && socketObj.currentSession) socketObj.resyncSession();
      return;
    }

    let finalQueue = activeQueue;

    if (!fromSocket && !preserveQueue) {
      // 1. DESDE UN ÁLBUM
      const effectiveAlbumName = albumContextName ?? selectedAlbumName;
      if (effectiveAlbumName) {
        setPlaybackContext('album');
        setContextAlbumName(effectiveAlbumName);

        const albumTracks = songs
          .filter(s => s.album === effectiveAlbumName)
          .sort((a, b) => {
            const numA = Number(a.track_number);
            const numB = Number(b.track_number);
            if (numA && numB) return numA - numB;
            if (numA && !numB) return -1;
            if (!numA && numB) return 1;
            return a.title.localeCompare(b.title);
          });

        const subsequentTracks = getSubsequentLibraryTracksForAlbum(effectiveAlbumName, songs);

        if (socketObj.isShuffle) {
          const otherAlbumSongs = albumTracks.filter(s => s.id !== song.id).sort(() => Math.random() - 0.5);
          const shuffledAlbum = [song, ...otherAlbumSongs];
          const shuffledLibrary = [...subsequentTracks].sort(() => Math.random() - 0.5);
          finalQueue = [...shuffledAlbum, ...shuffledLibrary];
          socketObj.setShuffledQueue(finalQueue);
        } else {
          finalQueue = [...albumTracks, ...subsequentTracks];
        }
        setActiveQueue(finalQueue);
        setManualQueueIds([]);

      // 2. DESDE UNA PLAYLIST PERSONALIZADA
      } else if (activePlaylistId !== 'all' && activePlaylistId !== 'liked' && activePlaylistId !== 'offline') {
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
        setManualQueueIds([]);

      // 3. DESDE LA BIBLIOTECA GENERAL O PESTAÑAS GENERALES (FAVORITES / OFFLINE)
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
        setManualQueueIds([]);
        setRadioQueueIds(new Set());
      }
    } else if (preserveQueue) {
      // Si avanzamos a una canción que estaba en la cola manual o radio, la removemos de la lista de pendientes
      setManualQueueIds(prev => prev.filter(id => id !== song.id));
      setRadioQueueIds(prev => {
        if (!prev.has(song.id)) return prev;
        const next = new Set(prev);
        next.delete(song.id);
        return next;
      });
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

    // La posición se aplica cuando la nueva canción termine de cargar (ver useAudioEngine).
    audioObj.pendingSeekRef.current = initialPos > 0 ? initialPos : null;

    if (!fromSocket) {
      socketObj.emitCommand('play-track', {
        id: song.id,
        song,
        queue: finalQueue,
        position: 0
      });
    }
  };

  // REPRODUCIR MEZCLA GENERADA POR AURA DJ
  const handlePlayDjMix = (tracks: Song[]) => {
    if (!tracks || tracks.length === 0) return;
    setActiveQueue(tracks);
    setManualQueueIds([]);
    setRadioQueueIds(new Set());
    handlePlaySong(tracks[0], false, 0, false);
  };

  // --- MOTOR DE RECOMENDACIÓN: RADIO INFINITA / AUTOPLAY ---
  const generateRadioTracks = useCallback((seedSong: Song, currentPool: Song[]): Song[] => {
    if (!songs || songs.length === 0) return [];

    const existingIds = new Set([
      seedSong.id,
      ...currentPool.map(s => s.id),
      ...recentlyPlayed.slice(0, 5).map(s => s.id)
    ]);

    const candidates = songs.filter(s => !existingIds.has(s.id));
    if (candidates.length === 0) {
      const fallback = songs.filter(s => s.id !== seedSong.id);
      return fallback.sort(() => Math.random() - 0.5).slice(0, 8);
    }

    const seedArtistLower = (seedSong.artist || '').toLowerCase().trim();
    const seedAlbumLower = (seedSong.album || '').toLowerCase().trim();
    const likedSet = new Set(likedIds);

    const scored = candidates.map(track => {
      let score = 0;
      const trackArtistLower = (track.artist || '').toLowerCase().trim();
      const trackAlbumLower = (track.album || '').toLowerCase().trim();

      // Mismo artista
      if (trackArtistLower === seedArtistLower && seedArtistLower !== '') {
        score += 15;
      } else if (
        seedArtistLower.includes(trackArtistLower) ||
        trackArtistLower.includes(seedArtistLower)
      ) {
        score += 8;
      }

      // Mismo álbum
      if (trackAlbumLower === seedAlbumLower && seedAlbumLower !== '') {
        score += 6;
      }

      // Favoritos del usuario
      if (likedSet.has(track.id)) {
        score += 5;
      }

      // Toque aleatorio sutil para variedad en cada radio
      score += Math.random() * 4;

      return { track, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map(s => s.track);
  }, [songs, recentlyPlayed, likedIds]);

  const handleNext = async () => {
    if (blockIfGuest()) return;
    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

    if (pool.length === 0) return;

    if (socketObj.isLoop && currentSong) {
      audioObj.seek(0);
      try {
        await audioObj.audioRef.current?.play();
      } catch (error) {
        console.error('Error reiniciando canción en loop:', error);
      }

      setIsPlaying(true);
      return;
    }

    const currentIndex = pool.findIndex((s) => s.id === currentSong?.id);
    const isAutoplay = audioSettings.autoplay?.enabled ?? true;
    const isAtEnd = currentIndex >= pool.length - 1;

    // Si llegamos al final de la cola y Autoplay / Radio Infinita está activo
    if (isAtEnd && !socketObj.isLoop && currentSong && isAutoplay) {
      const radioTracks = generateRadioTracks(currentSong, pool);
      if (radioTracks.length > 0) {
        const updatedQueue = [...pool, ...radioTracks];
        setActiveQueue(updatedQueue);
        if (socketObj.isShuffle) {
          socketObj.setShuffledQueue(updatedQueue);
        }
        setRadioQueueIds(prev => new Set([...prev, ...radioTracks.map(t => t.id)]));
        socketObj.emitCommand('update-queue', { queue: updatedQueue });
        handlePlaySong(radioTracks[0], false, 0, true);
        return;
      }
    }

    if (playbackContext === 'playlist' && isAtEnd) {
      if (!socketObj.isLoop) {
        setIsPlaying(false);
        setCurrentSong(null);
        try { localStorage.removeItem('aura_last_song'); } catch (e) {}
        setActiveQueue([]);
        socketObj.setShuffledQueue([]);
        if (audioObj.audioRef.current) { audioObj.audioRef.current.pause(); }
audioObj.seek(0);
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
    if (blockIfGuest()) return;
    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());

    if (pool.length === 0) return;

    const currentIndex = pool.findIndex((s) => s.id === currentSong?.id);

    if (audioObj.getCurrentTime() > 3) {
      audioObj.seek(0);
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
    const timer = setTimeout(() => {
      resolveFileUrl(nextSong.audioUrl).then((url) => {
        if (!cancelled) prefetchAudio(url);
      });
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentSong?.id, activeQueue, socketObj.isShuffle, socketObj.shuffledQueue]);

  const toggleShuffle = (forcedState?: boolean) => {
    if (blockIfGuest()) return;
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
          .sort((a, b) => {
            const numA = Number(a.track_number);
            const numB = Number(b.track_number);
            if (numA && numB) return numA - numB;
            if (numA && !numB) return -1;
            if (!numA && numB) return 1;
            return a.title.localeCompare(b.title);
          });
        const libraryTracks = getSubsequentLibraryTracksForAlbum(contextAlbumName, songs);

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
          .sort((a, b) => {
            const numA = Number(a.track_number);
            const numB = Number(b.track_number);
            if (numA && numB) return numA - numB;
            if (numA && !numB) return -1;
            if (!numA && numB) return 1;
            return a.title.localeCompare(b.title);
          });
        const libraryTracks = getSubsequentLibraryTracksForAlbum(contextAlbumName, songs);
        setActiveQueue([...albumTracks, ...libraryTracks]);
      }
    }

    socketObj.emitCommand('toggle-shuffle', { isShuffle: nextShuffleState, shuffledQueue: newShuffled });
  };

  const toggleLoop = (forcedState?: boolean) => {
    if (blockIfGuest()) return;
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

  // Al terminar una canción dentro de una sesión solo avanza el líder; los demás
  // esperan su play-track (si no llega en 3 s, avanzan ellos para no quedarse parados).
  const handleNextRef = useRef<() => void>(() => {});
  handleNextRef.current = handleNext;
  const handlePreviousRef = useRef<() => void>(() => {});
  handlePreviousRef.current = handlePrevious;
  const handleSongEnded = () => {
    if (!socketObj.currentSession || socketObj.isLeader()) return handleNext();
    const endedId = socketObj.getTrackId();
    setTimeout(() => {
      if (socketObj.getTrackId() === endedId) handleNextRef.current();
    }, 3000);
  };
  handleSongEndedRef.current = handleSongEnded;

  audioObj.onCrossfadeNextRef.current = (commitCrossfade: () => void) => {
    if (isMinigameActive || socketObj.isLoop) return;
    if (socketObj.currentSession && !socketObj.isLeader()) return;

    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : getFlattenedSongs());
    if (pool.length < 2 || !currentSong) return;

    const currentIndex = pool.findIndex((s) => s.id === currentSong.id);
    const isAutoplay = audioSettings.autoplay?.enabled ?? true;
    const isAtEnd = currentIndex >= pool.length - 1;

    if (isAtEnd) {
      if (isAutoplay && !socketObj.isLoop) {
        const radioTracks = generateRadioTracks(currentSong, pool);
        if (radioTracks.length > 0) {
          const updatedQueue = [...pool, ...radioTracks];
          setActiveQueue(updatedQueue);
          if (socketObj.isShuffle) socketObj.setShuffledQueue(updatedQueue);
          setRadioQueueIds(prev => new Set([...prev, ...radioTracks.map(t => t.id)]));
          socketObj.emitCommand('update-queue', { queue: updatedQueue });
          commitCrossfade();
          handlePlaySong(radioTracks[0], false, 0, true);
          return;
        }
      }
      if (playbackContext === 'playlist') return;
    }

    const nextSong = currentIndex === -1 ? pool[0] : pool[(currentIndex + 1) % pool.length];
    if (!nextSong || nextSong.id === currentSong.id) return;

    commitCrossfade();
    handlePlaySong(nextSong, false, 0, true);
  };

  // Cola: cualquier miembro de la sesión puede tocarla (añadir, "siguiente",
  // reordenar) sin ser el anfitrión.
  const handlePlayNext = (song: Song) => {
    // Si no hay canción sonando, la ponemos directamente
    if (!currentSong) {
      handlePlaySong(song);
      return;
    }

    const isShuff = socketObj.isShuffle;
    const currentPool = isShuff
      ? (socketObj.shuffledQueue.length > 0 ? [...socketObj.shuffledQueue] : (activeQueue.length > 0 ? [...activeQueue] : [...songs]))
      : (activeQueue.length > 0 ? [...activeQueue] : [...songs]);

    // Aseguramos que currentSong esté en la cola
    let curIdx = currentPool.findIndex(s => s.id === currentSong.id);
    if (curIdx === -1) {
      currentPool.unshift(currentSong);
      curIdx = 0;
    }

    // Quitamos song si ya existía en otra posición que no sea la actual sonando
    const filtered = currentPool.filter((s, idx) => idx === curIdx || s.id !== song.id);
    curIdx = filtered.findIndex(s => s.id === currentSong.id);

    // Reproducir siguiente se inserta EXACTAMENTE en curIdx + 1 (la siguiente pista)
    const insertIdx = curIdx + 1;
    filtered.splice(insertIdx, 0, song);

    // Registramos la canción como parte de la cola manual de prioridad al frente
    setManualQueueIds(prev => [song.id, ...prev.filter(id => id !== song.id)]);

    setActiveQueue(filtered);
    if (isShuff) {
      socketObj.setShuffledQueue(filtered);
    }
    socketObj.emitCommand('update-queue', { queue: filtered });
  };

  const handleAddToQueue = (song: Song) => {
    if (!currentSong) {
      handlePlaySong(song);
      return;
    }

    const isShuff = socketObj.isShuffle;
    const currentPool = isShuff
      ? (socketObj.shuffledQueue.length > 0 ? [...socketObj.shuffledQueue] : (activeQueue.length > 0 ? [...activeQueue] : [...songs]))
      : (activeQueue.length > 0 ? [...activeQueue] : [...songs]);

    let curIdx = currentPool.findIndex(s => s.id === currentSong.id);
    if (curIdx === -1) {
      currentPool.unshift(currentSong);
      curIdx = 0;
    }

    const filtered = currentPool.filter((s, idx) => idx === curIdx || s.id !== song.id);
    curIdx = filtered.findIndex(s => s.id === currentSong.id);

    // Determinamos si estamos en pestañas generales o búsqueda:
    // General Library ('all'), Liked Tracks ('liked'), Offline Tracks ('offline'),
    // perfil de artista o búsqueda activa. NO en playlists personalizadas ni álbumes cerrados.
    const isCustomPlaylist = activePlaylistId !== 'all' && activePlaylistId !== 'liked' && activePlaylistId !== 'offline' && !selectedAlbumName && !selectedArtistName;
    const isAlbum = Boolean(selectedAlbumName);
    const isSearching = Boolean(searchQuery.trim());
    const isGeneralTabOrSearch = isSearching || (!isCustomPlaylist && !isAlbum);

    let insertIdx: number;

    if (isGeneralTabOrSearch) {
      // En pestañas generales / búsqueda: no se va al final de los cientos de canciones
      // de la biblioteca, sino justo después del bloque de cola manual previa (o de reproducir siguiente).
      const manualSet = new Set(manualQueueIds);
      let target = curIdx + 1;
      while (target < filtered.length && manualSet.has(filtered[target].id)) {
        target++;
      }
      insertIdx = target;
      setManualQueueIds(prev => [...prev.filter(id => id !== song.id), song.id]);
    } else {
      // En playlists personalizadas o álbumes cerrados: al final de la lista correspondiente
      if (playbackContext === 'album' && contextAlbumName) {
        // Justo después del final del álbum (antes de las libraryTracks de relleno)
        let lastAlbumTrackIdx = -1;
        for (let i = curIdx; i < filtered.length; i++) {
          if (filtered[i].album === contextAlbumName) {
            lastAlbumTrackIdx = i;
          }
        }
        insertIdx = lastAlbumTrackIdx !== -1 ? lastAlbumTrackIdx + 1 : filtered.length;
      } else {
        insertIdx = filtered.length;
      }
    }

    filtered.splice(insertIdx, 0, song);

    setActiveQueue(filtered);
    if (isShuff) {
      socketObj.setShuffledQueue(filtered);
    }
    socketObj.emitCommand('update-queue', { queue: filtered });
  };

  const handleAddAlbumToQueue = (tracks: Song[]) => {
    if (!tracks || tracks.length === 0) return;
    if (!currentSong) {
      handlePlaySong(tracks[0], false, 0, false, tracks[0].album || null);
      if (tracks.length > 1) {
        setTimeout(() => {
          handleAddAlbumToQueue(tracks.slice(1));
        }, 50);
      }
      return;
    }

    const isShuff = socketObj.isShuffle;
    const currentPool = isShuff
      ? (socketObj.shuffledQueue.length > 0 ? [...socketObj.shuffledQueue] : (activeQueue.length > 0 ? [...activeQueue] : [...songs]))
      : (activeQueue.length > 0 ? [...activeQueue] : [...songs]);

    let curIdx = currentPool.findIndex(s => s.id === currentSong.id);
    if (curIdx === -1) {
      currentPool.unshift(currentSong);
      curIdx = 0;
    }

    const trackIdsToAdd = new Set(tracks.map(t => t.id));
    const filtered = currentPool.filter((s, idx) => idx === curIdx || !trackIdsToAdd.has(s.id));
    curIdx = filtered.findIndex(s => s.id === currentSong.id);

    const manualSet = new Set(manualQueueIds);
    let target = curIdx + 1;
    while (target < filtered.length && manualSet.has(filtered[target].id)) {
      target++;
    }

    if (target === curIdx + 1 && playbackContext === 'album' && contextAlbumName) {
      let lastAlbumTrackIdx = -1;
      for (let i = curIdx; i < filtered.length; i++) {
        if (filtered[i].album === contextAlbumName) {
          lastAlbumTrackIdx = i;
        }
      }
      if (lastAlbumTrackIdx !== -1) {
        target = lastAlbumTrackIdx + 1;
      }
    }

    filtered.splice(target, 0, ...tracks);

    const addedIds = tracks.map(t => t.id);
    setManualQueueIds(prev => [...prev.filter(id => !trackIdsToAdd.has(id)), ...addedIds]);

    setActiveQueue(filtered);
    if (isShuff) {
      socketObj.setShuffledQueue(filtered);
    }
    socketObj.emitCommand('update-queue', { queue: filtered });
  };

  const handleReorderQueue = (newQueue: Song[]) => {
    setActiveQueue(newQueue);
    if (socketObj.isShuffle) socketObj.setShuffledQueue(newQueue);
    socketObj.emitCommand('update-queue', { queue: newQueue });
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

  const handlePurgeCovers = async () => {
    if (!isDesktop) {
      if (!window.confirm("⚠️ WARNING: This is a destructive operation. It will normalize all album covers and permanently delete redundant files from the server. Are you sure?")) {
        return;
      }
    }

    setIsPurging(true);
    setPurgeStats(null);

    try {
      const activeToken = token || localStorage.getItem('aura_token');
      const res = await fetch(`${API_BASE}/api/admin/purge-album-covers`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to purge covers");
      }

      const data = await res.json();
      setPurgeStats({
        albums: data.albumsProcessed,
        tracks: data.tracksUpdated,
        files: data.filesDeleted
      });

      const msg = `✅ Purge Complete!\n\nAlbums Processed: ${data.albumsProcessed}\nTracks Updated: ${data.tracksUpdated}\nFiles Deleted: ${data.filesDeleted}`;

      if (isDesktop) {
        console.log(msg);
      } else {
        alert(msg);
      }

      loadContent();
    } finally {
      setIsPurging(false);
    }
  };

  const isPlaylistOwner = (playlist: any) => {
    if (!playlist) return false;
    if (playlist.is_owner !== undefined) return Boolean(playlist.is_owner);
    const myId = String(user?.userId ?? user?.id ?? '');
    return !playlist.owner_id || String(playlist.owner_id) === myId;
  };

  const isPlaylistCollaborator = (playlist: any) => {
    if (!playlist) return false;
    return Boolean(playlist.is_collaborator);
  };

  const canEditPlaylistContent = (playlist: any) => {
    if (!playlist) return false;
    return isPlaylistOwner(playlist) || isPlaylistCollaborator(playlist);
  };

  const fetchCollaborators = async (playlistId: string | number) => {
    const activeToken = token || localStorage.getItem('aura_token');
    setIsLoadingCollaborators(true);
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/collaborators`, {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCollaboratorsList(data);
      }
    } catch (err) {
      console.error("Error fetching collaborators:", err);
    } finally {
      setIsLoadingCollaborators(false);
    }
  };

  const handleOpenCreatePlaylist = () => {
    setEditingPlaylist(null);
    setNewPlaylistName("");
    setNewPlaylistDescription("");
    setPlaylistCoverFile(null);
    setPlaylistCoverPreview(null);
    setPlaylistRemoveCover(false);
    setNewPlaylistIsCollaborative(false);
    setCollaboratorsList([]);
    setCopiedInvite(false);
    setIsCreatePlaylistOpen(true);
  };

  const handleSharePlaylistInvite = async (playlist: any) => {
    if (!playlist) return;
    let code = playlist.invite_code;
    if (!code || code === 'null' || code === 'undefined') {
      try {
        const activeToken = token || localStorage.getItem('aura_token');
        const res = await fetch(`${API_BASE}/api/playlists/${playlist.id}/invite-code`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          code = data.invite_code;
          setPlaylists(prev => prev.map(p => String(p.id) === String(playlist.id) ? { ...p, invite_code: code, is_collaborative: 1 } : p));
        }
      } catch (e) {
        console.error("Error generating invite code on share:", e);
      }
    }
    if (!code || code === 'null' || code === 'undefined') {
      alert("No se ha podido generar el enlace de invitación. Inténtalo de nuevo.");
      return;
    }
    const inviteUrl = `${window.location.origin}/?playlist_invite=${code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      alert("¡Enlace de invitación copiado al portapapeles!\n" + inviteUrl);
    } catch {
      prompt("Copia este enlace de invitación:", inviteUrl);
    }
  };

  const handleOpenEditPlaylist = async (playlist: any) => {
    if (!isPlaylistOwner(playlist)) {
      alert("No puedes editar la configuración de la playlist de otro usuario.");
      return;
    }
    let currentPl = playlist;
    const isCollab = Boolean(playlist.is_collaborative);
    setEditingPlaylist(playlist);
    setNewPlaylistName(playlist.name || "");
    setNewPlaylistDescription(playlist.description || "");
    setPlaylistCoverFile(null);
    setPlaylistCoverPreview(playlist.cover_path ? (resolveApiUrl(playlist.cover_path) || null) : null);
    setPlaylistRemoveCover(false);
    setNewPlaylistIsCollaborative(isCollab);
    setCopiedInvite(false);
    setIsCreatePlaylistOpen(true);

    if (isCollab) {
      fetchCollaborators(playlist.id);
      if (!playlist.invite_code || playlist.invite_code === 'null') {
        const activeToken = token || localStorage.getItem('aura_token');
        try {
          const res = await fetch(`${API_BASE}/api/playlists/${playlist.id}/invite-code`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${activeToken}` }
          });
          if (res.ok) {
            const data = await res.json();
            setEditingPlaylist((prev: any) => prev ? { ...prev, invite_code: data.invite_code, is_collaborative: 1 } : prev);
            setPlaylists(prev => prev.map(p => String(p.id) === String(playlist.id) ? { ...p, invite_code: data.invite_code, is_collaborative: 1 } : p));
          }
        } catch (err) {
          console.error("Error loading invite code on edit:", err);
        }
      }
    } else {
      setCollaboratorsList([]);
    }
  };

  const handleRegenerateInviteCode = async (playlistId: string | number) => {
    if (!confirm("¿Regenerar el enlace de invitación? El enlace anterior dejará de funcionar.")) return;
    const activeToken = token || localStorage.getItem('aura_token');
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/invite-code`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEditingPlaylist((prev: any) => prev ? { ...prev, invite_code: data.invite_code, is_collaborative: 1 } : prev);
        setPlaylists(prev => prev.map(p => String(p.id) === String(playlistId) ? { ...p, invite_code: data.invite_code, is_collaborative: 1 } : p));
        await loadPlaylists();
      }
    } catch (err) {
      console.error("Error regenerating invite code:", err);
    }
  };

  const handleRemoveCollaborator = async (playlistId: string | number, targetUserId: string | number) => {
    const activeToken = token || localStorage.getItem('aura_token');
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/collaborators/${targetUserId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        setCollaboratorsList(prev => prev.filter(c => String(c.id) !== String(targetUserId)));
        await loadPlaylists();
      }
    } catch (err) {
      console.error("Error removing collaborator:", err);
    }
  };

  const handleLeavePlaylist = async (playlist: any) => {
    if (!confirm(`¿Seguro que quieres dejar de colaborar en "${playlist.name}"?`)) return;
    const myId = user?.userId ?? user?.id;
    const activeToken = token || localStorage.getItem('aura_token');
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlist.id}/collaborators/${myId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        if (activePlaylistId === String(playlist.id)) {
          setActivePlaylistId('all');
        }
        await loadPlaylists();
        await loadContent();
      }
    } catch (err) {
      console.error("Error leaving playlist:", err);
    }
  };

  const handleJoinPlaylistByCode = async (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    const activeToken = token || localStorage.getItem('aura_token');
    setIsJoiningPlaylist(true);
    try {
      const res = await fetch(`${API_BASE}/api/playlists/join/${encodeURIComponent(cleanCode)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsJoinPlaylistModalOpen(false);
        setManualJoinCode("");
        await loadPlaylists();
        setActivePlaylistId(String(data.playlistId));
        setShowModeration(false);
        setSelectedAlbumName(null);
        setSelectedArtistName(null);
        alert(data.message || `Te has unido a "${data.name}"`);
      } else {
        alert(data.error || "No se ha podido unir a la playlist.");
      }
    } catch (err) {
      console.error("Error joining playlist:", err);
      alert("Error de conexión al unirse a la playlist.");
    } finally {
      setIsJoiningPlaylist(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('playlist_invite') || params.get('invite');
    if (!inviteCode) return;
    if (playlistInviteHandledRef.current === inviteCode) return;

    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    playlistInviteHandledRef.current = inviteCode;
    params.delete('playlist_invite');
    params.delete('invite');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));

    void handleJoinPlaylistByCode(inviteCode);
  }, [user]);

  const handleSavePlaylistModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const activeToken = token || localStorage.getItem('aura_token');
    setIsSavingPlaylist(true);

    try {
      const formData = new FormData();
      formData.append('name', newPlaylistName.trim());
      formData.append('description', newPlaylistDescription.trim());
      formData.append('is_collaborative', String(newPlaylistIsCollaborative));
      if (playlistCoverFile) {
        formData.append('cover', playlistCoverFile);
      }
      if (editingPlaylist && playlistRemoveCover) {
        formData.append('removeCover', 'true');
      }

      if (editingPlaylist) {
        const res = await fetch(`${API_BASE}/api/playlists/${editingPlaylist.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${activeToken}`
          },
          body: formData
        });
        if (res.ok) {
          setIsCreatePlaylistOpen(false);
          setEditingPlaylist(null);
          await loadPlaylists();
          await loadContent();
        } else {
          alert('Error al actualizar la playlist.');
        }
      } else {
        const res = await fetch(`${API_BASE}/api/playlists`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${activeToken}`
          },
          body: formData
        });
        if (res.ok) {
          setIsCreatePlaylistOpen(false);
          setNewPlaylistName("");
          setNewPlaylistDescription("");
          setPlaylistCoverFile(null);
          setPlaylistCoverPreview(null);
          setNewPlaylistIsCollaborative(false);
          await loadPlaylists();
        } else {
          alert('Error al crear la playlist.');
        }
      }
    } catch (err) {
      console.error("Error saving playlist:", err);
      alert('Error de conexión al guardar la playlist.');
    } finally {
      setIsSavingPlaylist(false);
    }
  };

  const handleCreatePlaylist = handleSavePlaylistModal;

  const handleDeletePlaylist = async (playlistId: string | number) => {
    const pl = playlists.find(p => String(p.id) === String(playlistId));
    if (pl && !isPlaylistOwner(pl)) {
      if (pl.is_collaborative) {
        return handleLeavePlaylist(pl);
      }
      alert("No puedes eliminar la playlist de otro usuario.");
      return;
    }
    if (!confirm("¿Eliminar esta playlist?")) return;
    const activeToken = token || localStorage.getItem('aura_token');
    await fetch(`${API_BASE}/api/playlists/${playlistId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activeToken}` } });
    if (activePlaylistId === playlistId.toString()) setActivePlaylistId("all");
    try { await removePlaylistOffline(playlistId); } catch {}
    loadPlaylists();
  };

  const handleRemoveFromPlaylist = async (songId: string) => {
    const currentPl = playlists.find(p => String(p.id) === String(activePlaylistId));
    if (currentPl && !canEditPlaylistContent(currentPl)) {
      alert("No tienes permiso para modificar esta playlist.");
      return;
    }
    const activeToken = token || localStorage.getItem('aura_token');
    await fetch(`${API_BASE}/api/playlists/${activePlaylistId}/tracks/${songId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activeToken}` } });
    loadContent();
  };

  const confirmDeleteTrack = async () => {
    if (!trackToDelete) return;
    const activeToken = token || localStorage.getItem('aura_token');
    try {
      const res = await fetch(`${API_BASE}/api/tracks/${trackToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        setTrackToDelete(null);
        loadContent();
      } else {
        alert("Failed to delete track.");
      }
    } catch (err) {
      console.error("Error deleting track:", err);
      alert("An error occurred while deleting the track.");
    }
  };

  const handleReorderPlaylist = async (newOrder: Song[]) => {
    if (activePlaylistId === 'all' || activePlaylistId === 'liked' || activePlaylistId === 'offline') return;
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
    if (isPlaylistOffline(playlistId)) {
      const songObj = songs.find(s => String(s.id) === String(songId));
      if (songObj) {
        void downloadSongOffline(songObj);
      }
    }
  };

  // --- TODOS LOS ÁLBUMES DE LA BIBLIOTECA ---
  const allAlbums = useMemo(() => {
    const map = new Map<string, {
      title: string;
      artist: string;
      coverUrl: string;
      trackCount: number;
      tracks: Song[];
      formats: Set<string>;
    }>();

    songs.forEach(s => {
      if (!s.album || !s.album.trim()) return;
      const albumKey = s.album.trim();
      if (!map.has(albumKey)) {
        map.set(albumKey, {
          title: albumKey,
          artist: s.artist || 'Artista Desconocido',
          coverUrl: s.coverUrl,
          trackCount: 0,
          tracks: [],
          formats: new Set<string>()
        });
      }
      const item = map.get(albumKey)!;
      item.tracks.push(s);
      item.trackCount++;
      if (s.format) item.formats.add(s.format.toUpperCase());
      if ((!item.coverUrl || item.coverUrl.includes('default-cover') || item.coverUrl.includes('default_cover')) && s.coverUrl) {
        item.coverUrl = s.coverUrl;
      }
    });

    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [songs]);

  // --- TODOS LOS ARTISTAS DE LA BIBLIOTECA ---
  const allArtists = useMemo(() => {
    const map = new Map<string, {
      name: string;
      coverUrl: string;
      trackCount: number;
      albumCount: number;
    }>();

    songs.forEach(song => {
      const artists = parseArtists(song.artist);
      artists.forEach(artistName => {
        if (!map.has(artistName)) {
          map.set(artistName, {
            name: artistName,
            coverUrl: artistsMap[artistName]?.image_url || song.coverUrl,
            trackCount: 0,
            albumCount: 0
          });
        }
      });
    });

    map.forEach((entry, artistName) => {
      const artistTracks = songs.filter(s => parseArtists(s.artist).includes(artistName));
      const albums = new Set(artistTracks.map(s => s.album).filter(Boolean));
      entry.trackCount = artistTracks.length;
      entry.albumCount = albums.size;
      if (artistsMap[artistName]?.image_url) {
        entry.coverUrl = artistsMap[artistName]?.image_url;
      } else if (!entry.coverUrl && artistTracks[0]?.coverUrl) {
        entry.coverUrl = artistTracks[0].coverUrl;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.trackCount - a.trackCount);
  }, [songs, artistsMap]);

  // ÍNDICES DIFUSOS CON FUSE.JS (BÚSQUEDA INSTANTÁNEA EN MEMORIA)
  const songFuse = useSongFuseIndex(songs);
  const albumFuse = useAlbumFuseIndex(allAlbums);
  const artistFuse = useArtistFuseIndex(allArtists);

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

    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked' && activePlaylistId !== 'offline') {
      return songs.filter(s => formatFilter === 'all' || s.format === formatFilter);
    }

    let list = songs.filter(
      s => formatFilter === 'all' || s.format === formatFilter
    );

    if (searchQuery.trim().length > 0) {
      list = searchSongsWithFuse(songFuse, searchQuery, list);
    }

    if (activePlaylistId === 'liked') {
      list = list.filter(s => likedIds.includes(s.id));
    } else if (activePlaylistId === 'offline') {
      list = list.filter(s => offlineIds.has(String(s.id)));
    }

    // Si el usuario está buscando y el orden es por defecto, conservar la relevancia calculada por Fuse
    if (!searchQuery.trim() || sortBy !== 'first') {
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
    }

    return list;
  }, [songs, formatFilter, searchQuery, activePlaylistId, likedIds, offlineIds, selectedAlbumName, selectedArtistName, sortBy, songFuse]);

  // ELEMENTOS PARA LA CUADRÍCULA
  const displayItems = useMemo(() => {
    const list = flattenedSongs;

    if (activePlaylistId !== 'all' && activePlaylistId !== 'liked') return list;
    if (selectedAlbumName || selectedArtistName) return list;

    const items: any[] = [];
    const q = searchQuery.trim();

    // 1. SI HAY BÚSQUEDA ACTIVA: incluir tarjetas de artistas y álbumes relevantes al inicio
    if (q.length > 0) {
      const matchingArtists = searchArtistsWithFuse(artistFuse, q, allArtists);
      const matchingAlbums = searchAlbumsWithFuse(albumFuse, q, allAlbums);

      // Mostrar hasta los mejores 4 artistas coincidentes
      matchingArtists.slice(0, 4).forEach(art => {
        items.push({
          id: `artist-${art.name}`,
          type: 'artist',
          title: art.name,
          artist: 'Artista Oficial',
          coverUrl: art.coverUrl,
          trackCount: art.trackCount,
          albumCount: art.albumCount
        });
      });

      // Mostrar hasta los mejores 4 álbumes coincidentes
      matchingAlbums.slice(0, 4).forEach(alb => {
        items.push({
          id: `album-${alb.title}`,
          type: 'album',
          title: alb.title,
          artist: alb.artist,
          coverUrl: alb.coverUrl,
          trackCount: alb.trackCount
        });
      });

      // Añadir canciones coincidentes ordenadas por relevancia Fuse
      list.forEach(song => {
        items.push(song);
      });

      return items;
    }

    // 2. MODO BIBLIOTECA NORMAL (SIN BÚSQUEDA)
    const groupedAlbums = new Set<string>();
    list.forEach(song => {
      if (song.album && !groupedAlbums.has(song.album)) {
        const allAlbumTracks = songs.filter(s => s.album === song.album);
        if (allAlbumTracks.length > 1) {
          items.push({
            id: `album-${song.album}`,
            type: 'album',
            title: song.album,
            artist: song.artist,
            coverUrl: song.coverUrl,
            trackCount: allAlbumTracks.length
          });
          groupedAlbums.add(song.album);
        } else {
          items.push(song);
        }
      } else if (!song.album) {
        items.push(song);
      }
    });

    return items;
  }, [flattenedSongs, songs, allArtists, allAlbums, artistFuse, albumFuse, activePlaylistId, selectedAlbumName, selectedArtistName, searchQuery]);

  // RENDERIZADO PROGRESIVO DE TARJETAS Y MEMORIA DE SCROLL
  const [renderedCount, setRenderedCount] = useState(48);
  const renderedCountRef = useRef(renderedCount);
  useEffect(() => {
    renderedCountRef.current = renderedCount;
  }, [renderedCount]);

  const scrollPositionsRef = useRef<Map<string, { scrollTop: number; renderedCount: number }>>(new Map());
  const isNavigatingRef = useRef(false);

  const currentViewKey = useMemo(() => {
    return getViewKey(selectedAlbumName, selectedArtistName, activePlaylistId, librarySection, searchQuery);
  }, [selectedAlbumName, selectedArtistName, activePlaylistId, librarySection, searchQuery]);

  const currentViewKeyRef = useRef(currentViewKey);
  const previousViewKeyRef = useRef(currentViewKey);

  // Antes del desmontaje del DOM durante el render, si la clave de vista cambió,
  // guardamos la posición exacta de scroll de la vista previa y activamos
  // isNavigatingRef para evitar que el colapso del DOM sobreescriba la posición con 0.
  if (currentViewKey !== previousViewKeyRef.current && !isNavigatingRef.current) {
    isNavigatingRef.current = true;
    if (mainRef.current) {
      scrollPositionsRef.current.set(previousViewKeyRef.current, {
        scrollTop: mainRef.current.scrollTop,
        renderedCount: renderedCountRef.current,
      });
    }
  }

  // Restauración de scroll y renderedCount cuando cambia la vista activa
  useLayoutEffect(() => {
    const prevKey = previousViewKeyRef.current;
    const newKey = currentViewKey;

    previousViewKeyRef.current = newKey;
    currentViewKeyRef.current = newKey;

    if (prevKey === newKey && !isNavigatingRef.current) return;

    isNavigatingRef.current = true;

    const saved = scrollPositionsRef.current.get(newKey);
    const targetScroll = saved ? saved.scrollTop : 0;
    const targetRendered = saved ? Math.max(48, saved.renderedCount) : 48;

    if (targetRendered !== renderedCountRef.current) {
      setRenderedCount(targetRendered);
    }

    const applyScroll = () => {
      if (mainRef.current) {
        if (Math.abs(mainRef.current.scrollTop - targetScroll) > 2) {
          mainRef.current.scrollTop = targetScroll;
        }
      }
    };

    applyScroll();

    let frameId1: number;
    let frameId2: number;
    let timerId: ReturnType<typeof setTimeout>;

    frameId1 = requestAnimationFrame(() => {
      applyScroll();
      frameId2 = requestAnimationFrame(() => {
        applyScroll();
        isNavigatingRef.current = false;
      });
    });

    timerId = setTimeout(() => {
      applyScroll();
      isNavigatingRef.current = false;
    }, 120);

    return () => {
      cancelAnimationFrame(frameId1);
      cancelAnimationFrame(frameId2);
      clearTimeout(timerId);
    };
  }, [currentViewKey]);

  // Si cambia el ordenamiento (sortBy), resetear la memoria de scroll de la biblioteca
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    const key = currentViewKeyRef.current;
    if (key.startsWith('lib:')) {
      scrollPositionsRef.current.delete(key);
    }
  }, [sortBy]);

  const handleMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const target = e.currentTarget;

    // Solo guardamos si el usuario está scrolleando activamente (no en transición)
    if (!isNavigatingRef.current) {
      const key = currentViewKeyRef.current;
      scrollPositionsRef.current.set(key, {
        scrollTop: target.scrollTop,
        renderedCount: renderedCountRef.current,
      });
    }

    if (target.scrollHeight - target.scrollTop - target.clientHeight < 900) {
      setRenderedCount(prev => (prev < displayItems.length ? prev + 36 : prev));
    }
  }, [displayItems.length]);

  // PRECARGA DE LAS PRIMERAS CARÁTULAS DE LA REJILLA (solo una vez, al
  // arrancar la app) usando displayItems — el mismo array, en el mismo
  // orden, que se usa para pintar las tarjetas — para que lo que se
  // precarga sea EXACTAMENTE lo primero que el usuario va a ver, tanto si
  // son canciones sueltas como tarjetas de álbum/artista agrupadas.
  useEffect(() => {
    if (gridPreloadedRef.current) return;
    if (isLoading) return; // el primer intento de carga aún no ha terminado

    gridPreloadedRef.current = true;

    const GRID_PRELOAD_COUNT = 16;
    Promise.allSettled(
      displayItems.slice(0, GRID_PRELOAD_COUNT).map((item: any) =>
        resolveFileUrl(item.coverUrl).then((url) => {
          const thumb = getThumbnailUrl(url, 300) || url;
          return preloadImage(thumb);
        })
      )
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

  // ÁLBUMES FILTRADOS POR BÚSQUEDA Y FORMATO
  const filteredAlbums = useMemo(() => {
    let list = allAlbums;
    if (formatFilter !== 'all') {
      list = list.filter(alb => alb.tracks.some(t => t.format === formatFilter));
    }
    if (searchQuery.trim().length > 0) {
      list = searchAlbumsWithFuse(albumFuse, searchQuery, list);
    }
    return list;
  }, [allAlbums, searchQuery, formatFilter, albumFuse]);

  // ARTISTAS FILTRADOS POR BÚSQUEDA
  const filteredArtists = useMemo(() => {
    if (!searchQuery.trim()) return allArtists;
    return searchArtistsWithFuse(artistFuse, searchQuery, allArtists);
  }, [allArtists, searchQuery, artistFuse]);

  const getFlattenedSongs = () => flattenedSongs;

  const canReorderPlaylist =
      activePlaylistId !== 'all' &&
      activePlaylistId !== 'liked' &&
      activePlaylistId !== 'offline' &&
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

  const getNextTrackInfo = useCallback((): { song: Song; resolveUrl: () => Promise<string | undefined> } | null => {
    if (socketObj.isLoop) return null;
    const pool = socketObj.isShuffle
      ? socketObj.shuffledQueue
      : (activeQueue.length > 0 ? activeQueue : flattenedSongs);
    if (pool.length === 0 || !currentSong) return null;

    const currentIndex = pool.findIndex((s) => s.id === currentSong.id);
    const isAutoplay = audioSettings.autoplay?.enabled ?? true;
    const isAtEnd = currentIndex >= pool.length - 1;

    if (isAtEnd) {
      if (isAutoplay) {
        const radioTracks = generateRadioTracks(currentSong, pool);
        if (radioTracks.length > 0) {
          const nextSong = radioTracks[0];
          return {
            song: nextSong,
            resolveUrl: () => resolveFileUrl(nextSong.audioUrl),
          };
        }
      }
      if (playbackContext === 'playlist') return null;
    }

    const nextSong = currentIndex === -1 ? pool[0] : pool[(currentIndex + 1) % pool.length];
    if (!nextSong || nextSong.id === currentSong.id) return null;

    return {
      song: nextSong,
      resolveUrl: () => resolveFileUrl(nextSong.audioUrl),
    };
  }, [socketObj.isShuffle, socketObj.shuffledQueue, socketObj.isLoop, activeQueue, flattenedSongs, currentSong, audioSettings.autoplay?.enabled, generateRadioTracks, playbackContext]);

  getNextTrackInfoRef.current = getNextTrackInfo;

  const handleGaplessNext = useCallback((nextSong: Song) => {
    if (!nextSong) return;
    if (socketObj.isLoop) return;
    if (socketObj.currentSession && !socketObj.isLeader()) return;

    setCurrentSong(nextSong);
    setIsPlaying(true);
    socketObj.setTrackId(nextSong.id);

    try {
      localStorage.setItem('aura_last_song', JSON.stringify(nextSong));
    } catch (e) {}

    setRecentlyPlayed(prev => {
      const nextRecent = [nextSong, ...prev.filter(s => s.id !== nextSong.id)].slice(0, 4);
      try {
        localStorage.setItem('aura_recent', JSON.stringify(nextRecent));
      } catch (e) {}
      return nextRecent;
    });

    setManualQueueIds(prev => prev.filter(id => id !== nextSong.id));
    setRadioQueueIds(prev => {
      if (!prev.has(nextSong.id)) return prev;
      const next = new Set(prev);
      next.delete(nextSong.id);
      return next;
    });

    const activeToken = token || localStorage.getItem('aura_token');
    if (activeToken) {
      fetch(`${API_BASE}/api/users/me/last-track`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ trackId: nextSong.id })
      }).catch(error => console.error("ERROR GUARDANDO LAST TRACK EN SERVIDOR:", error));
    }

    socketObj.emitCommand('play-track', {
      id: nextSong.id,
      song: nextSong,
      queue: activeQueue,
      position: 0
    });
  }, [socketObj, token, activeQueue]);

  handleGaplessNextRef.current = handleGaplessNext;

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
      audioObj.seek(seconds);
    },
    isNativePlatform: Capacitor.isNativePlatform(),
    playbackRate: audioSettings.playbackRate?.rate ?? 1.0,
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
          handleNextRef.current();
        }
      );

      const previousListener = await AuraMedia.addListener(
        'previous',
        () => {
          handlePreviousRef.current();
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

          audioObj.seek(positionMs / 1000);
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
}, []);

const lastNativeTrackSentRef = useRef<{ id: string; durationMs: number } | null>(null);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  const songIdStr = String(currentSong.id);
  const isNewTrackForNative = lastNativeTrackSentRef.current?.id !== songIdStr;

  const effectiveDur = isNewTrackForNative
    ? (currentSong.duration && currentSong.duration > 0 ? currentSong.duration : (Number.isFinite(audioObj.duration) && audioObj.duration > 0 ? audioObj.duration : 0))
    : (Number.isFinite(audioObj.duration) && audioObj.duration > 0 ? audioObj.duration : (currentSong.duration || 0));

  const durationMs = Math.max(
    0,
    Math.round(effectiveDur * 1000)
  );

  if (
    !isNewTrackForNative &&
    Math.abs(lastNativeTrackSentRef.current.durationMs - durationMs) < 1000
  ) {
    return;
  }
  lastNativeTrackSentRef.current = { id: songIdStr, durationMs };

  const artworkUrl = currentSong.coverUrl || undefined;
  AuraMedia.setTrack({
    id: songIdStr,
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
  currentSong?.duration,
  audioObj.duration
]);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  const currentPosMs = Math.max(0, Math.round(audioObj.getCurrentTime() * 1000));
  AuraMedia.setPosition({ positionMs: currentPosMs }).catch(() => {});
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
  if (!Capacitor.isNativePlatform()) return;
  const speed = audioSettings.playbackRate?.rate ?? 1.0;
  AuraMedia.setPlaybackSpeed?.({ speed }).catch(() => {});
}, [audioSettings.playbackRate?.rate]);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!currentSong) {
    return;
  }

  let lastSentPosMs = -1;
  let lastSentWallMs = 0;

  const syncPosition = () => {
    const currentTime = audioObj.getCurrentTime();
    const positionMs = Math.max(0, Math.round(currentTime * 1000));
    const now = performance.now();
    const speed = audioSettings.playbackRate?.rate ?? 1.0;

    if (lastSentPosMs >= 0) {
      const elapsedWallMs = now - lastSentWallMs;
      const expectedPosMs = lastSentPosMs + Math.round(elapsedWallMs * speed);
      const isSeekJump = Math.abs(positionMs - expectedPosMs) > 1500;
      if (isSeekJump && elapsedWallMs < 150) {
        return;
      }
      if (!isSeekJump && elapsedWallMs < 15000) {
        return;
      }
    }

    lastSentPosMs = positionMs;
    lastSentWallMs = now;

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
      {/* Barra superior de escritorio integrada con el fondo */}

      {isDesktop && createPortal(
        <div 
          className={`h-8 border-b flex items-center justify-between pl-3 pr-0 select-none z-50 shrink-0 backdrop-blur-md transition-colors duration-1000 fixed top-0 left-0 right-0 ${
            activeTheme === 'light' 
              ? 'border-black/5 bg-white/80 text-black' 
              : 'border-white/10 bg-black/70 text-white'
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
              aria-label="Minimizar"
              title="Minimizar"
              className={`w-9 h-8 flex items-center justify-center transition-colors cursor-pointer outline-none ${
                activeTheme === 'light' ? 'hover:bg-black/5 text-black/50 hover:text-black' : 'hover:bg-white/10 text-white/50 hover:text-white'
              }`}
            >
              <Minus size={14} strokeWidth={1.75} />
            </button>
            <button 
              type="button" 
              onClick={handleMaximize} 
              aria-label={isWindowMaximized ? "Restaurar" : "Maximizar"}
              title={isWindowMaximized ? "Restaurar" : "Maximizar"}
              className={`w-9 h-8 flex items-center justify-center transition-colors cursor-pointer outline-none ${
                activeTheme === 'light' ? 'hover:bg-black/5 text-black/50 hover:text-black' : 'hover:bg-white/10 text-white/50 hover:text-white'
              }`}
            >
              {isWindowMaximized ? (
                <Copy size={12} strokeWidth={1.75} className="-scale-x-100" />
              ) : (
                <Square size={11} strokeWidth={1.75} />
              )}
            </button>
            <button 
              type="button" 
              onClick={handleClose} 
              aria-label="Cerrar"
              title="Cerrar"
              className={`w-9 h-8 flex items-center justify-center transition-colors cursor-pointer outline-none ${
                activeTheme === 'light' ? 'text-black/50 hover:text-white hover:bg-red-600' : 'text-white/50 hover:text-white hover:bg-red-600/90'
              }`}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Reserva el hueco de la barra de escritorio en el flujo normal,
          ya que ahora la barra en sí vive en un portal fuera de aquí */}
      {isDesktop && <div className="h-8 shrink-0" />}

      {/* Hidden Minigame Engine */}
      <audio 
        ref={minigameAudioRef} 
        src={resolvedMinigameAudioUrl || undefined} 
        crossOrigin="anonymous" 
        onTimeUpdate={(e) => setMinigameTime(e.currentTarget.currentTime)}
        onPlay={() => setIsMinigamePlaying(true)}
        onPause={() => setIsMinigamePlaying(false)}
      />
      
      <Background color={getThemeBg()} />
      {activeTheme === 'custom' && resolvedCustomBg && (
          <div className="absolute inset-0 pointer-events-none transition-opacity duration-1000 z-[1]" style={{ backgroundImage: `url(${resolvedCustomBg})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: bgOpacity / 100 }} />
      )}

      <AnimatePresence>
        {isSocialHubOpen && (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <LazySocialOverlay onClose={() => setIsSocialHubOpen(false)} user={user} token={token} socket={socketObj.socketRef.current} currentSession={socketObj.currentSession} />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>

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
  className={`fixed left-0 right-0 flex items-center justify-between px-4 md:px-8 pt-[env(safe-area-inset-top)] z-20 backdrop-blur-md transition-all duration-1000 md:border-b ${
    isDesktop ? 'top-8 min-h-[4.5rem]' : 'top-0 min-h-[5.5rem]'
  } ${
    activeTheme === 'light'
      ? 'md:border-black/5 bg-white/60'
      : 'md:border-white/10 bg-black/40'
  }`}
>
            <div className="flex items-center gap-4 md:gap-12 flex-1">
              <span className="text-lg md:text-xl font-bold tracking-tighter uppercase cursor-pointer shrink-0" onClick={() => {
                if (!showModeration && activePlaylistId === "all" && !selectedAlbumName && !selectedArtistName) {
                  mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                  setShowModeration(false);
                  setActivePlaylistId("all");
                  setSelectedAlbumName(null);
                  setSelectedArtistName(null);
                }
              }}>AURA<span className="text-brand-primary">.</span></span>
              <div className={`hidden lg:flex gap-8 text-[10px] font-bold uppercase`}>
                <button onClick={() => {
                  if (!showModeration && activePlaylistId === "all" && !selectedAlbumName && !selectedArtistName) {
                    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  } else {
                    setShowModeration(false);
                    setActivePlaylistId("all");
                    setSelectedAlbumName(null);
                    setSelectedArtistName(null);
                  }
                }} className={`transition-colors ${!showModeration && activePlaylistId === "all" ? (activeTheme === 'light' ? 'text-black border-b border-brand-primary' : 'text-white border-b border-brand-primary pb-1') : ""}`}>Library</button>
                {(userRole === "admin" || userRole === "moderator") && <button onClick={() => setShowModeration(true)} className={`flex items-center gap-2 transition-colors ${showModeration ? 'text-brand-primary border-b border-brand-primary pb-1' : 'text-white/40 hover:text-white'}`}><ShieldCheck size={12}/> Moderation</button>}
                <button onClick={() => setIsSessionOpen(true)} className={`flex items-center gap-2 transition-colors ${socketObj.currentSession ? 'text-brand-primary animate-pulse font-black' : 'text-white/40'}`}><Users size={12} /> Session</button>
                {token && <button onClick={() => setIsSocialHubOpen(true)} className="relative flex items-center gap-2 text-white/40 hover:text-white transition-colors cursor-pointer"><Users size={12} /> Social{socketObj.unreadSenders.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-xl" />}</button>}
              </div>
              <div className="flex-1 min-w-0 max-w-md ml-2 md:ml-8 relative -translate-x-[12px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSearchQuery('');
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-full py-1.5 pl-10 pr-8 text-[10px] md:text-[11px] outline-none text-white focus:bg-white/10 focus:border-brand-primary/40 transition-all placeholder:text-white/30"
                  placeholder="Buscar canciones, artistas, álbumes..."
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-white/40 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                    title="Borrar búsqueda (Esc)"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 md:gap-6">
              {token ? (
                <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
                  {/* AURA DJ BUTTON */}
                  {isAiEnabled && (
                  <button
                    onClick={() => setIsAuraDjOpen(true)}
                    className="relative overflow-hidden aura-dj-btn text-white px-2.5 sm:px-3.5 py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-all cursor-pointer ring-1 ring-inset ring-white/25"
                    title="Aura DJ con Gemini AI"
                  >
                    <Sparkles size={13} className="fill-white" />
                    <span>Aura DJ</span>
                  </button>
                  )}

                  {/* 1. UPLOAD BUTTON */}
                  <button
                    onClick={() => setShowUpload(true)}
                    className="bg-brand-primary text-black px-3 md:px-4 py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase flex items-center gap-2 hover:scale-105 transition-all cursor-pointer"
                  >
                    <Plus size={14}/>
                    <span className="hidden xs:inline">Upload</span>
                  </button>

                  {/* 2. DESKTOP OPTIONS MENU */}
                  <div className="relative hidden md:block">
                    <button
                      onClick={() => setIsDesktopMenuOpen(prev => !prev)}
                      title={isDesktopMenuOpen ? "Cerrar menú" : "Menú"}
                      aria-label={isDesktopMenuOpen ? "Cerrar menú" : "Menú"}
                      className={`relative p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer outline-none ${
                        isDesktopMenuOpen
                          ? 'text-brand-primary bg-brand-primary/10'
                          : sleepTimer.isActive
                            ? 'text-amber-300 bg-amber-400/10'
                            : activeTheme === 'light'
                              ? 'text-black/70 hover:text-black hover:bg-black/5'
                              : 'text-white/70 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <span className="flex transition-transform duration-150" style={{ transform: isDesktopMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                        {isDesktopMenuOpen ? <X size={20} /> : <Menu size={20} />}
                      </span>
                      {sleepTimer.isActive && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      )}
                    </button>

                    <AnimatePresence>
                      {isDesktopMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setIsDesktopMenuOpen(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -6 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            className="absolute right-0 top-full mt-2 w-72 rounded-2xl bg-[#161616]/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-2 z-50 text-left select-none overflow-y-auto max-h-[calc(100vh-5rem)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-3 py-2 border-b border-white/5 mb-1 flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Más opciones</span>
                              {sleepTimer.isActive && (
                                <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-400/15 px-1.5 py-0.5 rounded border border-amber-400/30">
                                  ⏱ {sleepTimerRemainingText}
                                </span>
                              )}
                            </div>

                            {/* Aura DJ */}
                            {isAiEnabled && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsDesktopMenuOpen(false);
                                setIsAuraDjOpen(true);
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-all text-left cursor-pointer group"
                            >
                              <div className="p-2 rounded-lg bg-brand-primary/15 text-brand-primary group-hover:bg-brand-primary/25 transition-colors">
                                <Sparkles size={16} className="fill-brand-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-white flex items-center gap-2">
                                  <span>Aura DJ (Gemini AI)</span>
                                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-brand-primary/20 text-brand-primary border border-brand-primary/30 font-bold">NUEVO</span>
                                </div>
                                <div className="text-[10px] text-white/40 truncate">
                                  Crea mezclas por lenguaje natural
                                </div>
                              </div>
                            </button>
                            )}

                            {/* Temporizador de apagado */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsDesktopMenuOpen(false);
                                setIsSleepTimerOpen(true);
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-all text-left cursor-pointer group"
                            >
                              <div className={`p-2 rounded-lg transition-colors ${
                                sleepTimer.isActive
                                  ? 'bg-amber-400/20 text-amber-300'
                                  : 'bg-white/5 text-white/60 group-hover:text-amber-300 group-hover:bg-amber-400/10'
                              }`}>
                                <Moon size={16} className={sleepTimer.isActive ? 'fill-amber-300' : ''} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-white flex items-center justify-between">
                                  <span>Temporizador de apagado</span>
                                  {sleepTimer.isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                                </div>
                                <div className="text-[10px] text-white/40 truncate">
                                  {sleepTimer.isActive ? `Apagado en ${sleepTimerRemainingText}` : 'Detener música al dormir'}
                                </div>
                              </div>
                            </button>

                            {/* Wrapped */}
                            {token && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsDesktopMenuOpen(false);
                                  setIsWrappedOpen(true);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-all text-left cursor-pointer group"
                              >
                                <div className="p-2 rounded-lg bg-white/5 text-white/60 group-hover:text-brand-primary group-hover:bg-brand-primary/10 transition-colors">
                                  <Sparkles size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-white">Aura Wrapped</div>
                                  <div className="text-[10px] text-white/40">Tus estadísticas de escucha</div>
                                </div>
                              </button>
                            )}


                            {/* Ajustes de Audio */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsDesktopMenuOpen(false);
                                setIsAudioSettingsOpen(true);
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-all text-left cursor-pointer group"
                            >
                              <div className="p-2 rounded-lg bg-white/5 text-white/60 group-hover:text-emerald-400 group-hover:bg-emerald-400/10 transition-colors">
                                <SlidersHorizontal size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-white">Ajustes de Audio</div>
                                <div className="text-[10px] text-white/40">Ecualizador y normalizador</div>
                              </div>
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* 2. LOGOUT BUTTON (Hidden on Mobile) */}
                  <button
                    onClick={handleLogout}
                    className={`hidden md:flex transition-colors cursor-pointer shrink-0 ${
                      activeTheme === 'light'
                        ? 'text-black/50 hover:text-red-500'
                        : 'text-white/40 hover:text-red-400'
                    }`}
                    title="Log out"
                  >
                    <LogOut size={18} strokeWidth={2} />
                  </button>

                  {/* 3. PROFILE PICTURE BUTTON (Hidden on Mobile) */}
                  <button
                    onClick={() => setIsProfileOpen(true)}
                    className={`hidden md:flex transition-colors cursor-pointer shrink-0 ${
                      activeTheme === 'light'
                        ? 'text-black/50 hover:text-brand-primary'
                        : 'text-white/40 hover:text-brand-primary'
                    }`}
                    title="Profile"
                  >
                    {resolvedProfilePic ? (
                      <img src={resolvedProfilePic} alt="Profile" className="w-7 h-7 rounded-full object-cover hover:scale-105 transition-transform" />
                    ) : (
                      <User size={18} strokeWidth={2} />
                    )}
                  </button>

                  {/* MOBILE MENU TOGGLE */}
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
        className={`fixed top-[5.25rem] left-3 right-3 max-h-[calc(100dvh-6.25rem-env(safe-area-inset-bottom,0px))] z-[9999] md:hidden rounded-2xl border shadow-2xl flex flex-col overflow-hidden will-change-transform ${
          activeTheme === "light"
            ? "bg-white border-black/10 text-black"
            : "bg-[#080808] border-white/10 text-white"
        }`}
      >

        {/* CABECERA */}
        <div
          className={`shrink-0 px-4 py-4 border-b ${
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-2 [touch-action:pan-y] [-webkit-overflow-scrolling:touch]">

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

          {/* OFFLINE TRACKS */}
          <button
            onClick={() => {
              setShowModeration(false);
              setActivePlaylistId("offline");
              setSelectedAlbumName(null);
              setSelectedArtistName(null);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:scale-[0.98] duration-150 ${
              activePlaylistId === "offline" && !showModeration
                ? "text-emerald-400 bg-emerald-500/10"
                : activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              activePlaylistId === "offline" && !showModeration
                ? "bg-emerald-500/15 text-emerald-400"
                : activeTheme === "light" ? "bg-black/5" : "bg-white/5"
            }`}>
              <Download size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                Offline Tracks ({offlineIds.size})
              </div>

              <div className="text-[10px] opacity-40">
                Available without internet
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

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setIsJoinPlaylistModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-6 h-6 rounded-full bg-white/10 text-white flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                  title="Unirse a playlist colaborativa"
                >
                  <UserPlus size={12} />
                </button>
                <button
                  onClick={() => {
                    handleOpenCreatePlaylist();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-6 h-6 rounded-full bg-brand-primary text-black flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                  title="Crear playlist"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto scrollbar-hide">

              {playlists.length === 0 ? (
                <button
                  onClick={() => {
                    handleOpenCreatePlaylist();
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
                        {p.cover_path ? (
                          <img 
                            src={getThumbnailUrl(resolveApiUrl(p.cover_path), 80)} 
                            alt="" 
                            className="w-5 h-5 rounded object-cover shrink-0 border border-white/10" 
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <Music2 size={13} className="shrink-0 opacity-50" />
                        )}
                        <span className="truncate">
                          {p.name}
                        </span>
                        {Boolean(p.is_collaborative) && (
                          <Users size={11} className="text-indigo-400 shrink-0" title={p.owner_name ? `Colaborativa · de ${p.owner_name}` : "Colaborativa"} />
                        )}
                        {offlinePlaylistIds.has(p.id.toString()) && (
                          <span title="Disponible sin conexión"><Download size={11} className="text-emerald-400 shrink-0 ml-auto" /></span>
                        )}
                      </div>
                    </button>

                    {isPlaylistOwner(p) ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMobileMenuOpen(false);
                            handleOpenEditPlaylist(p);
                          }}
                          className="p-2 rounded-md text-white/40 active:text-brand-primary transition-colors shrink-0"
                          aria-label={`Editar playlist ${p.name}`}
                          title="Editar playlist"
                        >
                          <Edit2 size={12} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePlaylist(p.id);
                          }}
                          className="mr-1.5 p-2 rounded-md text-red-500/50 active:text-red-500 active:bg-red-500/10 transition-colors shrink-0"
                          aria-label={`Delete playlist ${p.name}`}
                          title="Eliminar playlist"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      Boolean(p.is_collaborative) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLeavePlaylist(p);
                          }}
                          className="mr-1.5 p-2 rounded-md text-amber-400/50 active:text-amber-400 active:bg-amber-400/10 transition-colors shrink-0"
                          title="Dejar de colaborar"
                        >
                          <LogOut size={12} />
                        </button>
                      )
                    )}
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
                setIsSocialHubOpen(true);
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

          {/* SLEEP TIMER */}
          <button
            onClick={() => {
              setIsSleepTimerOpen(true);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
              activeTheme === "light"
                ? "hover:bg-black/5 active:bg-black/10"
                : "hover:bg-white/5 active:bg-white/10"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              sleepTimer.isActive
                ? "bg-amber-400/20 text-amber-300 border border-amber-400/30"
                : activeTheme === "light" ? "bg-black/5 text-black/70" : "bg-white/5 text-white/70"
            }`}>
              <Moon size={16} className={sleepTimer.isActive ? "fill-amber-300" : ""} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold flex items-center gap-2">
                Temporizador
                {sleepTimer.isActive && (
                  <span className="text-[10px] font-mono font-bold text-amber-300 px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30">
                    {sleepTimerRemainingText}
                  </span>
                )}
              </div>

              <div className="text-[10px] opacity-40">
                {sleepTimer.isActive ? 'Temporizador activo' : 'Apagado automático para dormir'}
              </div>
            </div>

            <ChevronRight size={15} className="opacity-20 shrink-0" />
          </button>

          {/* WRAPPED */}
          {token && (
            <button
              onClick={() => {
                setIsWrappedOpen(true);
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] duration-150 ${
                activeTheme === "light"
                  ? "hover:bg-black/5 active:bg-black/10"
                  : "hover:bg-white/5 active:bg-white/10"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTheme === "light" ? "bg-black/5" : "bg-white/5"}`}>
                <Sparkles size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Aura Wrapped
                </div>

                <div className="text-[10px] opacity-40">
                  Your listening stats
                </div>
              </div>

              <ChevronRight size={15} className="opacity-20 shrink-0" />
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
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${showModeration ? "bg-brand-primary/25 text-brand-primary ring-1 ring-brand-primary/40" : "bg-brand-primary/15 text-brand-primary"}`}>
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
          <div className="h-1.5" />

        </div>
      </motion.div>
    </>
  )}
</AnimatePresence>
      </AnimatePresence>

      <div className="flex flex-1 min-h-0 overflow-hidden z-10">
        <AnimatePresence>
          {!isFocusMode && (
            <motion.aside initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} className={`w-64 border-r border-white/5 hidden md:flex flex-col shrink-0 px-8 pb-8 ${
              isDesktop 
                ? 'pt-[7.5rem]' 
                : Capacitor.isNativePlatform() 
                  ? 'pt-8' 
                  : 'pt-[6.5rem]'
           }`}>
                <div className="flex-1 overflow-y-auto flex flex-col gap-10 scrollbar-hide">
                    <div>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Playlists</h3>
                        <div className="flex items-center gap-2.5">
                          <button type="button" title="Crear playlist" onClick={handleOpenCreatePlaylist}><Plus size={14} className="hover:text-brand-primary cursor-pointer transition-all" /></button>
                          <button type="button" title="Unirse a playlist colaborativa" onClick={() => setIsJoinPlaylistModalOpen(true)}><UserPlus size={14} className="hover:text-indigo-400 cursor-pointer transition-all" /></button>
                          <UploadIcon size={14} className="hover:text-brand-primary cursor-pointer transition-all" onClick={() => setIsImportOpen(true)} />
                        </div>
                      </div>
                      <ul className="space-y-4 text-[13px] font-medium">
                        <li key="stream-all" className={`cursor-pointer transition-all ${activePlaylistId === "all" ? "text-brand-primary" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("all"); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>Global Stream</li>
                        <li key="liked-songs" className={`flex items-center gap-2 cursor-pointer transition-all ${activePlaylistId === "liked" ? "text-red-500 font-bold" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("liked"); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>
                            <Heart size={14} fill={activePlaylistId === "liked" ? "currentColor" : "none"} /> Liked Tracks
                        </li>
                        <li key="offline-songs" className={`flex items-center gap-2 cursor-pointer transition-all ${activePlaylistId === "offline" ? "text-emerald-400 font-bold" : "text-white/50 hover:text-white"}`} onClick={() => { setActivePlaylistId("offline"); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>
                            <Download size={14} /> Offline Tracks ({offlineIds.size})
                        </li>
                        {playlists.map(p => (
                            <li key={p.id} className="group flex items-center justify-between cursor-pointer">
                                <div className="flex items-center gap-2.5 min-w-0" onClick={() => { setActivePlaylistId(p.id.toString()); setShowModeration(false); setSelectedAlbumName(null); setSelectedArtistName(null); }}>
                                  {p.cover_path ? (
                                    <img 
                                      src={getThumbnailUrl(resolveApiUrl(p.cover_path), 80)} 
                                      alt="" 
                                      className="w-5 h-5 rounded object-cover shrink-0 border border-white/10" 
                                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                  ) : (
                                    <Music2 size={13} className="shrink-0 opacity-40 group-hover:opacity-75 transition-opacity" />
                                  )}
                                  <span className={`truncate transition-all ${activePlaylistId === p.id.toString() ? "text-brand-primary font-bold" : "text-white/50 hover:text-white"}`}>{p.name}</span>
                                  {Boolean(p.is_collaborative) && (
                                    <Users size={11} className="text-indigo-400 shrink-0" title={p.owner_name ? `Colaborativa · de ${p.owner_name}` : "Colaborativa"} />
                                  )}
                                  {offlinePlaylistIds.has(p.id.toString()) && (
                                    <span title="Disponible sin conexión"><Download size={11} className="text-emerald-400 shrink-0" /></span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0 ml-2">
                                  {isPlaylistOwner(p) ? (
                                    <>
                                      <button type="button" title="Editar playlist" onClick={(e) => { e.stopPropagation(); handleOpenEditPlaylist(p); }}><Edit2 size={12} className="opacity-50 hover:!opacity-100 text-white/70 hover:text-brand-primary transition-all cursor-pointer" /></button>
                                      <button type="button" title="Eliminar playlist" onClick={(e) => { e.stopPropagation(); handleDeletePlaylist(p.id); }}><Trash2 size={12} className="opacity-50 hover:!opacity-100 text-red-500 hover:text-red-400 transition-all cursor-pointer" /></button>
                                    </>
                                  ) : (
                                    Boolean(p.is_collaborative) && (
                                      <button type="button" title="Dejar de colaborar" onClick={(e) => { e.stopPropagation(); handleLeavePlaylist(p); }}><LogOut size={12} className="opacity-50 hover:!opacity-100 text-amber-400 hover:text-amber-300 transition-all cursor-pointer" /></button>
                                    )
                                  )}
                                </div>
                            </li>
                        ))}
                      </ul>
                    </div>
                    {audioSettings.visualizer.enabled && (
                      <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-top-2 duration-500">
                          <h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Aura Sync</h3>
                          <div className="h-24 border border-white/10 bg-white/5 rounded-2xl overflow-hidden p-4 w-full relative">
                              <Visualizer analyser={audioObj.analyser} active={isPlaying} color={dynamicColor} />
                          </div>
                      </div>
                    )}
                    <div><h3 className="text-[10px] uppercase font-bold text-white/30 mb-6 tracking-widest flex items-center gap-2"><Clock size={12}/> History</h3><div className="space-y-4">{recentlyPlayed.map((song) => (<div key={song.id} className="flex items-center gap-4 group cursor-pointer" onClick={() => { if(isMinigameActive) handleMinigameGuess(song); else handlePlaySong(song); }}><div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/10 group-hover:scale-105 transition-transform bg-white/5"><img src={getCachedOfflineBlobUrl(song.coverUrl) || getThumbnailUrl(song.coverUrl, 150) || DEFAULT_COVER} onError={(e) => { if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) { e.currentTarget.src = DEFAULT_COVER; } }} className="w-full h-full object-cover" alt={song.title} /></div><div className="overflow-hidden"><p className="text-[11px] font-bold tabular-nums truncate text-white">{song.title}</p></div></div>))}</div></div>
                </div>
                <div className="mt-auto pt-6">
                  <div onClick={() => setIsPersonalizationOpen(true)} className="p-5 rounded-[28px] border border-white/5 bg-white/5 cursor-pointer flex items-center gap-4 hover:bg-white/[0.08] transition-all">
                    <Palette size={18} className="text-brand-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">Aesthetic</span>
                  </div>
                </div>
            </motion.aside>
          )}
        </AnimatePresence>

       <main
  ref={mainRef}
  onScroll={handleMainScroll}
  className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden max-w-full px-4 md:px-10 ${
    isDesktop 
      ? 'pt-[calc(9rem+env(safe-area-inset-top))]' 
      : Capacitor.isNativePlatform()
        ? 'pt-[calc(5.5rem+env(safe-area-inset-top))]'
        : 'pt-[calc(8rem+env(safe-area-inset-top))]'
  } flex flex-col gap-8 md:gap-12 pb-8 scrollbar-hide transition-all duration-700 ${
    isFocusMode ? 'items-center justify-center !pt-0' : ''
  }`}
>
            {/* VISTA ESPECIAL: PERFIL DE ARTISTA */}
            {selectedArtistName ? (
              <section className="space-y-10 animate-in fade-in duration-500">
                <div className="relative p-8 md:p-12 rounded-[40px] bg-white/[0.03] border border-white/10 overflow-hidden flex flex-col md:flex-row items-center gap-8 shadow-2xl">
                  <div className="relative group/avatar w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden shrink-0 border-2 border-brand-primary/40 shadow-[0_0_50px_rgba(99,102,241,0.2)] bg-white/5">
                    <img 
                      key={selectedArtistName}
                      src={resolvedArtistImageUrl || getCachedOfflineBlobUrl(flattenedSongs[0]?.coverUrl) || flattenedSongs[0]?.coverUrl || DEFAULT_COVER} 
                      onError={(e) => {
                        if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                          e.currentTarget.src = DEFAULT_COVER;
                        }
                      }}
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
                        onClick={handleNavigateBack}
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
                        onClick={() => {
                          setNewBioText(artistBio || "");
                          setIsEditingBio(true);
                        }}
                        className="flex items-center gap-1 px-3 py-1 rounded-full bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 transition-all cursor-pointer text-[10px] font-bold uppercase tracking-wider"
                      >
                        <Edit2 size={12} /> Edit Bio
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
                    <div className={getMobileAlbumGridClass(mobileColumns)}>
                      {artistAlbums.map(alb => (
                        <div 
                          key={alb.title} 
                          onClick={() => { setSelectedArtistName(null); setSelectedAlbumName(alb.title); }}
                          className="group p-4 rounded-3xl bg-white/5 border border-white/5 hover:border-brand-primary/40 cursor-pointer transition-all flex flex-col"
                        >
                          <div className="aspect-square rounded-2xl overflow-hidden mb-3 bg-white/5">
                            <img
                              src={getCachedOfflineBlobUrl(alb.coverUrl) || alb.coverUrl || DEFAULT_COVER}
                              onError={(e) => {
                                if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                  e.currentTarget.src = DEFAULT_COVER;
                                }
                              }}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              alt=""
                            />
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
                  <div className={getMobileSongGridClass(mobileColumns)}>
                    {flattenedSongs.slice(0, renderedCount).map((song, idx) => (
                      <MusicCard 
                        key={song.id}
                        song={song}
                        priority={idx < 12}
                        isActive={!isMinigameActive && currentSong?.id === song.id}
                        isPlaying={!isMinigameActive && currentSong?.id === song.id && isPlaying}
                        playlists={playlists}
                        userRole={userRole}
                        isLiked={likedIds.some(id => String(id) === String(song.id))}
                        onToggleLike={() => handleToggleLike(song.id)}
                        onAddToPlaylist={(pid) => handleAddToPlaylist(song.id, pid)}
                        onOpenTabs={() => setTabsSong(song)} 
                        onDelete={() => setTrackToDelete(song.id)}
                        onPlayNext={() => handlePlayNext(song)}
                        onAddToQueue={() => handleAddToQueue(song)}
                        onEdit={() => setSongToEdit(song)}
                        onOpenAlbum={(album) => { setSelectedArtistName(null); setSelectedAlbumName(album); }}
                        onOpenArtist={(artist) => setSelectedArtistName(artist)}
                        onClick={() => handlePlaySong(song)} 
                      />
                    ))}
                  </div>
                </div>
              </section>
            ) : selectedAlbumName ? (
              <AlbumDetailView
                albumName={selectedAlbumName}
                songs={songs.filter(s => s.album === selectedAlbumName)}
                currentSong={currentSong}
                isPlaying={isPlaying}
                likedIds={likedIds}
                playlists={playlists}
                userRole={userRole}
                onPlaySong={(song) => handlePlaySong(song, false, 0, false, selectedAlbumName)}
                onPlayAll={(tracks) => {
                  if (tracks.length > 0) handlePlaySong(tracks[0], false, 0, false, selectedAlbumName);
                }}
                onShuffleAll={(tracks) => {
                  if (tracks.length > 0) {
                    const randomIdx = Math.floor(Math.random() * tracks.length);
                    if (!socketObj.isShuffle) socketObj.setIsShuffle(true);
                    handlePlaySong(tracks[randomIdx], false, 0, false, selectedAlbumName);
                  }
                }}
                onAddAlbumToQueue={handleAddAlbumToQueue}
                onBack={handleNavigateBack}
                onOpenArtist={(art) => {
                  setSelectedAlbumName(null);
                  setSelectedArtistName(art);
                }}
                onToggleLike={handleToggleLike}
                onAddToPlaylist={handleAddToPlaylist}
                onPlayNext={handlePlayNext}
                onAddToQueue={handleAddToQueue}
                onEditSong={(song) => setSongToEdit(song)}
                onDeleteSong={(songId) => setTrackToDelete(songId)}
                onOpenTabs={(song) => setTabsSong(song)}
              />
            ) : !isFocusMode ? (
              <>
      <AnimatePresence>
        {showUpload && (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <LazyMusicUpload onClose={() => setShowUpload(false)} onUploadComplete={() => loadContent()} />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>
                
                {/* HERO BANNER */}
                {!isMinigameActive && !selectedAlbumName && (
                  (() => {
                    const currentPlaylist = playlists.find(p => p.id.toString() === activePlaylistId);
                    if (currentPlaylist) {
                      const plCover = currentPlaylist.cover_path 
                        ? resolveApiUrl(currentPlaylist.cover_path) 
                        : (songs[0]?.coverUrl || DEFAULT_COVER);
                      const isCurrentPlPlaying = isPlaying && currentSong && songs.some(s => s.id === currentSong.id);

                      return (
                        <section className="relative min-h-[14rem] md:min-h-[16rem] shrink-0 flex flex-col justify-end p-6 md:p-8 rounded-[30px] md:rounded-[40px] overflow-hidden group shadow-2xl border border-white/10 bg-white/[0.02]">
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/30 z-10" />
                          <div className="absolute inset-0 -z-10 bg-[#0c0c0c]">
                            {currentPlaylist.cover_path || songs[0]?.coverUrl ? (
                              <img 
                                src={plCover} 
                                className="w-full h-full object-cover blur-2xl opacity-40 scale-110" 
                                alt="" 
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-brand-primary/10 via-black to-black" />
                            )}
                          </div>

                          <div className="z-20 flex flex-col md:flex-row items-center md:items-end gap-6">
                            <div 
                              onClick={isPlaylistOwner(currentPlaylist) ? () => handleOpenEditPlaylist(currentPlaylist) : undefined} 
                              className={`relative group/cover w-32 h-32 md:w-44 md:h-44 rounded-2xl md:rounded-3xl overflow-hidden shrink-0 shadow-2xl border border-white/10 bg-white/5 ${isPlaylistOwner(currentPlaylist) ? 'cursor-pointer' : ''}`}
                              title={isPlaylistOwner(currentPlaylist) ? "Haz clic para cambiar la portada o editar la playlist" : currentPlaylist.name}
                            >
                              {currentPlaylist.cover_path || songs[0]?.coverUrl ? (
                                <img 
                                  src={getThumbnailUrl(plCover, 500) || DEFAULT_COVER} 
                                  alt={currentPlaylist.name} 
                                  className="w-full h-full object-cover group-hover/cover:scale-105 transition-transform duration-500" 
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-white/20">
                                  <Music2 size={48} />
                                </div>
                              )}
                              {isPlaylistOwner(currentPlaylist) && (
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/cover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white">
                                  <Edit2 size={20} className="text-brand-primary" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider">Cambiar foto</span>
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0 text-center md:text-left">
                              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2">
                                <p className="text-[9px] md:text-[11px] uppercase tracking-[0.4em] text-brand-primary font-bold">Playlist</p>
                                {Boolean(currentPlaylist.is_collaborative) && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                    <Users size={11} />
                                    <span>Colaborativa</span>
                                    {currentPlaylist.owner_name && !isPlaylistOwner(currentPlaylist) && (
                                      <span className="text-white/50 text-[9px] font-normal">· Por {currentPlaylist.owner_name}</span>
                                    )}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-center md:justify-start gap-3">
                                <h1 className="text-2xl md:text-5xl font-serif italic text-white mb-2 leading-tight truncate">
                                  {currentPlaylist.name}
                                </h1>
                                {isPlaylistOwner(currentPlaylist) && (
                                  <button 
                                    onClick={() => handleOpenEditPlaylist(currentPlaylist)} 
                                    className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all cursor-pointer"
                                    title="Editar nombre, descripción y portada"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                )}
                              </div>
                              
                              {currentPlaylist.description ? (
                                <p className="text-white/70 text-xs md:text-sm line-clamp-2 max-w-2xl font-sans mb-4">
                                  {currentPlaylist.description}
                                </p>
                              ) : isPlaylistOwner(currentPlaylist) ? (
                                <p 
                                  onClick={() => handleOpenEditPlaylist(currentPlaylist)}
                                  className="text-white/30 hover:text-white/60 text-xs italic cursor-pointer mb-4 transition-colors"
                                >
                                  Añadir una descripción...
                                </p>
                              ) : null}

                              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                <button 
                                  onClick={() => {
                                    if (songs.length > 0) {
                                      if (currentSong && songs.some(s => s.id === currentSong.id)) {
                                        setIsPlaying(!isPlaying);
                                      } else {
                                        handlePlaySong(songs[0]);
                                      }
                                    }
                                  }} 
                                  disabled={songs.length === 0}
                                  className="px-6 py-2 rounded-full bg-white text-black font-bold text-[10px] uppercase shadow-xl hover:scale-105 transition-all cursor-pointer flex items-center gap-2"
                                >
                                  <Play size={12} className="fill-black" />
                                  <span>{isCurrentPlPlaying ? "Pausar" : "Reproducir"}</span>
                                </button>

                                <button 
                                  onClick={() => {
                                    if (songs.length > 0) {
                                      const randomIdx = Math.floor(Math.random() * songs.length);
                                      if (!socketObj.isShuffle) socketObj.setIsShuffle(true);
                                      handlePlaySong(songs[randomIdx]);
                                    }
                                  }} 
                                  disabled={songs.length === 0}
                                  className="px-5 py-2 rounded-full bg-white/10 text-white font-bold text-[10px] uppercase border border-white/10 hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5"
                                >
                                  <Shuffle size={12} />
                                  <span>Aleatorio</span>
                                </button>

                                {isAiEnabled && (
                                <button
                                  onClick={() => setIsAuraDjOpen(true)}
                                  className="px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer aura-dj-badge hover:brightness-110 shadow-md"
                                >
                                  <Sparkles size={12} className="fill-brand-primary" />
                                  <span>Aura DJ</span>
                                </button>
                                )}

                                {(() => {
                                  const plDownloaded = songs.filter(s => offlineIds.has(String(s.id))).length;
                                  const isPlSyncing = isPlaylistSyncing(activePlaylistId);
                                  const isPlOffline = isPlaylistOffline(activePlaylistId);
                                  const syncProgress = playlistSyncProgress.get(activePlaylistId);
                                  const allDownloaded = songs.length > 0 && plDownloaded === songs.length;

                                  return (
                                    <button
                                      onClick={() => {
                                        if (isPlSyncing) return;
                                        if (isPlOffline && allDownloaded) {
                                          if (confirm(`¿Quitar "${currentPlaylist.name}" del modo sin conexión?`)) {
                                            void removePlaylistOffline(currentPlaylist.id);
                                          }
                                        } else {
                                          void syncPlaylistOffline(currentPlaylist, songs);
                                        }
                                      }}
                                      disabled={isPlSyncing || songs.length === 0}
                                      className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                                        isPlSyncing
                                          ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/40'
                                          : isPlOffline && allDownloaded
                                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                                          : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/15 hover:text-white'
                                      }`}
                                    >
                                      {isPlSyncing ? (
                                        <>
                                          <Loader2 size={12} className="animate-spin text-brand-primary" />
                                          <span>Sincronizando ({syncProgress?.current || 0}/{syncProgress?.total || songs.length})</span>
                                        </>
                                      ) : isPlOffline && allDownloaded ? (
                                        <>
                                          <CheckCircle2 size={12} className="text-emerald-400" />
                                          <span>Descargada ({songs.length})</span>
                                        </>
                                      ) : (
                                        <>
                                          <Download size={12} />
                                          <span>Descargar ({plDownloaded}/{songs.length})</span>
                                        </>
                                      )}
                                    </button>
                                  );
                                })()}

                                {Boolean(currentPlaylist.is_collaborative) && (
                                  <button
                                    onClick={() => handleSharePlaylistInvite(currentPlaylist)}
                                    className="px-4 py-2 rounded-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-bold text-[10px] uppercase border border-indigo-500/30 transition-all cursor-pointer flex items-center gap-1.5"
                                    title="Copiar enlace para invitar colaboradores"
                                  >
                                    <Copy size={12} />
                                    <span>Invitar</span>
                                  </button>
                                )}

                                {isPlaylistOwner(currentPlaylist) ? (
                                  <button
                                    onClick={() => handleOpenEditPlaylist(currentPlaylist)}
                                    className="px-4 py-2 rounded-full bg-white/5 text-white/70 hover:text-white font-bold text-[10px] uppercase border border-white/10 hover:bg-white/15 transition-all cursor-pointer flex items-center gap-1.5"
                                  >
                                    <Edit2 size={12} />
                                    <span>Editar</span>
                                  </button>
                                ) : (
                                  Boolean(currentPlaylist.is_collaborative) && (
                                    <button
                                      onClick={() => handleLeavePlaylist(currentPlaylist)}
                                      className="px-4 py-2 rounded-full bg-white/5 text-amber-400 hover:text-amber-300 font-bold text-[10px] uppercase border border-amber-500/20 hover:bg-amber-500/10 transition-all cursor-pointer flex items-center gap-1.5"
                                      title="Dejar de ser colaborador en esta playlist"
                                    >
                                      <LogOut size={12} />
                                      <span>Salir</span>
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        </section>
                      );
                    }

                    return (
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
                    );
                  })()
                )}

                <section>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-white/5 pb-4 text-white gap-4">
                        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 w-full">
                            {(() => {
                              const currentPlaylist = playlists.find(p => p.id.toString() === activePlaylistId);
                              return (
                                <>
                                  <h2 className="text-[10px] md:text-[11px] uppercase tracking-[0.3em] md:tracking-[0.4em] font-bold text-white/40">
                                    {isMinigameActive
                                      ? "RECON MINIGAME - CLICK TO GUESS"
                                      : selectedAlbumName
                                      ? `ALBUM: ${selectedAlbumName.toUpperCase()}`
                                      : showModeration
                                      ? "PENDING QUEUE"
                                      : activePlaylistId === 'all'
                                      ? (
                                        <span className="flex items-center gap-1 sm:gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 shrink-0 normal-case max-w-full overflow-x-auto scrollbar-hide">
                                          <button
                                            type="button"
                                            onClick={() => setLibrarySection('songs')}
                                            className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold tracking-normal shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                                              librarySection === 'songs'
                                                ? 'bg-brand-primary text-black shadow-lg font-black'
                                                : 'text-white/60 hover:text-white hover:bg-white/5'
                                            }`}
                                          >
                                            <Music2 size={13} />
                                            <span>Canciones</span>
                                            <span className="text-[9px] opacity-75">({searchQuery.trim() ? flattenedSongs.length : songs.length})</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => setLibrarySection('albums')}
                                            className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold tracking-normal shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                                              librarySection === 'albums'
                                                ? 'bg-brand-primary text-black shadow-lg font-black'
                                                : 'text-white/60 hover:text-white hover:bg-white/5'
                                            }`}
                                          >
                                            <Disc size={13} />
                                            <span>Álbumes</span>
                                            <span className="text-[9px] opacity-75">({searchQuery.trim() ? filteredAlbums.length : allAlbums.length})</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => setLibrarySection('artists')}
                                            className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold tracking-normal shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                                              librarySection === 'artists'
                                                ? 'bg-brand-primary text-black shadow-lg font-black'
                                                : 'text-white/60 hover:text-white hover:bg-white/5'
                                            }`}
                                          >
                                            <User size={13} />
                                            <span>Artistas</span>
                                            <span className="text-[9px] opacity-75">({searchQuery.trim() ? filteredArtists.length : allArtists.length})</span>
                                          </button>
                                        </span>
                                      )
                                      : activePlaylistId === 'liked'
                                      ? "Favorite Tracks"
                                      : activePlaylistId === 'offline'
                                      ? "Offline Tracks"
                                      : currentPlaylist
                                      ? `Canciones (${songs.length})`
                                      : "Playlist Stream"}
                                  </h2>
                                  {!selectedAlbumName && !isMinigameActive && (
                                    <div className="flex flex-wrap items-center gap-3">
                                      {currentPlaylist && !showModeration && (
                                        <button
                                          onClick={() => handleOpenEditPlaylist(currentPlaylist)}
                                          title={`Editar "${currentPlaylist.name}"`}
                                          className="px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer shadow-sm bg-white/5 text-white/70 border border-white/10 hover:bg-white/15 hover:text-white"
                                        >
                                          <Edit2 size={11} />
                                          <span>Editar</span>
                                        </button>
                                      )}
                                      {currentPlaylist && !showModeration && (
                                        (() => {
                                          const plDownloaded = songs.filter(s => offlineIds.has(String(s.id))).length;
                                          const isPlSyncing = isPlaylistSyncing(activePlaylistId);
                                          const isPlOffline = isPlaylistOffline(activePlaylistId);
                                          const syncProgress = playlistSyncProgress.get(activePlaylistId);
                                          const allDownloaded = songs.length > 0 && plDownloaded === songs.length;

                                          return (
                                            <button
                                              onClick={() => {
                                                if (isPlSyncing) return;
                                                if (isPlOffline && allDownloaded) {
                                                  if (confirm(`¿Quitar "${currentPlaylist.name}" del modo sin conexión?`)) {
                                                    void removePlaylistOffline(currentPlaylist.id);
                                                  }
                                                } else {
                                                  void syncPlaylistOffline(currentPlaylist, songs);
                                                }
                                              }}
                                              disabled={isPlSyncing || songs.length === 0}
                                              title={allDownloaded ? "Playlist sincronizada sin conexión. Clic para quitar." : "Descargar playlist completa"}
                                              className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                                                isPlSyncing
                                                  ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/40'
                                                  : isPlOffline && allDownloaded
                                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                                                  : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/15 hover:text-white'
                                              }`}
                                            >
                                              {isPlSyncing ? (
                                                <>
                                                  <Loader2 size={11} className="animate-spin text-brand-primary" />
                                                  <span>Sincronizando ({syncProgress?.current || 0}/{syncProgress?.total || songs.length})</span>
                                                </>
                                              ) : isPlOffline && allDownloaded ? (
                                                <>
                                                  <CheckCircle2 size={11} className="text-emerald-400" />
                                                  <span>Descargada ({songs.length})</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Download size={11} />
                                                  <span>Descargar playlist ({plDownloaded}/{songs.length})</span>
                                                </>
                                              )}
                                            </button>
                                          );
                                        })()
                                      )}
                                      {currentPlaylist && !showModeration && isAiEnabled && (
                                        <button
                                          onClick={() => setIsAuraDjOpen(true)}
                                          title={`Aura DJ: mezclar o reordenar "${currentPlaylist.name}"`}
                                          className="px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer shadow-sm aura-dj-badge hover:brightness-110"
                                        >
                                          <Sparkles size={11} className="fill-brand-primary" />
                                          <span>Aura DJ</span>
                                        </button>
                                      )}
                                      {showModeration && userRole === 'admin' && (
                                        <div className="flex flex-col gap-3 w-full max-w-[200px]">
                                          <button
                                            onClick={handlePurgeCovers}
                                            disabled={isPurging}
                                            className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all shadow-lg flex items-center gap-1.5 ${
                                              isPurging
                                                ? 'bg-white/20 text-white/40 cursor-not-allowed'
                                                : 'bg-amber-600 text-white hover:bg-amber-500 active:scale-95 cursor-pointer'
                                            }`}
                                          >
                                            {isPurging ? (
                                              <>
                                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Purging...
                                              </>
                                            ) : (
                                              <>
                                                <AlertTriangle size={10}/> Purge Album Covers
                                              </>
                                            )}
                                          </button>
                                          {purgeStats && !isPurging && (
                                            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[8px] text-amber-200 space-y-0.5 animate-in fade-in slide-in-from-top-1">
                                              <p>Albums: {purgeStats.albums}</p>
                                              <p>Tracks: {purgeStats.tracks}</p>
                                              <p>Files: {purgeStats.files}</p>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {!showModeration && (
                                        <div className={`flex p-1 rounded-full border border-white/5 bg-white/5`}>
                                          {(['all', 'mp3', 'flac'] as const).map(f => (<button key={f} onClick={() => setFormatFilter(f)} className={`px-3 md:px-4 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all cursor-pointer ${formatFilter === f ? 'bg-brand-primary text-black' : 'text-white/30 hover:text-white'}`}>{f}</button>))}
                                        </div>
                                      )}
                                      {!showModeration && (
                                        <div className={`flex items-center gap-2 p-1 rounded-full border border-white/5 bg-white/5`}>
                                          <div className="px-2 text-white/20"><ArrowUpDown size={12}/></div>
                                          {(['first', 'name', 'album', 'artist'] as const).map(s => (<button key={s} onClick={() => setSortBy(s)} className={`px-3 md:px-4 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all cursor-pointer ${sortBy === s ? 'bg-white text-black' : 'text-white/30 hover:text-white'}`}>{s}</button>))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                        </div>
                        {selectedAlbumName && (
                          <div className="flex items-center gap-3">
                            {(() => {
                              const albumSongs = songs.filter(s => s.album === selectedAlbumName);
                              const albumDownloaded = albumSongs.filter(s => offlineIds.has(String(s.id))).length;
                              const isAlbumAll = albumSongs.length > 0 && albumDownloaded === albumSongs.length;
                              return (
                                <button
                                  onClick={() => {
                                    if (!isAlbumAll && albumSongs.length > 0) {
                                      void syncAlbumOffline(selectedAlbumName, albumSongs);
                                    }
                                  }}
                                  disabled={albumSongs.length === 0}
                                  className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                                    isAlbumAll
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                      : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/15 hover:text-white'
                                  }`}
                                >
                                  {isAlbumAll ? (
                                    <>
                                      <CheckCircle2 size={11} className="text-emerald-400" />
                                      <span>Álbum offline ({albumSongs.length})</span>
                                    </>
                                  ) : (
                                    <>
                                      <Download size={11} />
                                      <span>Descargar álbum ({albumDownloaded}/{albumSongs.length})</span>
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                            <button onClick={handleNavigateBack} className="cursor-pointer text-[10px] font-bold text-brand-primary uppercase tracking-widest">Back</button>
                          </div>
                        )}
                    </div>

                    {/* RESPONSIVE GRID */}
                    {activePlaylistId === 'all' && librarySection === 'albums' ? (
                      <div className={getMobileAlbumGridClass(mobileColumns)}>
                        {filteredAlbums.map((alb, idx) => (
                          <div
                            key={alb.title}
                            onClick={() => setSelectedAlbumName(alb.title)}
                            className="group p-3 sm:p-4 rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 hover:border-brand-primary/40 transition-all duration-300 flex flex-col justify-between shadow-lg min-w-0 overflow-hidden w-full"
                          >
                            <div className="aspect-square rounded-2xl overflow-hidden mb-3 relative bg-white/5 shadow-md">
                              <img
                                src={getCachedOfflineBlobUrl(alb.coverUrl) || getThumbnailUrl(alb.coverUrl, 300) || DEFAULT_COVER}
                                srcSet={getResponsiveCoverSrcSet(alb.coverUrl, 600)}
                                sizes="(max-width: 640px) 48vw, (max-width: 1024px) 25vw, (max-width: 1536px) 20vw, 16vw"
                                onError={(e) => {
                                  if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                    e.currentTarget.src = DEFAULT_COVER;
                                  }
                                }}
                                loading={idx < 12 ? "eager" : "lazy"}
                                fetchPriority={idx < 4 ? "high" : "auto"}
                                decoding={idx < 12 ? "sync" : "async"}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                alt={alb.title}
                              />
                              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const sorted = [...alb.tracks].sort((a, b) => {
                                      const numA = Number(a.track_number);
                                      const numB = Number(b.track_number);
                                      if (numA && numB) return numA - numB;
                                      if (numA && !numB) return -1;
                                      if (!numA && numB) return 1;
                                      return a.title.localeCompare(b.title);
                                    });
                                    handleAddAlbumToQueue(sorted);
                                  }}
                                  className="w-10 h-10 rounded-full bg-black/70 backdrop-blur-md text-white border border-white/20 flex items-center justify-center shadow-xl hover:scale-110 hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
                                  title={`Añadir ${alb.title} a la cola`}
                                >
                                  <ListPlus size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const sorted = [...alb.tracks].sort((a, b) => {
                                      const numA = Number(a.track_number);
                                      const numB = Number(b.track_number);
                                      if (numA && numB) return numA - numB;
                                      if (numA && !numB) return -1;
                                      if (!numA && numB) return 1;
                                      return a.title.localeCompare(b.title);
                                    });
                                    const first = sorted[0];
                                    if (first) {
                                      setSelectedAlbumName(alb.title);
                                      handlePlaySong(first, false, 0, false, alb.title);
                                    }
                                  }}
                                  className="w-10 h-10 rounded-full bg-brand-primary text-black flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all cursor-pointer"
                                  title={`Reproducir ${alb.title}`}
                                >
                                  <Play size={16} fill="black" className="ml-0.5" />
                                </button>
                              </div>
                            </div>

                            <div className="min-w-0 space-y-0.5">
                              <h3 className="text-sm font-bold text-white truncate" title={alb.title}>
                                {alb.title}
                              </h3>
                              <p className="text-xs text-white/50 truncate" title={alb.artist}>
                                {alb.artist}
                              </p>
                              <div className="flex items-center gap-1.5 pt-1 text-[10px] font-mono text-white/40">
                                <span>{alb.trackCount} {alb.trackCount === 1 ? 'pista' : 'pistas'}</span>
                                {alb.tracks.some(t => t.format === 'flac') && (
                                  <>
                                    <span>•</span>
                                    <span className="text-brand-primary font-bold">FLAC</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {filteredAlbums.length === 0 && (
                          <div className="py-20 text-center col-span-full flex flex-col items-center justify-center gap-2 text-white/50">
                            <Disc size={28} className="opacity-30" />
                            <p className="text-sm font-semibold">No se encontraron álbumes {searchQuery.trim() ? `para "${searchQuery}"` : ''}</p>
                          </div>
                        )}
                      </div>
                    ) : activePlaylistId === 'all' && librarySection === 'artists' ? (
                      <div className={getMobileAlbumGridClass(mobileColumns)}>
                        {filteredArtists.map((art, idx) => (
                          <div
                            key={art.name}
                            onClick={() => setSelectedArtistName(art.name)}
                            className="group p-3 sm:p-4 rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 hover:border-brand-primary/40 transition-all duration-300 flex flex-col items-center text-center shadow-lg min-w-0 overflow-hidden w-full"
                          >
                            <div className="w-20 h-20 sm:w-28 sm:h-28 aspect-square rounded-full overflow-hidden mb-2.5 sm:mb-3 relative bg-white/5 shadow-xl border border-white/10 shrink-0 mx-auto">
                              <img
                                src={getCachedOfflineBlobUrl(art.coverUrl) || getThumbnailUrl(art.coverUrl, 300) || DEFAULT_COVER}
                                srcSet={getResponsiveCoverSrcSet(art.coverUrl, 600)}
                                sizes="(max-width: 640px) 100px, (max-width: 1024px) 120px, 150px"
                                onError={(e) => {
                                  if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                    e.currentTarget.src = DEFAULT_COVER;
                                  }
                                }}
                                loading={idx < 12 ? "eager" : "lazy"}
                                fetchPriority={idx < 4 ? "high" : "auto"}
                                decoding={idx < 12 ? "sync" : "async"}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                alt={art.name}
                              />
                            </div>
                            <div className="min-w-0 w-full overflow-hidden space-y-0.5">
                              <h3 className="text-xs sm:text-sm font-bold text-white truncate w-full block px-1" title={art.name}>
                                {art.name}
                              </h3>
                              <p className="text-[10px] sm:text-[11px] font-semibold text-brand-primary truncate w-full block px-1 tracking-normal" title={`${art.albumCount} álbumes · ${art.trackCount} pistas`}>
                                {art.albumCount} {art.albumCount === 1 ? 'álbum' : 'álbumes'} · {art.trackCount} {art.trackCount === 1 ? 'pista' : 'pistas'}
                              </p>
                            </div>
                          </div>
                        ))}
                        {filteredArtists.length === 0 && (
                          <div className="py-20 text-center col-span-full flex flex-col items-center justify-center gap-2 text-white/50">
                            <User size={28} className="opacity-30" />
                            <p className="text-sm font-semibold">No se encontraron artistas {searchQuery.trim() ? `para "${searchQuery}"` : ''}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                    <div className={`${getMobileSongGridClass(mobileColumns)} w-full max-w-full`}>
                        {displayItems.slice(0, renderedCount).map((item: any, idx: number) => (
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
                                      className="group p-5 md:p-4 rounded-[32px] md:rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition-all duration-300 flex flex-col justify-between shadow-lg min-w-0 overflow-hidden w-full"
                                    >
                                      <div className="w-full aspect-square rounded-full overflow-hidden mb-4 relative bg-white/5 shadow-2xl border border-white/10">
                                        <img 
                                          src={getCachedOfflineBlobUrl(item.coverUrl) || getThumbnailUrl(item.coverUrl, 300) || DEFAULT_COVER} 
                                          srcSet={getResponsiveCoverSrcSet(item.coverUrl, 600)}
                                          sizes="(max-width: 640px) 100px, 150px"
                                          loading={idx < 12 ? "eager" : "lazy"}
                                          fetchPriority={idx < 4 ? "high" : "auto"}
                                          decoding={idx < 12 ? "sync" : "async"}
                                          onError={(e) => {
                                            if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                              e.currentTarget.src = DEFAULT_COVER;
                                            }
                                          }}
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
                                    <div onClick={() => setSelectedAlbumName(item.title)} className="min-w-0 overflow-hidden w-full group p-5 md:p-4 rounded-[32px] md:rounded-3xl cursor-pointer border border-white/5 bg-white/5 hover:bg-white/10 transition-all">
                                      <div className="aspect-square rounded-[24px] md:rounded-2xl overflow-hidden mb-4 relative">
                                        <img
                                          src={getCachedOfflineBlobUrl(item.coverUrl) || getThumbnailUrl(item.coverUrl, 300) || DEFAULT_COVER}
                                          srcSet={getResponsiveCoverSrcSet(item.coverUrl, 600)}
                                          sizes="(max-width: 640px) 50vw, 25vw"
                                          loading={idx < 12 ? "eager" : "lazy"}
                                          fetchPriority={idx < 4 ? "high" : "auto"}
                                          decoding={idx < 12 ? "sync" : "async"}
                                          onError={(e) => {
                                            if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                              e.currentTarget.src = DEFAULT_COVER;
                                            }
                                          }}
                                          className="w-full h-full object-cover transition-transform duration-700"
                                          alt={item.title}
                                        />
                                      </div>
                                      <h3 className="text-xl md:text-sm font-bold truncate text-white">{item.title}</h3>
                                      <p className="text-sm md:text-[10px] uppercase font-bold tracking-widest text-white/40 truncate">{item.trackCount} Tracks Found</p>
                                    </div>

                                /* 3. TARJETA DE CANCIÓN */
                                ) : (
                                    <div
                                      className="relative"
                                      style={{ pointerEvents: draggedSongId && draggedSongId !== item.id ? 'none' : 'auto' }}
                                    >
                                      <MusicCard 
                                        song={item}
                                        priority={idx < 12}
                                        isActive={!isMinigameActive && currentSong?.id === item.id}
                                        isPlaying={!isMinigameActive && currentSong?.id === item.id && isPlaying}
                                        playlists={playlists}
                                        userRole={userRole}
                                        isLiked={likedIds.some(id => String(id) === String(item.id))}
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
                                        onOpenAlbum={(album) => setSelectedAlbumName(album)}
                                        onOpenArtist={(artist) => setSelectedArtistName(artist)}
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
                        {displayItems.length === 0 && (
                          <div className="py-20 text-center col-span-full flex flex-col items-center justify-center gap-3 text-white/50">
                            <Search size={32} className="opacity-30" />
                            <p className="text-sm font-semibold">
                              {searchQuery.trim() ? `No se encontraron resultados para "${searchQuery}"` : 'No hay canciones disponibles'}
                            </p>
                            {searchQuery.trim() && (
                              <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="text-xs text-brand-primary underline hover:opacity-80 cursor-pointer"
                              >
                                Limpiar búsqueda
                              </button>
                            )}
                          </div>
                        )}
                    </div>
                    )}
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
                      {resolvedAnimatedCoverUrl && !tvVideoError ? (
                        isVideoUrl(resolvedAnimatedCoverUrl) ? (
                          <video
                            src={resolvedAnimatedCoverUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            onError={() => setTvVideoError(true)}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={!isVideoUrl(resolvedAnimatedCoverUrl) ? resolvedAnimatedCoverUrl : (resolvedCoverUrl || DEFAULT_COVER)}
                            onError={(e) => {
                              if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                                e.currentTarget.src = DEFAULT_COVER;
                              }
                            }}
                            className="w-full h-full object-cover"
                            alt=""
                          />
                        )
                      ) : (
                        <img
                          src={resolvedCoverUrl || DEFAULT_COVER}
                          onError={(e) => {
                            if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                              e.currentTarget.src = DEFAULT_COVER;
                            }
                          }}
                          className="w-full h-full object-cover"
                          alt=""
                        />
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
        ref={audioObj.primaryAudioRef}
        preload="auto"
        crossOrigin="anonymous"
        style={{ display: "none" }}
      />
      <audio
        ref={audioObj.secondaryAudioRef}
        preload="auto"
        crossOrigin="anonymous"
        style={{ display: "none" }}
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
              onOpenAudioSettings={() => setIsAudioSettingsOpen(true)}
              audioSettings={audioSettings}
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
                  if (blockIfGuest()) return;
                  audioObj.seek(t);
                  socketObj.emitCommand("seek", { time: t });
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
  subscribeToTime={audioObj.subscribeToTime} onSeek={(t:any) => audioObj.seek(t)} />}</AnimatePresence></Suspense>
      <AnimatePresence>{isFullPlayerOpen && <FullPlayerOverlay isOpen={isFullPlayerOpen} liveCurrentTime={audioObj.getCurrentTime()} subscribeToTime={audioObj.subscribeToTime}
getCurrentTime={audioObj.getCurrentTime}
 onClose={() => setIsFullPlayerOpen(false)} currentSong={currentSong} animatedCoverUrl={resolvedAnimatedCoverUrl} isPlaying={isPlaying} onTogglePlay={() => { handlePlaySong(currentSong!); }} onNext={handleNext} onPrevious={handlePrevious} duration={audioObj.duration} onSeek={(t) => audioObj.seek(t)} volume={volume} onVolumeChange={setVolume} isShuffle={socketObj.isShuffle} isLoop={socketObj.isLoop} onToggleShuffle={toggleShuffle} onToggleLoop={toggleLoop} onToggleLyrics={() => { setIsFullPlayerOpen(false); setIsLyricsOpen(true); }} onToggleQueue={() => setIsQueueOpen(true)} onOpenAudioSettings={() => { setIsFullPlayerOpen(false); setIsAudioSettingsOpen(true); }} activeTheme={activeTheme} audioSettings={audioSettings} onOpenMinigameLobby={() => { setIsFullPlayerOpen(false); setIsMinigameLobbyOpen(true); }} />}</AnimatePresence>
      <Suspense fallback={null}><AnimatePresence>{isQueueOpen && <LazyQueueOverlay
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        queue={getCurrentPlayPool()}
        currentSong={currentSong}
        onPlayFromQueue={(song) => handlePlaySong(song, false, 0, true)}
        onReorderQueue={handleReorderQueue}
        isShuffle={socketObj.isShuffle}
        activeTheme={activeTheme}
        radioQueueIds={radioQueueIds}
      />}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isSleepTimerOpen && <LazySleepTimerOverlay
        isOpen={isSleepTimerOpen}
        onClose={() => setIsSleepTimerOpen(false)}
        isActive={sleepTimer.isActive}
        mode={sleepTimer.mode}
        remainingSeconds={sleepTimer.remainingSeconds}
        enableFadeOut={sleepTimer.enableFadeOut}
        setEnableFadeOut={sleepTimer.setEnableFadeOut}
        startTimer={sleepTimer.startTimer}
        startEndOfSongTimer={sleepTimer.startEndOfSongTimer}
        cancelTimer={sleepTimer.cancelTimer}
        extendTimer={sleepTimer.extendTimer}
        currentSong={currentSong}
      />}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isSocialOpen && <LazySocialSidebar token={token} user={user} socket={socketObj.socketRef.current} unreadSenders={socketObj.unreadSenders} setUnreadSenders={socketObj.setUnreadSenders} currentSession={socketObj.currentSession} onClose={() => setIsSocialOpen(false)} />}</AnimatePresence></Suspense>
      <AnimatePresence>{hostOnlyNotice && (
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[600] bg-[#121212] border border-amber-400/30 text-amber-300 text-[11px] font-bold px-4 py-2.5 rounded-full shadow-2xl">
          {hostOnlyNotice}
        </motion.div>
      )}</AnimatePresence>
      <AnimatePresence>{downloadNotice && (
        <motion.div
          key={downloadNotice.uid}
          initial={{ opacity: 0, y: -16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[750] bg-[#141414]/95 backdrop-blur-xl border px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 max-w-[92vw] ${
            downloadNotice.status === 'completed'
              ? 'border-emerald-500/40 text-emerald-400'
              : downloadNotice.status === 'error'
                ? 'border-red-500/40 text-red-400'
                : 'border-brand-primary/40 text-white'
          }`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            downloadNotice.status === 'completed'
              ? 'bg-emerald-500/20 text-emerald-400'
              : downloadNotice.status === 'error'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-brand-primary/20 text-brand-primary'
          }`}>
            <Download size={14} className={downloadNotice.status === 'downloading' ? 'animate-bounce' : ''} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold leading-tight truncate">{downloadNotice.title}</p>
            {downloadNotice.subtitle && (
              <p className="text-[10px] text-white/50 truncate mt-0.5">{downloadNotice.subtitle}</p>
            )}
          </div>
        </motion.div>
      )}</AnimatePresence>
      <AnimatePresence>{socketObj.activeInvite && ( <div className="fixed top-20 right-8 z-[500]"><motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="bg-[#121212] border border-brand-primary/30 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-white"><p className="text-xs font-bold tabular-nums">{socketObj.activeInvite.from} invited you.</p><button onClick={() => { handleJoinSession(socketObj.activeInvite!.code); socketObj.setActiveInvite(null); }} className="bg-brand-primary text-black font-bold py-2 rounded-lg text-[10px]">Join</button></motion.div></div> )}</AnimatePresence>
      <AnimatePresence>{isAuthModalOpen && ( <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"><motion.div className="bg-[#121212] border border-white/10 rounded-2xl p-8 w-full max-w-sm relative text-white shadow-2xl"><AuthForm onSuccess={handleLoginSuccess} onCancel={() => setIsAuthModalOpen(false)} /></motion.div></div> )}</AnimatePresence>
      <AnimatePresence>
        {discordLinkCode && user && (
          <DiscordLinkModal
            code={discordLinkCode}
            token={token}
            user={user}
            apiBase={API_BASE}
            onClose={() => {
              setDiscordLinkCode(null);
              const params = new URLSearchParams(window.location.search);
              params.delete('code');
              const qs = params.toString();
              const newPath = window.location.pathname === '/link' ? '/' : window.location.pathname;
              window.history.replaceState({}, '', newPath + (qs ? '?' + qs : ''));
            }}
            onSuccess={() => {
              if (user) {
                const updated = { ...user, discord_linked: true };
                setUser(updated);
                localStorage.setItem('aura_user', JSON.stringify(updated));
              }
            }}
          />
        )}
      </AnimatePresence>
      <Suspense fallback={null}>
        <AnimatePresence>
          {isPersonalizationOpen && (
            <LazyPersonalizationOverlay
              token={token}
              activeTheme={activeTheme}
              onThemeSelect={(id: string) => {
                setActiveTheme(id);
                localStorage.setItem('aura_theme', id);
              }}
              customBg={customBg}
              onBackgroundUpload={(url: string) => {
                setCustomBg(url);
              }}
              onRemoveBackground={() => {
                setCustomBg(null);
                if (activeTheme === 'custom') {
                  setActiveTheme('dark');
                  localStorage.setItem('aura_theme', 'dark');
                }
              }}
              isAiEnabled={isAiEnabled}
              onToggleAi={(val: boolean) => {
                setIsAiEnabled(val);
                localStorage.setItem('aura_enable_ai', String(val));
                if (!val) {
                  setIsAuraDjOpen(false);
                }
              }}
              isVisualizerEnabled={audioSettings.visualizer.enabled}
              onToggleVisualizer={(val: boolean) => {
                updateAudioSettings({ ...audioSettings, visualizer: { ...audioSettings.visualizer, enabled: val } });
              }}
              mobileColumns={mobileColumns}
              onChangeMobileColumns={(cols: 1 | 2 | 3) => {
                setMobileColumns(cols);
                localStorage.setItem("aura_mobile_columns", String(cols));
              }}
              mobilePlayerStyle={mobilePlayerStyle}
              onSelectMobilePlayerStyle={(style: MobilePlayerStyle) => {
                setMobilePlayerStyle(style);
                localStorage.setItem('aura_mobile_player_style', style);
              }}
              bgOpacity={bgOpacity}
              onChangeBgOpacity={(val: number) => {
                setBgOpacity(val);
                localStorage.setItem('aura_bg_opacity', String(val));
              }}
              ambientGlow={ambientGlow}
              onChangeAmbientGlow={(glow) => {
                setAmbientGlow(glow);
                localStorage.setItem('aura_ambient_glow', glow);
              }}
              accentColor={accentColor}
              onChangeAccentColor={(hex: string) => {
                setAccentColor(hex);
                localStorage.setItem('aura_accent_color', hex);
                applyAccentColor(hex);
              }}
              ambientGlowColor={ambientGlowColor}
              onChangeAmbientGlowColor={(color: string) => {
                setAmbientGlowColor(color);
                localStorage.setItem('aura_ambient_glow_color', color);
              }}
              hapticsEnabled={hapticsEnabled}
              onToggleHaptics={(val: boolean) => {
                setHapticsEnabled(val);
                localStorage.setItem('aura_haptics_enabled', String(val));
              }}
              onClose={() => setIsPersonalizationOpen(false)}
            />
          )}
        </AnimatePresence>
      </Suspense>
      <Suspense fallback={null}><AnimatePresence>{isAudioSettingsOpen && (
        <LazyAudioSettingsOverlay
          onClose={() => setIsAudioSettingsOpen(false)}
          settings={audioSettings}
          onChange={updateAudioSettings}
          subscribeStatus={audioObj.subscribeStatus}
          getStatus={audioObj.getStatus}
          onClearLoudnessCache={audioObj.clearLoudnessCache}
        />
      )}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isProfileOpen && (
        <LazyProfileOverlay
          token={token}
          isNormalizerEnabled={isNormalizerEnabled}
          onToggleNormalizer={(val: boolean) => updateAudioSettings({ ...audioSettings, normalizer: { ...audioSettings.normalizer, enabled: val } })}
          onOpenAudioSettings={() => { setIsProfileOpen(false); setIsAudioSettingsOpen(true); }}
          onClose={() => setIsProfileOpen(false)}
          currentVersion={currentVersion}
          isCheckingUpdate={isCheckingUpdate}
          updateCheckMessage={updateCheckMessage}
          onCheckForUpdates={() => checkForUpdates(true)}
          onOpenWhatsNew={() => { setIsProfileOpen(false); openWhatsNewModal(); }}
        />
      )}</AnimatePresence></Suspense>
      <AnimatePresence>{isImportOpen && (
        <PlaylistImportOverlay
          onClose={() => setIsImportOpen(false)}
          token={token}
          onImportComplete={(name, ids) => {
            setIsImportOpen(false);
            loadPlaylists();
            loadContent();
          }}
        />
      )}</AnimatePresence>
      <AnimatePresence>{sessionNotice && (<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[700] bg-[#121212] border border-brand-primary/30 text-white text-xs font-bold px-5 py-3 rounded-2xl shadow-2xl max-w-[90vw] text-center">{sessionNotice}</motion.div> )}</AnimatePresence>
      <Suspense fallback={null}><AnimatePresence>{isSessionOpen && ( <LazySessionOverlay onClose={() => setIsSessionOpen(false)} token={token} user={user} currentSession={socketObj.currentSession} messages={socketObj.sessionMessages} members={socketObj.sessionMembers} onSendMessage={handleSendChat} onCreateSession={handleStartSession} onJoinSession={handleJoinSession} onLeaveSession={() => socketObj.leaveSession()} isHost={socketObj.isLeader()} onTransferHost={async (uid: string) => { const r = await socketObj.transferHost(uid); if (!r.ok) alert('No se ha podido ceder el control.'); }} onSendReaction={(messageId, reaction) => socketObj.emitReaction(messageId, reaction)} analyser={audioObj.analyser} active={isPlaying} /> )}</AnimatePresence></Suspense>
      <Suspense fallback={null}><AnimatePresence>{isWrappedOpen && <LazyWrappedOverlay onClose={() => setIsWrappedOpen(false)} apiBase={API_BASE} token={token} />}</AnimatePresence></Suspense>
      <Suspense fallback={null}>
        <AnimatePresence>
          {isAiEnabled && isAuraDjOpen && (
            <LazyAuraDjOverlay
              onClose={() => setIsAuraDjOpen(false)}
              songs={allLibrarySongs.length > 0 ? allLibrarySongs : songs}
              token={token}
              playlists={playlists}
              activePlaylistId={activePlaylistId}
              onPlayQueue={handlePlayDjMix}
              onPlaylistCreated={() => {
                loadPlaylists();
                loadContent();
              }}
            />
          )}
        </AnimatePresence>
      </Suspense>

      {/* MODAL CREAR / EDITAR PLAYLIST */}
      <AnimatePresence>{isCreatePlaylistOpen && ( 
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md px-4 text-white">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#121212] border border-white/10 rounded-3xl p-6 sm:p-8 w-full max-w-md relative text-white shadow-2xl space-y-6"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-lg sm:text-xl font-bold uppercase tracking-wider text-white">
                {editingPlaylist ? "Editar Playlist" : "Nueva Playlist"}
              </h3>
              <button 
                type="button" 
                onClick={() => setIsCreatePlaylistOpen(false)} 
                className="text-white/40 hover:text-white p-1 rounded-full transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSavePlaylistModal} className="space-y-5">
              {/* PORTADA / FOTO DE PLAYLIST */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative group/pic w-32 h-32 rounded-2xl overflow-hidden border border-white/10 bg-white/5 shadow-inner flex items-center justify-center">
                  {playlistCoverPreview ? (
                    <>
                      <img 
                        src={playlistCoverPreview} 
                        alt="Playlist Cover" 
                        className="w-full h-full object-cover" 
                      />
                      <label 
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover/pic:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 cursor-pointer"
                        title="Cambiar foto"
                      >
                        <ImageIcon size={20} className="text-brand-primary" />
                        <span className="text-[10px] font-bold uppercase text-white">Cambiar</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setPlaylistCoverFile(file);
                              setPlaylistCoverPreview(URL.createObjectURL(file));
                              setPlaylistRemoveCover(false);
                            }
                          }} 
                        />
                      </label>
                    </>
                  ) : (
                    <label 
                      className="w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer text-white/40 hover:text-brand-primary hover:bg-white/[0.04] transition-all p-3 text-center"
                    >
                      <ImageIcon size={26} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Subir Foto</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setPlaylistCoverFile(file);
                            setPlaylistCoverPreview(URL.createObjectURL(file));
                            setPlaylistRemoveCover(false);
                          }
                        }} 
                      />
                    </label>
                  )}
                </div>

                {playlistCoverPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlaylistCoverFile(null);
                      setPlaylistCoverPreview(null);
                      setPlaylistRemoveCover(true);
                    }}
                    className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider cursor-pointer"
                  >
                    Quitar foto
                  </button>
                )}
              </div>

              {/* NOMBRE DE LA PLAYLIST */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  Nombre
                </label>
                <input 
                  type="text" 
                  placeholder="Ej. Lo-Fi Nocturno, Gym Beats..." 
                  required 
                  value={newPlaylistName} 
                  onChange={e => setNewPlaylistName(e.target.value)} 
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand-primary transition-all font-semibold" 
                />
              </div>

              {/* DESCRIPCIÓN */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  Descripción <span className="text-[9px] opacity-60 font-normal lowercase">(opcional)</span>
                </label>
                <textarea 
                  rows={3} 
                  placeholder="Describe el ambiente, género o temática de esta playlist..." 
                  value={newPlaylistDescription} 
                  onChange={e => setNewPlaylistDescription(e.target.value)} 
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand-primary transition-all font-sans resize-none" 
                />
              </div>

              {/* TOGGLE PLAYLIST COLABORATIVA */}
              <div className="pt-2 border-t border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-indigo-400" />
                      <label className="text-xs font-bold text-white cursor-pointer" htmlFor="collab-toggle">
                        Playlist Colaborativa
                      </label>
                    </div>
                    <p className="text-[11px] text-white/40">
                      Permite a otros usuarios añadir, quitar y reordenar canciones mediante un enlace.
                    </p>
                  </div>
                  <input
                    id="collab-toggle"
                    type="checkbox"
                    checked={newPlaylistIsCollaborative}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setNewPlaylistIsCollaborative(checked);
                      if (checked && editingPlaylist && (!editingPlaylist.invite_code || editingPlaylist.invite_code === 'null')) {
                        const activeToken = token || localStorage.getItem('aura_token');
                        try {
                          const res = await fetch(`${API_BASE}/api/playlists/${editingPlaylist.id}/invite-code`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${activeToken}` }
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setEditingPlaylist((prev: any) => prev ? { ...prev, invite_code: data.invite_code, is_collaborative: 1 } : prev);
                            setPlaylists(prev => prev.map(p => String(p.id) === String(editingPlaylist.id) ? { ...p, invite_code: data.invite_code, is_collaborative: 1 } : p));
                          }
                        } catch (err) {
                          console.error("Error auto-generating invite code:", err);
                        }
                      }
                    }}
                    className="w-4 h-4 rounded bg-white/10 border-white/20 accent-indigo-500 cursor-pointer"
                  />
                </div>

                {/* SECCIÓN INVITACIÓN Y COLABORADORES SI ESTÁ ACTIVA */}
                {newPlaylistIsCollaborative && editingPlaylist && (
                  <div className="p-3.5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-3 mt-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                        Enlace de invitación
                      </label>
                      <div className="flex items-center gap-2">
                        {editingPlaylist?.invite_code && editingPlaylist.invite_code !== 'null' ? (
                          <input
                            type="text"
                            readOnly
                            value={`${window.location.origin}/?playlist_invite=${editingPlaylist.invite_code}`}
                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/80 select-all outline-none"
                          />
                        ) : (
                          <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/40 italic flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin text-indigo-400" />
                            <span>Generando código de invitación...</span>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={!editingPlaylist?.invite_code || editingPlaylist.invite_code === 'null'}
                          onClick={() => {
                            if (!editingPlaylist?.invite_code) return;
                            const url = `${window.location.origin}/?playlist_invite=${editingPlaylist.invite_code}`;
                            navigator.clipboard.writeText(url);
                            setCopiedInvite(true);
                            setTimeout(() => setCopiedInvite(false), 2000);
                          }}
                          className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-40"
                        >
                          {copiedInvite ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                          <span>{copiedInvite ? "¡Copiado!" : "Copiar"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRegenerateInviteCode(editingPlaylist.id)}
                          title="Regenerar enlace (invalida el anterior)"
                          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
                        >
                          <RefreshCw size={13} />
                        </button>
                      </div>
                    </div>

                    {/* LISTA DE COLABORADORES */}
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                        Colaboradores actuales ({collaboratorsList.length})
                      </label>
                      {isLoadingCollaborators ? (
                        <div className="flex items-center gap-2 text-xs text-white/40 py-1">
                          <Loader2 size={12} className="animate-spin" />
                          <span>Cargando colaboradores...</span>
                        </div>
                      ) : collaboratorsList.length === 0 ? (
                        <p className="text-xs text-white/30 italic py-1">Aún no se ha unido ningún colaborador.</p>
                      ) : (
                        <div className="max-h-28 overflow-y-auto space-y-1 pr-1 scrollbar-hide">
                          {collaboratorsList.map((collab) => (
                            <div key={collab.id} className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-white/5 text-xs text-white/80">
                              <span className="font-medium">{collab.username}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCollaborator(editingPlaylist.id, collab.id)}
                                title="Expulsar colaborador"
                                className="text-red-400 hover:text-red-300 p-1 cursor-pointer transition-colors"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ACCIONES */}
              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  onClick={() => setIsCreatePlaylistOpen(false)} 
                  className="flex-1 text-[11px] font-bold uppercase py-3 rounded-xl border border-white/10 hover:bg-white/5 text-white/60 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSavingPlaylist || !newPlaylistName.trim()} 
                  className="flex-1 bg-brand-primary text-black py-3 rounded-xl font-bold uppercase text-[11px] shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isSavingPlaylist ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>{editingPlaylist ? "Guardar cambios" : "Crear playlist"}</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div> 
      )}</AnimatePresence>

      {/* MODAL UNIRSE A PLAYLIST COLABORATIVA */}
      <AnimatePresence>{isJoinPlaylistModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md px-4 text-white">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#121212] border border-white/10 rounded-3xl p-6 sm:p-8 w-full max-w-md relative text-white shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Users size={18} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">Unirse a Playlist</h3>
                  <p className="text-xs text-white/40">Colabora añadiendo tu música favorita</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsJoinPlaylistModalOpen(false)}
                className="text-white/40 hover:text-white p-1 rounded-full transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  Código o enlace de invitación
                </label>
                <input
                  type="text"
                  placeholder="Pega el enlace o introduce el código (ej. 3F8B1A...)"
                  value={manualJoinCode}
                  onChange={(e) => setManualJoinCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      let code = manualJoinCode.trim();
                      if (code.includes('invite=')) {
                        try {
                          const url = new URL(code);
                          code = url.searchParams.get('playlist_invite') || url.searchParams.get('invite') || code;
                        } catch {}
                      }
                      handleJoinPlaylistByCode(code);
                    }
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-400 transition-all font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsJoinPlaylistModalOpen(false)}
                  className="flex-1 text-[11px] font-bold uppercase py-3 rounded-xl border border-white/10 hover:bg-white/5 text-white/60 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isJoiningPlaylist || !manualJoinCode.trim()}
                  onClick={() => {
                    let code = manualJoinCode.trim();
                    if (code.includes('invite=')) {
                      try {
                        const url = new URL(code);
                        code = url.searchParams.get('playlist_invite') || url.searchParams.get('invite') || code;
                      } catch {}
                    }
                    handleJoinPlaylistByCode(code);
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-bold uppercase text-[11px] shadow-lg transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isJoiningPlaylist ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Uniéndose...</span>
                    </>
                  ) : (
                    <span>Unirse</span>
                  )}
                </button>
              </div>
            </div>
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
                  <div className="flex items-center gap-3 relative">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0 relative group">
                      {newEditCover ? (
                        <img src={URL.createObjectURL(newEditCover)} className="w-full h-full object-cover" />
                      ) : (
                        <img src={songToEdit.coverUrl} className="w-full h-full object-cover" />
                      )}
                      {(songToEdit.coverUrl || newEditCover) && (
                        <button
                          type="button"
                          onClick={() => setSongToEdit({...songToEdit, coverUrl: ''})}
                          className="absolute bottom-1 right-1 p-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                          title="Borrar portada"
                        >
                          <X size={10} />
                        </button>
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
                  <div className="flex items-center gap-3 relative">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0 relative group">
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
                      {(songToEdit.animated_cover_path || newEditAnimatedCover) && (
                        <button
                          type="button"
                          onClick={() => setSongToEdit({...songToEdit, animated_cover_path: ''})}
                          className="absolute bottom-1 right-1 p-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                          title="Borrar portada animada"
                        >
                          <X size={10} />
                        </button>
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

      {/* MODAL DE ACTUALIZACIÓN AUTOMÁTICA */}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={dismissUpdate}
        updateInfo={updateInfo}
        currentVersion={currentVersion}
        isWhatsNew={isWhatsNewModal}
      />
    </div>
  );
}