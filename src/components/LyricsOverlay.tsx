import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAudioPlaybackTime } from '../hooks/useAudioEngine';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Music2, Loader2, Play, Pause, RotateCcw, Plus, Trash2, 
  Check, Clock, Edit3, AlignLeft, Save, Sparkles, ChevronRight,
  Volume2, FastForward, Rewind, FileText, ArrowDown
} from 'lucide-react';
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
  duration = 0
}) => {
  const liveCurrentTime = useAudioPlaybackTime(getCurrentTime, subscribeToTime);

  // Tab activo: 'view' (karaoke) o 'editor' (sincronizador manual)
  const [activeTab, setActiveTab] = useState<'view' | 'editor'>('view');

  // Estado de letras en vista karaoke
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Cargar letras: primero de la base de datos de Aura, y si no hay, de lrclib
  useEffect(() => {
    if (!isOpen || !currentSong) return;

    let isMounted = true;

    const fetchLyrics = async () => {
      setIsLoading(true);
      setError(null);
      setLyrics([]);

      // 1. Intentar cargar letras personalizadas guardadas en Aura
      try {
        const auraRes = await fetch(`${API_BASE}/api/tracks/${currentSong.id}/lyrics`);
        if (auraRes.ok) {
          const auraData = await auraRes.json();
          if (auraData?.lyrics && auraData.lyrics.trim().length > 0) {
            if (!isMounted) return;
            const parsed = parseLRC(auraData.lyrics);
            setLyrics(parsed);
            initEditorFromLyrics(parsed);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        // Fallback silencioso a lrclib si falla la API interna
      }

      // 2. Si no hay letras en Aura, buscar en lrclib
      try {
        const lrclibUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(currentSong.artist)}&track_name=${encodeURIComponent(currentSong.title)}&album_name=${encodeURIComponent(currentSong.album || '')}`;
        const response = await fetch(lrclibUrl);
        
        if (!response.ok) {
          // Búsqueda alternativa por texto libre en lrclib
          const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${currentSong.artist} ${currentSong.title}`)}`);
          if (searchRes.ok) {
            const results = await searchRes.json();
            if (results && results.length > 0) {
              const bestMatch = results[0];
              const bestLrc = bestMatch.syncedLyrics || bestMatch.plainLyrics;
              if (bestLrc && isMounted) {
                const parsed = parseLRC(bestLrc);
                setLyrics(parsed);
                initEditorFromLyrics(parsed);
                setIsLoading(false);
                return;
              }
            }
          }
          throw new Error("No lyrics found");
        }

        const data = await response.json();
        if (!isMounted) return;

        if (data.syncedLyrics) {
          const parsed = parseLRC(data.syncedLyrics);
          setLyrics(parsed);
          initEditorFromLyrics(parsed);
        } else if (data.plainLyrics) {
          const plainLines = data.plainLyrics
            .split('\n')
            .map((t: string) => sanitizeText(t))
            .filter(Boolean);
          
          const parsed = plainLines.map((t: string, idx: number) => ({
            id: `plain-${idx}`,
            time: 0,
            text: t
          }));
          setLyrics(parsed);
          initEditorFromPlainLines(plainLines);
        } else {
          setError("No se encontraron letras para esta canción.");
          initEmptyEditor();
        }
      } catch (err) {
        if (!isMounted) return;
        setError("No se encontraron letras para esta canción.");
        initEmptyEditor();
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchLyrics();

    return () => {
      isMounted = false;
    };
  }, [currentSong?.id, isOpen]);

  // Inicializar editor desde letras parseadas
  const initEditorFromLyrics = (parsed: LyricLine[]) => {
    // Si hay un borrador en progreso guardado en localStorage, ofrecer o cargar
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
    const targetLine = editorLines[index];

    const stampTime = Number(liveCurrentTime.toFixed(2));

    setEditorLines(prev => prev.map((l, i) => i === index ? { ...l, time: stampTime } : l));

    // Si aún hay líneas siguientes, avanzar a la siguiente automáticamente
    if (index + 1 < editorLines.length) {
      const nextIndex = index + 1;
      setSelectedLineIndex(nextIndex);
      scrollToEditorLine(nextIndex);
    }
  };

  // Fijar tiempo específico a una línea
  const handleSetLineTime = (id: string, time: number) => {
    setEditorLines(prev => prev.map(l => l.id === id ? { ...l, time: Number(time.toFixed(2)) } : l));
  };

  // Micro-ajustes de tiempo (+/- 0.3s o 0.5s)
  const handleNudgeTime = (id: string, delta: number) => {
    setEditorLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const base = l.time !== null ? l.time : liveCurrentTime;
      const newTime = Math.max(0, Number((base + delta).toFixed(2)));
      return { ...l, time: newTime };
    }));
  };

  // Limpiar todos los tiempos para sincronizar desde cero
  const handleResetTimings = () => {
    if (window.confirm("¿Seguro que deseas reiniciar todos los tiempos y sincronizarlos desde cero?")) {
      setEditorLines(prev => prev.map(l => ({ ...l, time: null })));
      setSelectedLineIndex(0);
      scrollToEditorLine(0);
    }
  };

  // Pegar texto completo en masa
  const handleApplyPastedText = () => {
    if (!pastedText.trim()) return;

    const rawLines = pastedText
      .split('\n')
      .map(l => sanitizeText(l))
      .filter(l => l.length > 0);

    if (rawLines.length === 0) return;

    // Verificar si el texto pegado ya contiene marcas LRC de tiempo [mm:ss.xx]
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

      // Actualizar vista local de karaoke
      const newParsed = parseLRC(lrcString);
      setLyrics(newParsed);
      setError(null);
      setSaveSuccess(true);

      // Limpiar borrador temporal guardado
      try {
        localStorage.removeItem(`aura_lyrics_draft_${currentSong.id}`);
      } catch {}

      // Después de 1 segundo, volver a la pestaña de vista karaoke para disfrutar el resultado
      setTimeout(() => {
        setActiveTab('view');
        setSaveSuccess(false);
      }, 1200);

    } catch (err: any) {
      console.error("Error guardando letras:", err);
      setSaveError(err.message || "Error al guardar las letras. Asegúrate de haber iniciado sesión.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Índice de línea activa en la vista karaoke
  const activeKaraokeIndex = lyrics.reduce((prev, curr, idx) => {
    return curr.time <= liveCurrentTime ? idx : prev;
  }, -1);

  // Estadísticas del sincronizador
  const syncedCount = editorLines.filter(l => l.time !== null).length;
  const totalCount = editorLines.filter(l => l.text.trim().length > 0).length;

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex flex-col font-sans select-none text-white overflow-hidden"
    >
      {/* Header con tabs */}
      <div className="h-20 md:h-24 flex items-center justify-between px-4 md:px-10 shrink-0 border-b border-white/10 bg-black/40">
        {/* Info Canción */}
        <div className="flex items-center gap-3 md:gap-5 min-w-0 max-w-[40%] md:max-w-[45%]">
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

        {/* Selector de Pestañas (Letras vs Sincronizar) */}
        <div className="flex items-center bg-white/5 p-1 rounded-2xl border border-white/10 shadow-inner">
          <button
            onClick={() => setActiveTab('view')}
            className={`flex items-center gap-2 px-3.5 py-1.5 md:px-5 md:py-2 rounded-xl text-xs md:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'view'
                ? 'bg-white text-black shadow-lg font-bold scale-[1.02]'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Music2 size={16} />
            <span>Letras</span>
          </button>

          <button
            onClick={() => setActiveTab('editor')}
            className={`flex items-center gap-2 px-3.5 py-1.5 md:px-5 md:py-2 rounded-xl text-xs md:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25 font-bold scale-[1.02]'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Edit3 size={16} />
            <span>Sincronizar</span>
            {totalCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === 'editor' ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70'
              }`}>
                {syncedCount}/{totalCount}
              </span>
            )}
          </button>
        </div>

        {/* Botón Cerrar */}
        <button 
          onClick={onClose} 
          className="p-2.5 md:p-3 bg-white/5 hover:bg-white/10 active:scale-95 rounded-full transition-all text-white/60 hover:text-white cursor-pointer shrink-0"
          title="Cerrar (Esc)"
        >
          <X size={20} className="md:w-6 md:h-6" />
        </button>
      </div>

      {/* CUERPO: VISTA KARAOKE */}
      {activeTab === 'view' && (
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 md:px-10 py-32 flex flex-col items-center scrollbar-hide relative"
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 my-auto opacity-40">
              <Loader2 className="animate-spin text-purple-400" size={36} />
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">Buscando letras sincronizadas...</p>
            </div>
          ) : error || lyrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center my-auto max-w-md p-8 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-xl shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-5 text-purple-400">
                <Music2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Sin letras sincronizadas</h3>
              <p className="text-sm text-white/50 mb-6 leading-relaxed">
                Esta canción aún no tiene letras sincronizadas registradas. Puedes crearlas tú mismo frase a frase y sincronizarlas con el audio.
              </p>
              <button
                onClick={() => setActiveTab('editor')}
                className="flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold text-sm shadow-xl shadow-purple-500/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <Edit3 size={18} />
                <span>Añadir y sincronizar letras</span>
              </button>
            </div>
          ) : (
            <div className="w-full max-w-4xl space-y-10 md:space-y-12">
              {lyrics.map((line, index) => {
                const isActive = index === activeKaraokeIndex;
                const isPast = index < activeKaraokeIndex;

                return (
                  <div
                    key={line.id || index}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => onSeek(line.time)}
                    className={`
                      cursor-pointer transition-all duration-500 ease-out text-center select-none py-1
                      ${isActive ? 'text-white scale-105 md:scale-110 drop-shadow-[0_0_25px_rgba(255,255,255,0.4)]' : isPast ? 'text-white/20 hover:text-white/40' : 'text-white/40 hover:text-white/70'}
                    `}
                  >
                    <p className={`
                      text-2xl md:text-4xl lg:text-5xl font-black tracking-tight leading-snug
                      ${isActive ? 'opacity-100 blur-none font-black' : 'opacity-80 blur-[0.5px] font-bold'}
                    `}>
                      {line.text}
                    </p>
                  </div>
                );
              })}

              {/* Botón flotante para editar letras */}
              <div className="pt-16 pb-8 flex justify-center">
                <button
                  onClick={() => setActiveTab('editor')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs font-semibold tracking-wide transition-all cursor-pointer"
                >
                  <Edit3 size={14} />
                  <span>Ajustar o corregir estas letras</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CUERPO: EDITOR / SINCRONIZADOR MANUAL */}
      {activeTab === 'editor' && (
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
                    {/* Micro-ajustes de tiempo */}
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

                    {/* Fijar tiempo actual */}
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

                    {/* Borrar línea */}
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

            {/* Botón rápido para añadir línea al final */}
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
              {/* Controles de audio */}
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

                {/* Display de tiempo actual */}
                <div className="font-mono text-xs md:text-sm text-white/80 font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
                  <span className="text-purple-400">{formatTimestamp(liveCurrentTime)}</span>
                  {duration > 0 && <span className="text-white/40"> / {formatTimestamp(duration)}</span>}
                </div>
              </div>

              {/* BOTÓN GIGANTE DE SINCRONIZACIÓN */}
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
