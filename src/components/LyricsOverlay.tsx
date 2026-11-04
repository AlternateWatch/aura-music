import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useAudioPlaybackTime } from '../hooks/useAudioEngine';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Music2, Loader2, Play, Pause, RotateCcw, Plus, Trash2, 
  Check, Clock, Edit3, Save, Sparkles, ChevronRight,
  FastForward, Rewind, FileText, BookOpen, Quote, ExternalLink,
  MessageSquarePlus, User
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { type Song } from '../constants';
import { API_BASE, DEFAULT_COVER } from '../utils/api';

interface LyricsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentSong: Song | null;
  currentTime: number;
  onSeek: (time: number) => void;
  getCurrentTime: () => number;
  subscribeToTime: (listener: () => void) => () => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  duration?: number;
  userRole?: string;
}

export interface LyricLine {
  id?: string;
  time: number;
  text: string;
}

export interface EditableLyricLine {
  id: string;
  time: number | null;
  text: string;
}

export interface TrackInterviewQuote {
  id: string;
  quote: string;
  source: string;
  url?: string;
}

export interface LineAnnotation {
  key: string;
  lineIndex?: number;
  lineText: string;
  content: string;
  quote?: string;
  quoteSource?: string;
  quoteUrl?: string;
  updatedAt?: string;
}

export interface TrackLoreData {
  summary?: string;
  artistReflection?: string;
  interviews?: TrackInterviewQuote[];
  annotations?: Record<string, LineAnnotation>;
  updatedAt?: string;
}

const lyricsSessionCache = new Map<string, { synced?: string; plain?: string; lore?: TrackLoreData | null }>();

const normalizeVerseKey = (text: string): string => {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const cleanSongTitle = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|with|prod\.?|official|video|audio|lyrics|visualizer|remaster(?:ed)?|live|version|edit)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:remaster(?:ed)?|live|single|version|edit|mix).*$/gi, '')
    .trim();
};

const cleanArtistName = (artist: string): string => {
  if (!artist) return '';
  return artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bwith\b/i)[0]
    .trim();
};

