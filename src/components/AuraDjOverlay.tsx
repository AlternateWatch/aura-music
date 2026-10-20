import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Play,
  ListPlus,
  X,
  RotateCcw,
  Key,
  Check,
  Disc3,
  Flame,
  Coffee,
  Moon,
  Car,
  Zap,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { Song } from '../constants';
import { DEFAULT_COVER, getThumbnailUrl } from '../utils/api';
import {
  generateDjMix,
  getStoredGeminiKey,
  saveStoredGeminiKey,
  type DjMixResult
} from '../services/aiDj';
import { API_BASE } from '../utils/api';

interface AuraDjOverlayProps {
  onClose: () => void;
  songs: Song[];
  token: string | null;
  onPlayQueue: (tracks: Song[]) => void;
  onPlaylistCreated?: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Rock con energía para entrenar', icon: Flame },
  { label: 'Acústico y tranquilo para concentrarse', icon: Coffee },
  { label: 'Sesión nocturna relajante y profunda', icon: Moon },
  { label: 'Temas para cantar en carretera', icon: Car },
  { label: 'Joyas de los 90 y 2000 con guitarras', icon: Zap },
];

export function AuraDjOverlay({
  onClose,
  songs,
  token,
  onPlayQueue,
  onPlaylistCreated
}: AuraDjOverlayProps) {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(getStoredGeminiKey());
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mixResult, setMixResult] = useState<DjMixResult | null>(null);

  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);

  // Pasos de animación durante la generación
  useEffect(() => {
    if (!isLoading) return;
    const steps = [
      'Escaneando tu biblioteca musical...',
      'Analizando el tempo y estilo solicitado...',
      'Seleccionando el orden de mezcla óptimo...',
      'Afinando la atmósfera sonora...'
    ];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % steps.length;
      setLoadingStep(idx);
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSaveApiKey = () => {
    saveStoredGeminiKey(apiKey);
    setKeySavedMessage(true);
    setTimeout(() => {
      setKeySavedMessage(false);
      setShowKeyConfig(false);
    }, 1500);
  };

  const handleGenerate = async (customPrompt?: string) => {
    const textToUse = (customPrompt || prompt).trim();
    if (!textToUse) return;

    setError(null);
    setIsLoading(true);
    setMixResult(null);
    setIsSavedSuccess(false);

    try {
      const result = await generateDjMix(textToUse, songs, apiKey, token);
      setMixResult(result);
    } catch (err: any) {
      setError(err.message || 'Error al conectar con Aura DJ.');
      if (err.message?.includes('API Key')) {
        setShowKeyConfig(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayNow = () => {
    if (!mixResult || mixResult.tracks.length === 0) return;
    onPlayQueue(mixResult.tracks);
    onClose();
  };

  const handleSaveAsPlaylist = async () => {
    if (!mixResult || isSavingPlaylist || isSavedSuccess) return;
    if (!token) {
      setError('Debes iniciar sesión para guardar playlists en tu cuenta.');
      return;
    }

    setIsSavingPlaylist(true);
    setError(null);

    try {
      // 1. Crear playlist en el backend
      const createRes = await fetch(`${API_BASE}/api/playlists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: mixResult.title })
      });

      if (!createRes.ok) {
        throw new Error('No se pudo crear la playlist');
      }

      // Obtener la lista actualizada de playlists para saber la ID de la recién creada
      const listRes = await fetch(`${API_BASE}/api/playlists`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const playlists = await listRes.json();
      const created = Array.isArray(playlists) 
        ? playlists.find((p: any) => p.name === mixResult.title) || playlists[playlists.length - 1]
        : null;

      if (created && created.id) {
        // 2. Añadir las canciones en orden
        for (const track of mixResult.tracks) {
          await fetch(`${API_BASE}/api/playlists/${created.id}/tracks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ trackId: track.id })
          }).catch(() => {});
        }
      }

      setIsSavedSuccess(true);
      onPlaylistCreated?.();
    } catch (err: any) {
      setError(err.message || 'Error al guardar la playlist.');
    } finally {
      setIsSavingPlaylist(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-xl overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-gradient-to-b from-neutral-900 via-neutral-900 to-black border border-white/10 rounded-[32px] p-5 sm:p-7 shadow-[0_0_80px_rgba(242,125,38,0.18)] flex flex-col max-h-[90vh] min-w-0 overflow-hidden"
      >
        {/* CABECERA */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-amber-500 via-[#F27D26] to-rose-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Sparkles size={18} className="text-white fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-none">
                  Aura DJ
                </h2>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded-full bg-brand-primary/15 text-brand-primary border border-brand-primary/30 font-bold">
                  Gemini AI
                </span>
              </div>
              <p className="text-[11px] text-white/50 pt-0.5">
                Crea listas perfectas de tu biblioteca a partir de cualquier idea
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowKeyConfig(!showKeyConfig)}
              className={`p-2 rounded-full transition-colors cursor-pointer ${
                showKeyConfig ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
              title="Configurar Gemini API Key"
            >
              <Key size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* PANEL DESPLEGABLE DE CONFIGURACIÓN DE API KEY */}
        <AnimatePresence>
          {showKeyConfig && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-white/10 bg-amber-950/20 -mx-5 sm:-mx-7 px-5 sm:px-7 py-3.5 shrink-0"
            >
              <div className="flex items-start gap-2.5 text-xs text-amber-100/90 mb-2">
                <Info size={14} className="shrink-0 mt-0.5 text-brand-primary" />
                <p>
                  Aura DJ utiliza el plan gratuito de Google Gemini (1.500 playlists al día sin coste). Puedes obtener tu clave en{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-amber-400 font-bold hover:text-amber-200"
                  >
                    Google AI Studio
                  </a>.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Pega aquí tu clave AI Studio (AIza...)"
                  className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-brand-primary font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveApiKey}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-[#F27D26] hover:brightness-110 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-orange-500/20 transition-all"
                >
                  {keySavedMessage ? (
                    <>
                      <Check size={14} /> Guardada
                    </>
                  ) : (
                    'Guardar'
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* CONTENIDO PRINCIPAL */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
          {/* MODO RESULTADO */}
          {mixResult ? (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
              {/* RESUMEN DE LA MEZCLA */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-brand-primary/15 via-white/[0.02] to-white/5 border border-brand-primary/30 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {mixResult.vibeTags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-amber-300 border border-white/10 font-bold"
                    >
                      #{tag.replace(/^#/, '')}
                    </span>
                  ))}
                  <span className="text-[10px] font-mono text-white/40 ml-auto">
                    {mixResult.tracks.length} pistas seleccionadas
                  </span>
                </div>

                <h3 className="text-xl sm:text-2xl font-serif italic font-bold text-white leading-tight">
                  {mixResult.title}
                </h3>
                <p className="text-xs text-white/70 leading-relaxed font-sans">
                  {mixResult.description}
                </p>
              </div>

              {/* LISTA DE PISTAS */}
              <div className="space-y-1.5 max-h-60 sm:max-h-80 overflow-y-auto pr-1">
                {mixResult.tracks.map((track, i) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group"
                  >
                    <span className="w-5 text-center text-xs font-mono font-bold text-white/40 group-hover:text-brand-primary">
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    <img
                      src={getThumbnailUrl(track.coverUrl, 150) || DEFAULT_COVER}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0"
                      onError={(e) => {
                        if (!e.currentTarget.src.includes('default_cover') && !e.currentTarget.src.includes('default-cover')) {
                          e.currentTarget.src = DEFAULT_COVER;
                        }
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{track.title}</p>
                      <p className="text-[11px] text-white/50 truncate">
                        {track.artist} {track.album ? `· ${track.album}` : ''}
                      </p>
                    </div>

                    {track.format === 'flac' && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-brand-primary/20 text-brand-primary border border-brand-primary/30 shrink-0">
                        FLAC
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : isLoading ? (
            /* MODO CARGANDO CON ANIMACIÓN */
            <div className="py-16 sm:py-24 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-2 border-brand-primary/20 border-t-brand-primary animate-spin" />
                <Disc3
                  size={36}
                  className="absolute inset-0 m-auto text-brand-primary animate-pulse"
                />
              </div>

              <div className="space-y-1">
                <p className="text-base font-bold text-white tracking-tight">
                  Aura DJ está mezclando...
                </p>
                <p className="text-xs text-amber-300/90 font-mono animate-pulse">
                  {[
                    'Escaneando tu biblioteca musical...',
                    'Analizando la vibra y estilo solicitado...',
                    'Seleccionando el orden de mezcla óptimo...',
                    'Afinando la atmósfera sonora...'
                  ][loadingStep]}
                </p>
              </div>
            </div>
          ) : (
            /* MODO ENTRADA / PROMPT */
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  rows={3}
                  placeholder="Describe la música que te apetece... (ej. 'Rock alternativo enérgico de los 90 para entrenar', 'Canciones tranquilas acústicas para leer')..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-xs sm:text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-primary focus:bg-white/10 transition-all resize-none"
                />
              </div>

              {/* CHIPS DE SUGERENCIAS */}
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">
                  O prueba con una idea rápida:
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setPrompt(item.label);
                          handleGenerate(item.label);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/70 hover:text-white transition-all cursor-pointer hover:border-brand-primary/40"
                      >
                        <Icon size={12} className="text-brand-primary shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* MENSAJE DE ERROR */}
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
              <div className="flex-1">
                <p>{error}</p>
                {!apiKey && (
                  <button
                    type="button"
                    onClick={() => setShowKeyConfig(true)}
                    className="underline text-red-200 font-bold mt-1 block"
                  >
                    Haz clic aquí para configurar tu API Key gratuita
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* PIE CON ACCIONES */}
        <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {mixResult ? (
            <>
              <button
                type="button"
                onClick={() => setMixResult(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw size={14} /> Probar otra idea
              </button>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleSaveAsPlaylist}
                  disabled={isSavingPlaylist || isSavedSuccess}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isSavedSuccess
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
                  }`}
                >
                  {isSavedSuccess ? (
                    <>
                      <CheckCircle2 size={14} /> Guardada
                    </>
                  ) : isSavingPlaylist ? (
                    'Guardando...'
                  ) : (
                    <>
                      <ListPlus size={14} /> Guardar Playlist
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handlePlayNow}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-[#F27D26] to-rose-500 hover:brightness-110 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-orange-500/25 cursor-pointer transition-all active:scale-95"
                >
                  <Play size={14} fill="white" /> Reproducir ahora
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[11px] text-white/40">
                {songs.length} pistas en tu biblioteca disponibles
              </span>

              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={isLoading || !prompt.trim()}
                className="ml-auto px-6 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 via-[#F27D26] to-rose-500 hover:brightness-110 text-white font-bold text-xs flex items-center gap-2 shadow-xl shadow-orange-500/20 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} className="fill-white" />
                Generar mezcla
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