const fetchJsonWithTimeout = async (url: string, timeoutMs = 5500): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const LyricsOverlay: React.FC<LyricsOverlayProps> = ({ 
  isOpen, 
  onClose, 
  currentSong, 
  currentTime, 
  onSeek, 
  getCurrentTime, 
  subscribeToTime,
  isPlaying = false,
  onTogglePlay,
  duration = 0,
  userRole
}) => {
  const liveCurrentTime = useAudioPlaybackTime(getCurrentTime, subscribeToTime);

  // Verificar si es Web/Escritorio (no app nativa Android ni pantalla móvil) y si el usuario es admin o moderador
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktopViewport(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const canEditLyrics = useMemo(() => {
    if (Capacitor.isNativePlatform() || !isDesktopViewport) return false;
    let role = userRole;
    if (!role) {
      try {
        const tokenValue = localStorage.getItem('aura_token');
        if (tokenValue) {
          const payload = JSON.parse(atob(tokenValue.split('.')[1]));
          role = payload?.role;
        }
      } catch {}
    }
    return role === 'admin' || role === 'moderator';
  }, [userRole, isDesktopViewport]);

  // Tab activo: 'view' (karaoke) o 'editor' (sincronizador manual)
  const [activeTab, setActiveTab] = useState<'view' | 'editor'>('view');

  useEffect(() => {
    if (!canEditLyrics && activeTab === 'editor') {
      setActiveTab('view');
    }
  }, [canEditLyrics, activeTab]);

  // Estado de letras en vista karaoke
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(1);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Estado del Lore / Trasfondo y Anotaciones estilo Genius
  const [loreData, setLoreData] = useState<TrackLoreData>({});
  const [isLoreDrawerOpen, setIsLoreDrawerOpen] = useState(false);
  const [isEditingLore, setIsEditingLore] = useState(false);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftArtistReflection, setDraftArtistReflection] = useState('');
  const [draftInterviews, setDraftInterviews] = useState<TrackInterviewQuote[]>([]);
  const [isSavingLore, setIsSavingLore] = useState(false);

  // Estado de la anotación por frase seleccionada (estilo Genius)
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<{ index: number; text: string; time: number } | null>(null);
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false);
  const [draftAnnotationContent, setDraftAnnotationContent] = useState('');
  const [draftAnnotationQuote, setDraftAnnotationQuote] = useState('');
  const [draftAnnotationQuoteSource, setDraftAnnotationQuoteSource] = useState('');
  const [draftAnnotationQuoteUrl, setDraftAnnotationQuoteUrl] = useState('');

  // Estado del editor manual frase a frase
  const [editorLines, setEditorLines] = useState<EditableLyricLine[]>([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Modal para pegar texto en masa
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const editorListRef = useRef<HTMLDivElement>(null);
  const lineInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Limpieza de caracteres raros / apostrofes tipográficos
  const sanitizeText = (text: string) => {
    if (!text) return "";
    return text
      .replace(/[\u2018\u2019\u02bc\u02bb\u00ff\ufffd\u00b4\u02b9\u02ba]/g, "'")
      .replace(/[\u201c\u201d\u201f\u201e]/g, '"')
      .replace(/\u00a0/g, " ")
      .replace(/(\w)\?(\s?\w)/g, "$1'$2")
      .trim();
  };

  const formatTimestamp = (seconds: number | null) => {
    if (seconds === null || isNaN(seconds) || seconds < 0) return "--:--.-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const wholeSecs = Math.floor(secs);
    const tenths = Math.floor((secs - wholeSecs) * 10);
    return `${mins.toString().padStart(2, '0')}:${wholeSecs.toString().padStart(2, '0')}.${tenths}`;
  };

  // Obtener la anotación de una frase si existe
  const getLineAnnotation = (index: number, text: string): LineAnnotation | null => {
    const map = loreData?.annotations;
    if (!map) return null;
    const norm = normalizeVerseKey(text);
    if (!norm) return null;
    const exactKey = `${index}::${norm}`;
    if (map[exactKey] && map[exactKey].content?.trim()) return map[exactKey];
    if (map[norm] && map[norm].content?.trim()) return map[norm];
    return null;
  };

  const hasLoreContent = useMemo(() => {
    return Boolean(
      (loreData?.summary && loreData.summary.trim().length > 0) ||
      (loreData?.artistReflection && loreData.artistReflection.trim().length > 0) ||
      (loreData?.interviews && loreData.interviews.length > 0)
    );
  }, [loreData]);

  const annotationsCount = useMemo(() => {
    if (!loreData?.annotations) return 0;
    return Object.values(loreData.annotations).filter(a => a && a.content?.trim()).length;
  }, [loreData]);

  // Parsear formato LRC a líneas
  const parseLRC = (lrcContent: string): LyricLine[] => {
    const lines = lrcContent.split('\n');
    const parsed: LyricLine[] = [];
    const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/;

    lines.forEach((line, idx) => {
      const match = timeRegex.exec(line);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseFloat(match[2]);
        const time = minutes * 60 + seconds;
        const rawText = line.replace(timeRegex, '').trim();
        const text = sanitizeText(rawText);
        if (text) parsed.push({ id: `lrc-${idx}-${time}`, time, text });
      }
    });

    if (parsed.length > 0) {
      return parsed.sort((a, b) => a.time - b.time);
    }

    // Fallback para texto plano
    return lrcContent
      .split('\n')
      .map((text, index) => ({
        id: `plain-${index}`,
        time: index * 4,
        text: sanitizeText(text)
      }))
      .filter(l => l.text);
  };

  // Convertir líneas de editor a texto LRC estándar
  const linesToLrc = (lines: EditableLyricLine[]): string => {
    return lines
      .filter(l => l.text.trim().length > 0)
      .map(l => {
        const t = l.time !== null && l.time >= 0 ? l.time : 0;
        const mins = Math.floor(t / 60);
        const secs = (t % 60).toFixed(2);
        const padMins = mins.toString().padStart(2, '0');
        const padSecs = secs.padStart(5, '0');
        return `[${padMins}:${padSecs}] ${l.text.trim()}`;
      })
      .join('\n');
  };

  // Cargar letras y lore con hasta 4 intentos
  useEffect(() => {
    if (!isOpen || !currentSong) return;

    let isMounted = true;
    const MAX_ATTEMPTS = 4;

    setActiveAnnotationLine(null);
    setIsEditingAnnotation(false);
    setIsLoreDrawerOpen(false);
    setIsEditingLore(false);

    const applySyncedLyrics = (rawSynced: string, remoteLore?: TrackLoreData | null) => {
      if (!isMounted) return;
      const prevCache = lyricsSessionCache.get(currentSong.id);
      const mergedLore = remoteLore !== undefined ? remoteLore : (prevCache?.lore || {});
      lyricsSessionCache.set(currentSong.id, { synced: rawSynced, lore: mergedLore });
      if (mergedLore) setLoreData(mergedLore);
      const parsed = parseLRC(rawSynced);
      setLyrics(parsed);
      initEditorFromLyrics(parsed);
      setError(null);
      setIsLoading(false);
    };

    const applyPlainLyrics = (rawPlain: string, remoteLore?: TrackLoreData | null) => {
      if (!isMounted) return;
      const prevCache = lyricsSessionCache.get(currentSong.id);
      const mergedLore = remoteLore !== undefined ? remoteLore : (prevCache?.lore || {});
      lyricsSessionCache.set(currentSong.id, { plain: rawPlain, lore: mergedLore });
      if (mergedLore) setLoreData(mergedLore);
      const plainLines = rawPlain
        .split('\n')
        .map((t: string) => sanitizeText(t))
        .filter(Boolean);
      const parsed = plainLines.map((t: string, idx: number) => ({
        id: `plain-${idx}`,
        time: idx * 4,
        text: t
      }));
      setLyrics(parsed);
      initEditorFromPlainLines(plainLines);
      setError(null);
      setIsLoading(false);
    };

    const pickBestSearchResult = (results: any[]): { synced?: string; plain?: string } | null => {
      if (!Array.isArray(results) || results.length === 0) return null;
      const syncedMatch = results.find(r => r && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim().length > 0);
      if (syncedMatch) return { synced: syncedMatch.syncedLyrics };
      const plainMatch = results.find(r => r && typeof r.plainLyrics === 'string' && r.plainLyrics.trim().length > 0);
      if (plainMatch) return { plain: plainMatch.plainLyrics };
      return null;
    };

    const fetchLyricsWithRetries = async () => {
      setIsLoading(true);
      setError(null);
      setRetryAttempt(1);
      setLoreData({});

      // 0. Comprobar caché en memoria de la sesión (si no es un reintento manual forzado)
      if (retryTrigger === 0 && lyricsSessionCache.has(currentSong.id)) {
        const cached = lyricsSessionCache.get(currentSong.id)!;
        if (cached.lore) setLoreData(cached.lore);
        if (cached.synced) {
          applySyncedLyrics(cached.synced, cached.lore);
          return;
        }
        if (cached.plain) {
          applyPlainLyrics(cached.plain, cached.lore);
          return;
        }
      }

      let plainFallbackCandidate: string | null = null;
      let loadedLore: TrackLoreData | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!isMounted) return;
        setRetryAttempt(attempt);

        // 1. Consultar la API de Aura (incluye letras personalizadas, lore/anotaciones y búsqueda desde el servidor)
        const auraData = await fetchJsonWithTimeout(`${API_BASE}/api/tracks/${currentSong.id}/lyrics`, 6000);
        if (!isMounted) return;
        if (auraData?.lore && typeof auraData.lore === 'object') {
          loadedLore = auraData.lore;
          setLoreData(auraData.lore);
        }
        if (auraData?.lyrics && String(auraData.lyrics).trim().length > 0) {
          applySyncedLyrics(auraData.lyrics, loadedLore);
          return;
        }
        if (auraData?.plainLyrics && String(auraData.plainLyrics).trim().length > 0) {
          plainFallbackCandidate = auraData.plainLyrics;
        }

        // 2. Intentar lrclib /api/get
        const getParams = new URLSearchParams({
          artist_name: currentSong.artist,
          track_name: currentSong.title
        });
        if (currentSong.album && currentSong.album.trim()) {
          getParams.append('album_name', currentSong.album.trim());
        }
        if (duration && duration > 0) {
          getParams.append('duration', String(Math.round(duration)));
        }

        const getData = await fetchJsonWithTimeout(`https://lrclib.net/api/get?${getParams.toString()}`, 5000);
        if (!isMounted) return;
        if (getData?.syncedLyrics) {
          applySyncedLyrics(getData.syncedLyrics, loadedLore);
          return;
        }
        if (getData?.plainLyrics && !plainFallbackCandidate) {
          plainFallbackCandidate = getData.plainLyrics;
        }

        // 3. Intentar lrclib /api/search estructurado (track_name + artist_name)
        const structuredSearchParams = new URLSearchParams({
          track_name: currentSong.title,
          artist_name: currentSong.artist
        });
        const structuredResults = await fetchJsonWithTimeout(`https://lrclib.net/api/search?${structuredSearchParams.toString()}`, 5500);
        if (!isMounted) return;
        const bestStructured = pickBestSearchResult(structuredResults);
        if (bestStructured?.synced) {
          applySyncedLyrics(bestStructured.synced, loadedLore);
          return;
        }
        if (bestStructured?.plain && !plainFallbackCandidate) {
          plainFallbackCandidate = bestStructured.plain;
        }

        // 4. Intentar lrclib /api/search por consulta libre (q = artist + title)
        const rawQueryResults = await fetchJsonWithTimeout(
          `https://lrclib.net/api/search?q=${encodeURIComponent(`${currentSong.artist} ${currentSong.title}`)}`,
          5500
        );
        if (!isMounted) return;
        const bestRaw = pickBestSearchResult(rawQueryResults);
        if (bestRaw?.synced) {
          applySyncedLyrics(bestRaw.synced, loadedLore);
          return;
        }
        if (bestRaw?.plain && !plainFallbackCandidate) {
          plainFallbackCandidate = bestRaw.plain;
        }

        // 5. Intentar con título y artista limpios
        const cleanedTitle = cleanSongTitle(currentSong.title);
        const cleanedArtist = cleanArtistName(currentSong.artist);
        if (cleanedTitle && cleanedArtist && (cleanedTitle !== currentSong.title || cleanedArtist !== currentSong.artist)) {
          const cleanResults = await fetchJsonWithTimeout(
            `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanedArtist} ${cleanedTitle}`)}`,
            5500
          );
          if (!isMounted) return;
          const bestClean = pickBestSearchResult(cleanResults);
          if (bestClean?.synced) {
            applySyncedLyrics(bestClean.synced, loadedLore);
            return;
          }
          if (bestClean?.plain && !plainFallbackCandidate) {
            plainFallbackCandidate = bestClean.plain;
          }
        }

        if (plainFallbackCandidate && attempt >= 2) {
          applyPlainLyrics(plainFallbackCandidate, loadedLore);
          return;
        }

        if (attempt < MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 650 * attempt));
        }
      }

      if (!isMounted) return;

      if (plainFallbackCandidate) {
        applyPlainLyrics(plainFallbackCandidate, loadedLore);
        return;
      }

      setLyrics([]);
      setError("No se encontraron letras para esta canción.");
      initEmptyEditor();
      setIsLoading(false);
    };

    fetchLyricsWithRetries();

    return () => {
      isMounted = false;
    };
  }, [currentSong?.id, isOpen, retryTrigger]);

  // Guardar objeto Lore completo en el servidor
  const saveLoreToServer = async (updatedLore: TrackLoreData): Promise<boolean> => {
    if (!currentSong) return false;
    setIsSavingLore(true);
    try {
      const token = localStorage.getItem('aura_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/tracks/${currentSong.id}/lore`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ lore: updatedLore })
      });

      if (!res.ok) throw new Error("Error guardando lore");

      setLoreData(updatedLore);
      const cached = lyricsSessionCache.get(currentSong.id) || {};
      lyricsSessionCache.set(currentSong.id, { ...cached, lore: updatedLore });
      return true;
    } catch (e) {
      console.error("Error guardando lore/anotación:", e);
      return false;
    } finally {
      setIsSavingLore(false);
    }
  };

  // Abrir panel de Trasfondo / Lore
  const handleOpenLoreDrawer = (startInEdit = false) => {
    setDraftSummary(loreData?.summary || '');
    setDraftArtistReflection(loreData?.artistReflection || '');
    setDraftInterviews(loreData?.interviews ? [...loreData.interviews] : []);
    setIsEditingLore(startInEdit && canEditLyrics);
    setActiveAnnotationLine(null);
    setIsLoreDrawerOpen(true);
  };

  const handleSaveLore = async () => {
    const cleanedInterviews = draftInterviews
      .map(i => ({ ...i, quote: i.quote.trim(), source: i.source.trim(), url: i.url?.trim() || undefined }))
      .filter(i => i.quote.length > 0);

    const updated: TrackLoreData = {
      ...loreData,
      summary: draftSummary.trim() || undefined,
      artistReflection: draftArtistReflection.trim() || undefined,
      interviews: cleanedInterviews,
      updatedAt: new Date().toISOString()
    };

    const ok = await saveLoreToServer(updated);
    if (ok) {
      setIsEditingLore(false);
    }
  };

  // Abrir anotación de una frase (estilo Genius)
  const handleOpenLineAnnotation = (index: number, line: LyricLine, startInEdit = false) => {
    const existing = getLineAnnotation(index, line.text);
    setActiveAnnotationLine({ index, text: line.text, time: line.time });
    setDraftAnnotationContent(existing?.content || '');
    setDraftAnnotationQuote(existing?.quote || '');
    setDraftAnnotationQuoteSource(existing?.quoteSource || '');
    setDraftAnnotationQuoteUrl(existing?.quoteUrl || '');
    setIsEditingAnnotation((startInEdit || !existing) && canEditLyrics);
    setIsLoreDrawerOpen(false);
  };

  const handleSaveLineAnnotation = async () => {
    if (!activeAnnotationLine) return;
    const norm = normalizeVerseKey(activeAnnotationLine.text);
    const exactKey = `${activeAnnotationLine.index}::${norm}`;
    const nextAnnotations = { ...(loreData.annotations || {}) };

    if (!draftAnnotationContent.trim()) {
      delete nextAnnotations[exactKey];
      delete nextAnnotations[norm];
    } else {
      const annotationObj: LineAnnotation = {
        key: exactKey,
        lineIndex: activeAnnotationLine.index,
        lineText: activeAnnotationLine.text,
        content: draftAnnotationContent.trim(),
        quote: draftAnnotationQuote.trim() || undefined,
        quoteSource: draftAnnotationQuoteSource.trim() || undefined,
        quoteUrl: draftAnnotationQuoteUrl.trim() || undefined,
        updatedAt: new Date().toISOString()
      };
      nextAnnotations[exactKey] = annotationObj;
      nextAnnotations[norm] = annotationObj;
    }

    const updated: TrackLoreData = {
      ...loreData,
      annotations: nextAnnotations,
      updatedAt: new Date().toISOString()
    };

    const ok = await saveLoreToServer(updated);
    if (ok) {
      if (!draftAnnotationContent.trim()) {
        setActiveAnnotationLine(null);
      } else {
        setIsEditingAnnotation(false);
      }
    }
  };

  const handleDeleteLineAnnotation = async () => {
    if (!activeAnnotationLine) return;
    const norm = normalizeVerseKey(activeAnnotationLine.text);
    const exactKey = `${activeAnnotationLine.index}::${norm}`;
    const nextAnnotations = { ...(loreData.annotations || {}) };
    delete nextAnnotations[exactKey];
    delete nextAnnotations[norm];

    const updated: TrackLoreData = {
      ...loreData,
      annotations: nextAnnotations,
      updatedAt: new Date().toISOString()
    };

    const ok = await saveLoreToServer(updated);
    if (ok) {
      setActiveAnnotationLine(null);
      setIsEditingAnnotation(false);
    }
  };

  // Inicializar editor desde letras parseadas
  const initEditorFromLyrics = (parsed: LyricLine[]) => {
    try {
      const draft = localStorage.getItem(`aura_lyrics_draft_${currentSong?.id}`);
      if (draft) {
        const parsedDraft = JSON.parse(draft);
        if (Array.isArray(parsedDraft) && parsedDraft.length > 0) {
          setEditorLines(parsedDraft);
          return;
        }
      }
    } catch {}

    const mapped: EditableLyricLine[] = parsed.map((l, i) => ({
      id: l.id || `line-${i}-${Date.now()}`,
      time: l.time,
      text: l.text
    }));
    setEditorLines(mapped.length > 0 ? mapped : [{ id: `line-0-${Date.now()}`, time: null, text: '' }]);
  };

  const initEditorFromPlainLines = (lines: string[]) => {
    const mapped: EditableLyricLine[] = lines.map((text, i) => ({
      id: `line-${i}-${Date.now()}`,
      time: null,
      text
    }));
    setEditorLines(mapped.length > 0 ? mapped : [{ id: `line-0-${Date.now()}`, time: null, text: '' }]);
  };

  const initEmptyEditor = () => {
    try {
      const draft = localStorage.getItem(`aura_lyrics_draft_${currentSong?.id}`);
      if (draft) {
        const parsedDraft = JSON.parse(draft);
        if (Array.isArray(parsedDraft) && parsedDraft.length > 0) {
          setEditorLines(parsedDraft);
          return;
        }
      }
    } catch {}

    setEditorLines([
      { id: `line-0-${Date.now()}`, time: null, text: '' }
    ]);
  };

  // Guardar borrador en localStorage cuando cambie el editor
  useEffect(() => {
    if (!currentSong?.id || editorLines.length === 0) return;
    try {
      localStorage.setItem(`aura_lyrics_draft_${currentSong.id}`, JSON.stringify(editorLines));
    } catch {}
  }, [editorLines, currentSong?.id]);

  // Auto-scroll en la vista de karaoke
  useEffect(() => {
    if (activeTab === 'view' && activeLineRef.current && scrollContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [liveCurrentTime, lyrics, activeTab]);

  // Scroll automático a la línea activa en el editor
  const scrollToEditorLine = (index: number) => {
    if (index >= 0 && index < editorLines.length) {
      const line = editorLines[index];
      const el = lineInputRefs.current.get(line.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  // Acciones del editor
  const handleAddLine = (afterIndex?: number) => {
    const newLine: EditableLyricLine = {
      id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      time: null,
      text: ''
    };

    setEditorLines(prev => {
      const next = [...prev];
      if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < next.length) {
        next.splice(afterIndex + 1, 0, newLine);
      } else {
        next.push(newLine);
      }
      return next;
    });

    const targetIndex = afterIndex !== undefined ? afterIndex + 1 : editorLines.length;
    setSelectedLineIndex(targetIndex);

    setTimeout(() => {
      const input = lineInputRefs.current.get(newLine.id);
      input?.focus();
    }, 50);
  };

  const handleUpdateLineText = (id: string, text: string) => {
    setEditorLines(prev => prev.map(l => l.id === id ? { ...l, text } : l));
  };

  const handleDeleteLine = (id: string) => {
    setEditorLines(prev => {
      const filtered = prev.filter(l => l.id !== id);
      return filtered.length > 0 ? filtered : [{ id: `line-0-${Date.now()}`, time: null, text: '' }];
    });
    setSelectedLineIndex(prev => Math.max(0, prev - 1));
  };

  // Sincronizar la línea seleccionada con el tiempo actual y saltar a la siguiente
  const handleSyncCurrentLine = () => {
    if (editorLines.length === 0) return;
    const index = Math.min(Math.max(0, selectedLineIndex), editorLines.length - 1);

    const stampTime = Number(liveCurrentTime.toFixed(2));

    setEditorLines(prev => prev.map((l, i) => i === index ? { ...l, time: stampTime } : l));

    if (index + 1 < editorLines.length) {
      const nextIndex = index + 1;
      setSelectedLineIndex(nextIndex);
      scrollToEditorLine(nextIndex);
    }
  };

  const handleSetLineTime = (id: string, time: number) => {
    setEditorLines(prev => prev.map(l => l.id === id ? { ...l, time: Number(time.toFixed(2)) } : l));
  };

  const handleNudgeTime = (id: string, delta: number) => {
    setEditorLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const base = l.time !== null ? l.time : liveCurrentTime;
      const newTime = Math.max(0, Number((base + delta).toFixed(2)));
      return { ...l, time: newTime };
    }));
  };

  const handleResetTimings = () => {
    if (window.confirm("¿Seguro que deseas reiniciar todos los tiempos y sincronizarlos desde cero?")) {
      setEditorLines(prev => prev.map(l => ({ ...l, time: null })));
      setSelectedLineIndex(0);
      scrollToEditorLine(0);
    }
  };

  const handleApplyPastedText = () => {
    if (!pastedText.trim()) return;

    const rawLines = pastedText
      .split('\n')
      .map(l => sanitizeText(l))
      .filter(l => l.length > 0);

    if (rawLines.length === 0) return;

    const hasLrcTags = /\[\d+:\d+(?:\.\d+)?\]/.test(pastedText);

    if (hasLrcTags) {
      const parsed = parseLRC(pastedText);
      const mapped: EditableLyricLine[] = parsed.map((p, i) => ({
        id: `pasted-${i}-${Date.now()}`,
        time: p.time,
        text: p.text
      }));
      setEditorLines(mapped);
    } else {
      const newLines: EditableLyricLine[] = rawLines.map((text, i) => ({
        id: `pasted-${i}-${Date.now()}`,
        time: null,
        text
      }));
      setEditorLines(newLines);
    }

    setSelectedLineIndex(0);
    setIsPasteModalOpen(false);
    setPastedText('');
  };

  // Guardar letras en el servidor
  const handleSaveLyrics = async () => {
    if (!currentSong) return;

    const validLines = editorLines.filter(l => l.text.trim().length > 0);
    if (validLines.length === 0) {
      setSaveError("Añade al menos una frase antes de guardar.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const lrcString = linesToLrc(editorLines);
      const token = localStorage.getItem('aura_token');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/tracks/${currentSong.id}/lyrics`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ lyrics: lrcString })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al guardar en el servidor");
      }

      const prevCache = lyricsSessionCache.get(currentSong.id);
      lyricsSessionCache.set(currentSong.id, { synced: lrcString, lore: prevCache?.lore || loreData });
      const newParsed = parseLRC(lrcString);
      setLyrics(newParsed);
      setError(null);
      setSaveSuccess(true);

      try {
        localStorage.removeItem(`aura_lyrics_draft_${currentSong.id}`);
      } catch {}

      setTimeout(() => {
        setActiveTab('view');
        setSaveSuccess(false);
      }, 1200);

    } catch (err: any) {
      console.error("Error guardando letras:", err);
      setSaveError(err.message || "Error al guardar las letras.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Índice de línea activa en la vista karaoke
  const activeKaraokeIndex = lyrics.reduce((prev, curr, idx) => {
    return curr.time <= liveCurrentTime ? idx : prev;
  }, -1);

  const syncedCount = editorLines.filter(l => l.time !== null).length;
  const activeAnnotationObj = activeAnnotationLine
    ? getLineAnnotation(activeAnnotationLine.index, activeAnnotationLine.text)
    : null;

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex flex-col font-sans select-none text-white overflow-hidden"
    >
      {/* Header */}
      <div className="h-20 md:h-24 flex items-center justify-between px-4 md:px-10 shrink-0 border-b border-white/10 bg-black/40">
        {/* Info Canción */}
        <div className="flex items-center gap-3 md:gap-5 min-w-0 max-w-[60%]">
          <img 
            src={currentSong?.coverUrl || DEFAULT_COVER} 
            onError={(e) => {
              if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                e.currentTarget.src = DEFAULT_COVER;
              }
            }}
            className="w-10 h-10 md:w-12 md:h-12 rounded-xl shadow-2xl border border-white/10 object-cover shrink-0" 
            alt="" 
          />
          <div className="min-w-0">
            <h2 className="text-sm md:text-lg font-bold text-white tracking-tight truncate uppercase font-serif italic">
              {currentSong?.title}
            </h2>
            <p className="text-[10px] md:text-xs text-white/50 font-bold uppercase tracking-[0.2em] truncate">
              {currentSong?.artist}
            </p>
          </div>
        </div>

        {/* Acciones Derecha (Botón Trasfondo/Lore + Volver a letras + Cerrar) */}
        <div className="flex items-center gap-2.5 md:gap-3 shrink-0">
          {(hasLoreContent || canEditLyrics) && activeTab === 'view' && (
            <button
              onClick={() => handleOpenLoreDrawer(false)}
              className={`flex items-center gap-2 px-3.5 py-2 md:px-4 md:py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isLoreDrawerOpen
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 shadow-lg shadow-amber-500/10'
                  : hasLoreContent
                  ? 'bg-white/10 hover:bg-white/15 border-amber-400/30 text-amber-200/90 hover:text-white'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white'
              }`}
              title="Trasfondo de la canción, entrevistas y reflexión sobre el artista"
            >
              <BookOpen size={15} className={hasLoreContent ? "text-amber-400" : ""} />
              <span className="hidden sm:inline">Trasfondo</span>
              {hasLoreContent && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          )}

          {canEditLyrics && activeTab === 'editor' && (
            <button
              onClick={() => setActiveTab('view')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-bold text-white transition-all cursor-pointer"
              title="Volver a la vista de letras"
            >
              <Music2 size={15} />
              <span>Ver letras</span>
            </button>
          )}

          <button 
            onClick={onClose} 
            className="p-2.5 md:p-3 bg-white/5 hover:bg-white/10 active:scale-95 rounded-full transition-all text-white/60 hover:text-white cursor-pointer shrink-0"
            title="Cerrar (Esc)"
          >
            <X size={20} className="md:w-6 md:h-6" />
          </button>
        </div>
      </div>

      {/* CUERPO: VISTA KARAOKE + ANOTACIONES ESTILO GENIUS */}
      {activeTab === 'view' && (
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 md:px-10 py-28 flex flex-col items-center scrollbar-hide relative"
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 my-auto opacity-60">
              <Loader2 className="animate-spin text-purple-400" size={36} />
              <p className="text-xs font-bold uppercase tracking-widest text-white/80">
                {retryAttempt > 1 
                  ? `Buscando letras sincronizadas... (Intento ${retryAttempt}/4)` 
                  : 'Buscando letras sincronizadas...'}
              </p>
            </div>
          ) : error || lyrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center my-auto max-w-md p-8 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-xl shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-5 text-purple-400">
                <Music2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Sin letras sincronizadas</h3>
              <p className="text-sm text-white/50 mb-6 leading-relaxed">
                No se encontraron letras tras 4 intentos de búsqueda.
              </p>
              <div className="flex items-center justify-center gap-3 w-full">
                <button
                  onClick={() => setRetryTrigger(prev => prev + 1)}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold text-sm transition-all cursor-pointer"
                >
                  <RotateCcw size={16} />
                  <span>Reintentar</span>
                </button>
                {hasLoreContent && (
                  <button
                    onClick={() => handleOpenLoreDrawer(false)}
                    className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-amber-200 font-bold text-sm transition-all cursor-pointer"
                  >
                    <BookOpen size={16} />
                    <span>Ver trasfondo</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full max-w-4xl space-y-10 md:space-y-12 pb-20">
              {annotationsCount > 0 && (
                <div className="flex justify-center mb-4">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-400/20 text-amber-200/80 text-[11px] font-semibold tracking-wide">
                    <Sparkles size={12} className="text-amber-400" />
                    <span>Toca los versos subrayados para leer su análisis y referencias</span>
                  </div>
                </div>
              )}

              {lyrics.map((line, index) => {
                const isActive = index === activeKaraokeIndex;
                const isPast = index < activeKaraokeIndex;
                const annotation = getLineAnnotation(index, line.text);
                const isAnnotated = Boolean(annotation);

                return (
                  <div
                    key={line.id || index}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => {
                      if (isAnnotated) {
                        handleOpenLineAnnotation(index, line, false);
                      } else {
                        onSeek(line.time);
                      }
                    }}
                    className={`
                      group relative cursor-pointer transition-all duration-500 ease-out text-center select-none py-1.5 flex flex-col items-center justify-center
                      ${isActive ? 'text-white scale-105 md:scale-110 drop-shadow-[0_0_25px_rgba(255,255,255,0.4)]' : isPast ? 'text-white/25 hover:text-white/50' : 'text-white/45 hover:text-white/80'}
                    `}
                  >
                    <div className={`
                      relative inline-flex items-center gap-3 px-4 py-1.5 rounded-2xl transition-all
                      ${isAnnotated 
                        ? 'bg-amber-500/[0.12] hover:bg-amber-500/[0.22] border-b-2 border-amber-400/70 shadow-lg shadow-amber-500/5' 
                        : ''
                      }
                    `}>
                      <p className={`
                        text-2xl md:text-4xl lg:text-5xl font-black tracking-tight leading-snug
                        ${isActive ? 'opacity-100 blur-none font-black' : 'opacity-85 blur-[0.4px] font-bold'}
                        ${isAnnotated && !isActive ? 'text-amber-100/90' : ''}
                      `}>
                        {line.text}
                      </p>

                      {isAnnotated && (
                        <span 
                          className="shrink-0 w-6 h-6 md:w-7 md:h-7 rounded-lg bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow-sm"
                          title="Este verso tiene una anotación / análisis"
                        >
                          <BookOpen size={13} />
                        </span>
                      )}

                      {/* Botón rápido en hover para Admins/Moderadores en Web/Escritorio para anotar cualquier frase */}
                      {canEditLyrics && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenLineAnnotation(index, line, true);
                          }}
                          className={`
                            opacity-0 group-hover:opacity-100 transition-opacity ml-2 p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer
                            ${isAnnotated 
                              ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30' 
                              : 'bg-white/10 border-white/15 text-white/70 hover:text-white hover:bg-white/20'
                            }
                          `}
                          title={isAnnotated ? "Editar anotación de esta frase" : "Añadir anotación estilo Genius a esta frase"}
                        >
                          <MessageSquarePlus size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Ficha resumen de Trasfondo al final de las letras si existe contenido */}
              {hasLoreContent && (
                <div className="pt-16 max-w-2xl mx-auto w-full">
                  <div 
                    onClick={() => handleOpenLoreDrawer(false)}
                    className="p-6 md:p-8 rounded-3xl bg-gradient-to-br from-amber-500/[0.08] via-white/[0.03] to-purple-500/[0.08] border border-amber-400/20 hover:border-amber-400/40 transition-all cursor-pointer shadow-2xl group"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5 text-amber-300 text-xs font-bold uppercase tracking-[0.2em]">
                        <BookOpen size={16} />
                        <span>Trasfondo y Reflexión</span>
                      </div>
                      <span className="text-xs text-white/40 group-hover:text-white/80 flex items-center gap-1 font-semibold transition-colors">
                        Leer completo <ChevronRight size={14} />
                      </span>
                    </div>
                    {loreData.summary && (
                      <p className="text-sm md:text-base text-white/80 leading-relaxed line-clamp-3 font-normal">
                        {loreData.summary}
                      </p>
                    )}
                    {loreData.interviews && loreData.interviews.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-amber-200/70">
                        <Quote size={13} className="shrink-0" />
                        <span className="truncate italic">"{loreData.interviews[0].quote}" — {loreData.interviews[0].source}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botón exclusivo para Admins/Moderadores en Web/Escritorio: cuadradito con borde redondeado y solo el icono de lápiz abajo a la derecha */}
          {canEditLyrics && (
            <button
              onClick={() => setActiveTab('editor')}
              className="fixed bottom-8 right-8 z-30 hidden md:flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white/70 hover:text-white shadow-2xl backdrop-blur-md transition-all cursor-pointer active:scale-95"
              title="Sincronizar o editar letras manualmente"
            >
              <Edit3 size={18} />
            </button>
          )}
        </div>
      )}

      {/* PANEL LATERAL / DRAWER: ANOTACIÓN POR FRASE (ESTILO GENIUS) */}
      <AnimatePresence>
        {activeAnnotationLine && (
          <div className="fixed inset-0 z-[180] flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setActiveAnnotationLine(null)}>
            <motion.div
              initial={{ x: '100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg h-full bg-[#121216] border-l border-white/10 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Cabecera de la anotación */}
              <div className="p-6 border-b border-white/10 bg-gradient-to-b from-amber-500/10 to-transparent flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-2">
                    <Sparkles size={13} />
                    <span>Anotación del verso</span>
                  </div>
                  <blockquote className="text-lg md:text-xl font-serif italic font-bold text-white leading-snug border-l-2 border-amber-400 pl-3.5 py-0.5">
                    "{activeAnnotationLine.text}"
                  </blockquote>
                  <button
                    type="button"
                    onClick={() => onSeek(activeAnnotationLine.time)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-white/70 hover:text-white transition-all cursor-pointer"
                  >
                    <Play size={11} fill="currentColor" />
                    <span>Escuchar este momento ({formatTimestamp(activeAnnotationLine.time)})</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {canEditLyrics && !isEditingAnnotation && (
                    <button
                      onClick={() => setIsEditingAnnotation(true)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
                      title="Editar anotación"
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setActiveAnnotationLine(null)}
                    className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Cuerpo de la anotación */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 select-text">
                {isEditingAnnotation && canEditLyrics ? (
                  <div className="space-y-5">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-2">
                        Significado / Reflexión sobre este verso
                      </label>
                      <textarea
                        rows={6}
                        value={draftAnnotationContent}
                        onChange={(e) => setDraftAnnotationContent(e.target.value)}
                        placeholder="Explica el significado de esta frase, la historia detrás, metáforas o contexto..."
                        className="w-full p-4 rounded-2xl bg-black/50 border border-white/10 text-white text-sm leading-relaxed outline-none focus:border-amber-400/60 transition-colors resize-none"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300/80">
                        <Quote size={13} />
                        <span>Referencia a entrevista / Cita (Opcional)</span>
                      </div>
                      <textarea
                        rows={3}
                        value={draftAnnotationQuote}
                        onChange={(e) => setDraftAnnotationQuote(e.target.value)}
                        placeholder="Cita textual del artista o entrevista relacionada con este verso..."
                        className="w-full p-3 rounded-xl bg-black/40 border border-white/10 text-white text-xs leading-relaxed outline-none focus:border-amber-400/50 resize-none"
                      />
                      <input
                        type="text"
                        value={draftAnnotationQuoteSource}
                        onChange={(e) => setDraftAnnotationQuoteSource(e.target.value)}
                        placeholder="Fuente (ej. Entrevista con Jordi Wild / Genius Verified, 2023)"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none focus:border-amber-400/50"
                      />
                      <input
                        type="url"
                        value={draftAnnotationQuoteUrl}
                        onChange={(e) => setDraftAnnotationQuoteUrl(e.target.value)}
                        placeholder="Enlace opcional (https://youtube.com/...)"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none focus:border-amber-400/50"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      {activeAnnotationObj ? (
                        <button
                          type="button"
                          onClick={handleDeleteLineAnnotation}
                          disabled={isSavingLore}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-all cursor-pointer"
                        >
                          <Trash2 size={14} />
                          <span>Borrar nota</span>
                        </button>
                      ) : <div />}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (activeAnnotationObj) setIsEditingAnnotation(false);
                            else setActiveAnnotationLine(null);
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveLineAnnotation}
                          disabled={isSavingLore}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isSavingLore ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          <span>Guardar anotación</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : activeAnnotationObj ? (
                  <div className="space-y-6">
                    <div className="text-sm md:text-base text-white/90 leading-relaxed whitespace-pre-line font-normal">
                      {activeAnnotationObj.content}
                    </div>

                    {activeAnnotationObj.quote && (
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 to-white/[0.02] border border-amber-400/25 space-y-2.5">
                        <Quote size={20} className="text-amber-400/70" />
                        <p className="text-sm italic text-amber-100/95 leading-relaxed">
                          "{activeAnnotationObj.quote}"
                        </p>
                        <div className="flex items-center justify-between pt-1 text-xs text-white/50">
                          {activeAnnotationObj.quoteSource && (
                            <span className="font-semibold text-amber-300/80">— {activeAnnotationObj.quoteSource}</span>
                          )}
                          {activeAnnotationObj.quoteUrl && (
                            <a
                              href={activeAnnotationObj.quoteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-amber-400 hover:underline font-semibold"
                            >
                              <span>Ver fuente</span>
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PANEL LATERAL / DRAWER: FICHA DE "TRASFONDO / LORE" DE LA CANCIÓN Y ARTISTA */}
      <AnimatePresence>
        {isLoreDrawerOpen && (
          <div className="fixed inset-0 z-[180] flex justify-end bg-black/65 backdrop-blur-sm" onClick={() => setIsLoreDrawerOpen(false)}>
            <motion.div
              initial={{ x: '100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl h-full bg-[#121216] border-l border-white/10 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Cabecera del Trasfondo */}
              <div className="p-6 border-b border-white/10 bg-gradient-to-b from-purple-500/10 via-amber-500/5 to-transparent flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
                    <BookOpen size={22} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400 block">
                      Editorial & Lore
                    </span>
                    <h3 className="text-lg md:text-xl font-bold text-white truncate">
                      Trasfondo: {currentSong?.title}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {canEditLyrics && !isEditingLore && (
                    <button
                      onClick={() => setIsEditingLore(true)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
                      title="Editar trasfondo, reflexión y entrevistas"
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsLoreDrawerOpen(false)}
                    className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Contenido del Trasfondo */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 select-text">
                {isEditingLore && canEditLyrics ? (
                  <div className="space-y-6">
                    {/* 1. Reflexión sobre la canción */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">
                        <Music2 size={14} />
                        <span>Sobre la canción (Reflexión, historia y contexto)</span>
                      </label>
                      <textarea
                        rows={6}
                        value={draftSummary}
                        onChange={(e) => setDraftSummary(e.target.value)}
                        placeholder="Escribe tu reflexión sobre esta canción, su historia, de qué trata, detalles de producción..."
                        className="w-full p-4 rounded-2xl bg-black/50 border border-white/10 text-white text-sm leading-relaxed outline-none focus:border-amber-400/60 resize-none"
                      />
                    </div>

                    {/* 2. Reflexión sobre el artista */}
                    <div>
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-300 mb-2">
                        <User size={14} />
                        <span>Sobre {currentSong?.artist} y esta etapa</span>
                      </label>
                      <textarea
                        rows={5}
                        value={draftArtistReflection}
                        onChange={(e) => setDraftArtistReflection(e.target.value)}
                        placeholder="Habla sobre el artista, el momento vital o creativo en el que lanzó este tema o álbum, su evolución..."
                        className="w-full p-4 rounded-2xl bg-black/50 border border-white/10 text-white text-sm leading-relaxed outline-none focus:border-purple-400/60 resize-none"
                      />
                    </div>

                    {/* 3. Citas de entrevistas y referencias */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
                          <Quote size={14} className="text-amber-400" />
                          <span>Referencias a entrevistas y citas</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setDraftInterviews(prev => [
                            ...prev,
                            { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, quote: '', source: '', url: '' }
                          ])}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-all cursor-pointer"
                        >
                          <Plus size={13} />
                          <span>Añadir entrevista / cita</span>
                        </button>
                      </div>

                      {draftInterviews.length === 0 ? (
                        <p className="text-xs text-white/40 italic py-2">
                          Aún no has añadido referencias a entrevistas. Pulsa "Añadir entrevista / cita" para agregar declaraciones del artista.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {draftInterviews.map((item, idx) => (
                            <div key={item.id || idx} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3 relative">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-amber-300/80 uppercase tracking-wider">
                                  Cita #{idx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setDraftInterviews(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-white/30 hover:text-red-400 transition-colors cursor-pointer"
                                  title="Eliminar cita"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                              <textarea
                                rows={3}
                                value={item.quote}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDraftInterviews(prev => prev.map((q, i) => i === idx ? { ...q, quote: val } : q));
                                }}
                                placeholder="Declaración o cita de la entrevista..."
                                className="w-full p-3 rounded-xl bg-black/40 border border-white/10 text-white text-xs leading-relaxed outline-none focus:border-amber-400/50 resize-none"
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <input
                                  type="text"
                                  value={item.source}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setDraftInterviews(prev => prev.map((q, i) => i === idx ? { ...q, source: val } : q));
                                  }}
                                  placeholder="Fuente (ej. Entrevista GQ, 2024)"
                                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none focus:border-amber-400/50"
                                />
                                <input
                                  type="url"
                                  value={item.url || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setDraftInterviews(prev => prev.map((q, i) => i === idx ? { ...q, url: val } : q));
                                  }}
                                  placeholder="Link opcional (YouTube, web...)"
                                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs outline-none focus:border-amber-400/50"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setIsEditingLore(false)}
                        className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveLore}
                        disabled={isSavingLore}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isSavingLore ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        <span>Guardar trasfondo</span>
                      </button>
                    </div>
                  </div>
                ) : !hasLoreContent ? (
                  <div className="text-center py-16 space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/40">
                      <BookOpen size={26} />
                    </div>
                    <h4 className="text-base font-bold text-white">Sin trasfondo redactado</h4>
                    <p className="text-xs text-white/50 max-w-sm mx-auto leading-relaxed">
                      Aún no se ha escrito una reflexión o recopilación de entrevistas para esta canción.
                    </p>
                    {canEditLyrics && (
                      <button
                        onClick={() => setIsEditingLore(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all cursor-pointer"
                      >
                        <Edit3 size={14} />
                        <span>Escribir trasfondo y referencias</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Sección 1: Reflexión de la canción */}
                    {loreData.summary && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-[0.2em]">
                          <Music2 size={14} />
                          <span>Sobre la canción</span>
                        </div>
                        <div className="text-sm md:text-base text-white/90 leading-relaxed whitespace-pre-line font-normal bg-white/[0.02] p-5 md:p-6 rounded-2xl border border-white/5">
                          {loreData.summary}
                        </div>
                      </div>
                    )}

                    {/* Sección 2: Sobre el Artista */}
                    {loreData.artistReflection && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase tracking-[0.2em]">
                          <User size={14} />
                          <span>Sobre {currentSong?.artist}</span>
                        </div>
                        <div className="text-sm md:text-base text-white/90 leading-relaxed whitespace-pre-line font-normal bg-purple-500/[0.04] p-5 md:p-6 rounded-2xl border border-purple-500/15">
                          {loreData.artistReflection}
                        </div>
                      </div>
                    )}

                    {/* Sección 3: Entrevistas y citas */}
                    {loreData.interviews && loreData.interviews.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase tracking-[0.2em]">
                          <Quote size={14} />
                          <span>Entrevistas y Referencias</span>
                        </div>
                        <div className="space-y-4">
                          {loreData.interviews.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              className="p-5 md:p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 via-white/[0.02] to-transparent border border-amber-400/20 space-y-3"
                            >
                              <Quote size={20} className="text-amber-400/60" />
                              <p className="text-sm md:text-base italic text-amber-50/95 leading-relaxed font-serif">
                                "{item.quote}"
                              </p>
                              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                                <span className="font-bold text-amber-300/90">
                                  {item.source ? `— ${item.source}` : `— ${currentSong?.artist}`}
                                </span>
                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 font-semibold transition-all"
                                  >
                                    <span>Ver entrevista</span>
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CUERPO: EDITOR / SINCRONIZADOR MANUAL (Solo Admins/Moderadores en Web/Escritorio) */}
      {canEditLyrics && activeTab === 'editor' && (
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Barra de herramientas superior */}
          <div className="px-4 md:px-10 py-3 bg-white/[0.02] border-b border-white/5 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAddLine(editorLines.length - 1)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all cursor-pointer"
                title="Añadir una frase al final"
              >
                <Plus size={14} />
                <span>Nueva frase</span>
              </button>

              <button
                onClick={() => setIsPasteModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-semibold transition-all cursor-pointer"
                title="Pegar letra completa desde el portapapeles"
              >
                <FileText size={14} />
                <span>Pegar texto</span>
              </button>

              {syncedCount > 0 && (
                <button
                  onClick={handleResetTimings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-red-500/10 text-white/50 hover:text-red-400 text-xs font-semibold transition-all cursor-pointer"
                  title="Borrar marcas de tiempo para re-sincronizar"
                >
                  <RotateCcw size={13} />
                  <span className="hidden sm:inline">Reiniciar tiempos</span>
                </button>
              )}
            </div>

            {/* Botón Guardar */}
            <div className="flex items-center gap-3">
              {saveSuccess && (
                <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold animate-fade-in">
                  <Check size={14} /> Letras guardadas
                </span>
              )}
              {saveError && (
                <span className="text-xs text-red-400 font-medium truncate max-w-xs">
                  {saveError}
                </span>
              )}
              <button
                onClick={handleSaveLyrics}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-xs md:text-sm font-bold shadow-lg shadow-purple-600/30 transition-all cursor-pointer disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span>Guardar letras</span>
              </button>
            </div>
          </div>

          {/* LISTA DE FRASES PARA EDITAR Y SINCRONIZAR */}
          <div 
            ref={editorListRef}
            className="flex-1 overflow-y-auto px-4 md:px-10 py-6 space-y-2.5 scrollbar-thin scrollbar-thumb-white/10"
          >
            {editorLines.map((line, index) => {
              const isSelected = index === selectedLineIndex;
              const isSynced = line.time !== null;

              return (
                <div
                  key={line.id}
                  onClick={() => setSelectedLineIndex(index)}
                  className={`
                    group flex items-center gap-2 md:gap-4 p-2.5 md:p-3 rounded-2xl border transition-all cursor-pointer
                    ${isSelected 
                      ? 'bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/40' 
                      : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
                    }
                  `}
                >
                  {/* Número de frase */}
                  <div className={`w-7 text-center font-mono text-xs font-bold shrink-0 ${isSelected ? 'text-purple-400' : 'text-white/30'}`}>
                    #{index + 1}
                  </div>

                  {/* Badge de tiempo sincronizado */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (line.time !== null) {
                        onSeek(line.time);
                      } else {
                        handleSetLineTime(line.id, liveCurrentTime);
                      }
                    }}
                    className={`
                      flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all shrink-0 cursor-pointer
                      ${isSynced 
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25' 
                        : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10'
                      }
                    `}
                    title={isSynced ? "Clic para escuchar desde este segundo" : "Clic para fijar a la posición actual de la música"}
                  >
                    <Clock size={12} />
                    <span>{formatTimestamp(line.time)}</span>
                  </button>

                  {/* Campo de texto de la frase */}
                  <input
                    ref={(el) => {
                      if (el) lineInputRefs.current.set(line.id, el);
                      else lineInputRefs.current.delete(line.id);
                    }}
                    type="text"
                    value={line.text}
                    placeholder="Escribe la frase aquí..."
                    onChange={(e) => handleUpdateLineText(line.id, e.target.value)}
                    onFocus={() => setSelectedLineIndex(index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddLine(index);
                      } else if (e.key === 'Backspace' && line.text === '' && editorLines.length > 1) {
                        e.preventDefault();
                        handleDeleteLine(line.id);
                      } else if (e.key === 'ArrowDown' && index + 1 < editorLines.length) {
                        setSelectedLineIndex(index + 1);
                        scrollToEditorLine(index + 1);
                      } else if (e.key === 'ArrowUp' && index > 0) {
                        setSelectedLineIndex(index - 1);
                        scrollToEditorLine(index - 1);
                      }
                    }}
                    className="flex-1 bg-transparent border-none outline-none text-white text-sm md:text-base font-medium placeholder-white/20 min-w-0"
                  />

                  {/* Botones de acción por línea */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isSynced && (
                      <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/5 text-[11px] font-mono">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleNudgeTime(line.id, -0.3); }}
                          className="px-1.5 py-0.5 hover:bg-white/10 rounded text-white/50 hover:text-white transition-all cursor-pointer"
                          title="Restar 0.3 segundos (-0.3s)"
                        >
                          -0.3s
                        </button>
                        <span className="text-white/20">|</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleNudgeTime(line.id, 0.3); }}
                          className="px-1.5 py-0.5 hover:bg-white/10 rounded text-white/50 hover:text-white transition-all cursor-pointer"
                          title="Sumar 0.3 segundos (+0.3s)"
                        >
                          +0.3s
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetLineTime(line.id, liveCurrentTime);
                      }}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-all cursor-pointer"
                      title="Asignar el tiempo actual de reproducción a esta frase"
                    >
                      <Clock size={15} />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteLine(line.id);
                      }}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg text-white/30 hover:text-red-400 transition-all cursor-pointer"
                      title="Eliminar frase"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="pt-2 pb-24">
              <button
                onClick={() => handleAddLine(editorLines.length - 1)}
                className="w-full py-3 rounded-2xl border border-dashed border-white/10 hover:border-purple-500/40 hover:bg-purple-500/5 text-white/40 hover:text-purple-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Plus size={16} />
                <span>Añadir siguiente frase (o pulsa Enter en el texto)</span>
              </button>
            </div>
          </div>

          {/* BARRA FLOTANTE INFERIOR DE REPRODUCCIÓN Y SINCRONIZACIÓN EN VIVO */}
          <div className="shrink-0 p-3 md:p-4 bg-gradient-to-t from-black via-black/95 to-black/80 border-t border-white/10 backdrop-blur-xl shadow-2xl z-20">
            <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSeek(Math.max(0, liveCurrentTime - 3))}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-all cursor-pointer"
                    title="Retroceder 3 segundos (-3s)"
                  >
                    <Rewind size={18} />
                  </button>

                  <button
                    onClick={onTogglePlay}
                    className="p-3 bg-white text-black hover:scale-105 active:scale-95 rounded-2xl shadow-xl transition-all cursor-pointer"
                    title={isPlaying ? "Pausar música" : "Reproducir música"}
                  >
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                  </button>

                  <button
                    onClick={() => onSeek(liveCurrentTime + 3)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-all cursor-pointer"
                    title="Avanzar 3 segundos (+3s)"
                  >
                    <FastForward size={18} />
                  </button>
                </div>

                <div className="font-mono text-xs md:text-sm text-white/80 font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
                  <span className="text-purple-400">{formatTimestamp(liveCurrentTime)}</span>
                  {duration > 0 && <span className="text-white/40"> / {formatTimestamp(duration)}</span>}
                </div>
              </div>

              <div className="w-full sm:flex-1 sm:max-w-md flex items-center">
                <button
                  onClick={handleSyncCurrentLine}
                  className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 bg-size-200 hover:bg-right text-white font-bold text-xs md:text-sm shadow-xl shadow-purple-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-3 border border-purple-400/30"
                >
                  <Sparkles size={18} className="animate-pulse text-yellow-300" />
                  <div className="flex flex-col items-start leading-tight min-w-0">
                    <span className="font-extrabold uppercase tracking-wide">
                      Sincronizar Frase #{selectedLineIndex + 1}
                    </span>
                    <span className="text-[11px] text-white/70 truncate max-w-[220px] md:max-w-[280px]">
                      {editorLines[selectedLineIndex]?.text 
                        ? `"${editorLines[selectedLineIndex].text}"` 
                        : "(Línea vacía - añade texto)"}
                    </span>
                  </div>
                  <ChevronRight size={18} className="ml-auto text-white/60" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA PEGAR TEXTO COMPLETO */}
      <AnimatePresence>
        {isPasteModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-xl bg-[#18181b] border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Pegar letra completa</h3>
                    <p className="text-xs text-white/50">Cada salto de línea creará una frase lista para sincronizar.</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsPasteModalOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <textarea
                rows={10}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Pega aquí la letra de la canción...&#10;&#10;Ejemplo:&#10;Primera frase de la canción&#10;Segunda frase del verso&#10;Y el estribillo..."
                className="w-full p-4 bg-black/50 border border-white/10 rounded-2xl text-white text-sm outline-none focus:border-purple-500 transition-colors resize-none placeholder-white/20 font-sans"
              />

              <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsPasteModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleApplyPastedText}
                  disabled={!pastedText.trim()}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  Cargar frases
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
