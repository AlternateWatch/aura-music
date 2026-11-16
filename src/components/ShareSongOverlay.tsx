import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Share2, Copy, Check, X, MessageCircle, Send, Camera,
  ExternalLink, ChevronLeft, Sparkles, Loader2
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import AuraMedia from '../plugins/auraMedia';
import {
  subscribeShareStore,
  getActiveShareSongSnapshot,
  getShareToastSnapshot,
  closeShareSongModal,
  copySongShareLink,
  getSongShareUrl,
  getSongShareText,
  openShareDeepLink,
  triggerNativeSystemShare,
  showShareToast,
} from '../utils/shareSong';
import { generateInstagramStoryAssets } from '../utils/instagramStoryGenerator';
import { useFileUrl } from '../hooks/useFileUrl';
import { DEFAULT_COVER, getThumbnailUrl } from '../utils/api';
import { hapticImpact, hapticSuccess } from '../utils/haptics';

export const ShareSongOverlay: React.FC = () => {
  const song = useSyncExternalStore(subscribeShareStore, getActiveShareSongSnapshot, getActiveShareSongSnapshot);
  const toast = useSyncExternalStore(subscribeShareStore, getShareToastSnapshot, getShareToastSnapshot);
  const resolvedCover = useFileUrl(song?.coverUrl);

  const [viewMode, setViewMode] = useState<'main' | 'instagram'>('main');
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);

  useEffect(() => {
    if (song) {
      setViewMode('main');
      setIsGeneratingStory(false);
    }
  }, [song?.id]);

  if (typeof document === 'undefined') return null;

  const handleShareWhatsApp = async () => {
    if (!song) return;
    hapticImpact('medium');
    const text = getSongShareText(song);
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    closeShareSongModal();
    await openShareDeepLink(waUrl);
  };

  const handleOpenInstagramMenu = () => {
    hapticImpact('light');
    setViewMode('instagram');
  };

  const handleInstagramStory = async () => {
    if (!song || isGeneratingStory) return;
    hapticImpact('medium');
    setIsGeneratingStory(true);

    try {
      const assets = await generateInstagramStoryAssets(song);
      const shareUrl = getSongShareUrl(song);

      if (Capacitor.isNativePlatform() && typeof AuraMedia.shareToInstagramStory === 'function') {
        await AuraMedia.shareToInstagramStory({
          backgroundImageBase64: assets.fullStoryPngBase64,
          topColor: assets.topColor,
          bottomColor: assets.bottomColor,
          contentUrl: shareUrl,
        });
        void hapticSuccess();
        closeShareSongModal();
        return;
      }

      const byteString = atob(assets.fullStoryPngBase64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });
      const file = new File([blob], `aura-story-${song.id}.png`, { type: 'image/png' });

      if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${song.title} — ${song.artist}`,
          text: `🎵 Escucha "${song.title}" de ${song.artist} en AURA`,
        });
        closeShareSongModal();
        return;
      }

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aura-story-${song.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showShareToast('Tarjeta Story descargada', 'Súbela directamente a tus Instagram Stories');
      closeShareSongModal();
    } catch (err) {
      console.error('Error al compartir en Instagram Stories:', err);
      showShareToast('No se pudo abrir Instagram Stories', 'Asegúrate de tener Instagram instalado');
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const handleInstagramDM = async () => {
    if (!song) return;
    hapticImpact('medium');
    const text = getSongShareText(song);

    if (Capacitor.isNativePlatform() && typeof AuraMedia.shareToInstagramDM === 'function') {
      try {
        await AuraMedia.shareToInstagramDM({ text });
        closeShareSongModal();
        return;
      } catch {}
    }

    await copySongShareLink(song);
    closeShareSongModal();
    showShareToast(
      'Enlace copiado para Direct Message',
      'Pégalo directamente en el chat de Instagram'
    );
    await openShareDeepLink('https://www.instagram.com/direct/inbox/');
  };

  const handleShareTelegram = async () => {
    if (!song) return;
    hapticImpact('medium');
    const url = getSongShareUrl(song);
    const text = `🎵 Escucha "${song.title}" de ${song.artist} en AURA`;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    closeShareSongModal();
    await openShareDeepLink(tgUrl);
  };

  const handleShareTwitter = async () => {
    if (!song) return;
    hapticImpact('medium');
    const url = getSongShareUrl(song);
    const text = `🎵 Escuchando "${song.title}" de ${song.artist} en AURA`;
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    closeShareSongModal();
    await openShareDeepLink(xUrl);
  };

  const handleShareNativeMore = async () => {
    if (!song) return;
    hapticImpact('light');
    closeShareSongModal();
    const ok = await triggerNativeSystemShare(song);
    if (!ok) {
      await copySongShareLink(song);
    }
  };

  const handleCopyLink = async () => {
    if (!song) return;
    await copySongShareLink(song);
    closeShareSongModal();
  };

  const coverSrc = getThumbnailUrl(resolvedCover || song?.coverUrl, 600) || DEFAULT_COVER;

  return createPortal(
    <>
      {/* Notificación flotante al copiar enlace (PC/Web y Móvil) */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.uid}
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[800] bg-[#141414]/95 backdrop-blur-xl border border-brand-primary/40 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 max-w-[92vw]"
          >
            <div className="w-8 h-8 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center shrink-0">
              <Check size={16} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold leading-tight truncate">{toast.message}</p>
              {toast.subtitle && (
                <p className="text-[10px] text-white/55 truncate mt-0.5">{toast.subtitle}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hoja inferior de Compartir en Móvil */}
      <AnimatePresence>
        {song && (
          <div className="fixed inset-0 z-[750] flex flex-col justify-end font-sans">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm"
              onClick={closeShareSongModal}
            />

            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="relative z-[751] w-full max-w-lg mx-auto bg-[#121215] border-t border-white/10 rounded-t-[32px] shadow-2xl flex flex-col overflow-hidden pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto my-3 shrink-0" />

              {viewMode === 'main' ? (
                <>
                  {/* Cabecera con tarjeta de la canción */}
                  <div className="px-5 pb-4 flex items-center justify-between gap-3 border-b border-white/5">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <img
                        src={coverSrc}
                        alt={song.title}
                        onError={(e) => {
                          if (!e.currentTarget.src.includes('default_cover.jpg') && !e.currentTarget.src.includes('default-cover.jpg')) {
                            e.currentTarget.src = DEFAULT_COVER;
                          }
                        }}
                        className="w-14 h-14 rounded-2xl object-cover bg-white/5 border border-white/10 shadow-lg shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-primary mb-0.5 flex items-center gap-1">
                          <Share2 size={10} /> Compartir canción
                        </p>
                        <h4 className="text-sm font-bold text-white truncate">{song.title}</h4>
                        <p className="text-xs text-white/50 truncate font-medium">{song.artist}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeShareSongModal}
                      className="p-2 rounded-full bg-white/5 text-white/40 hover:text-white transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Botón principal destacado de WhatsApp */}
                    <button
                      type="button"
                      onClick={handleShareWhatsApp}
                      className="w-full py-3.5 px-4 rounded-2xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2.5 shadow-lg shadow-[#25D366]/20 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <MessageCircle size={18} fill="black" />
                      <span>Compartir por WhatsApp</span>
                    </button>

                    {/* Cuadrícula de otras aplicaciones */}
                    <div className="grid grid-cols-4 gap-2.5">
                      <button
                        type="button"
                        onClick={handleOpenInstagramMenu}
                        className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 active:scale-95 transition-all cursor-pointer"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] flex items-center justify-center text-white shadow-md">
                          <Camera size={20} />
                        </div>
                        <span className="text-[10px] font-bold text-white/80">Instagram</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleShareTelegram}
                        className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 active:scale-95 transition-all cursor-pointer"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-[#229ED9] flex items-center justify-center text-white shadow-md">
                          <Send size={19} />
                        </div>
                        <span className="text-[10px] font-bold text-white/80">Telegram</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleShareTwitter}
                        className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 active:scale-95 transition-all cursor-pointer"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-black border border-white/15 flex items-center justify-center text-white font-black text-base shadow-md">
                          𝕏
                        </div>
                        <span className="text-[10px] font-bold text-white/80">X / Post</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleShareNativeMore}
                        className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 active:scale-95 transition-all cursor-pointer"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-white shadow-md">
                          <ExternalLink size={19} />
                        </div>
                        <span className="text-[10px] font-bold text-white/80">Más apps</span>
                      </button>
                    </div>

                    {/* Botón para copiar enlace directo */}
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full py-3 px-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-bold text-xs flex items-center justify-between gap-3 active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <span className="truncate text-[11px] font-mono text-white/50">
                        {getSongShareUrl(song)}
                      </span>
                      <span className="flex items-center gap-1.5 text-brand-primary font-black uppercase text-[10px] tracking-wider shrink-0">
                        <Copy size={13} /> Copiar link
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                /* Submenú de Instagram: Vista previa minimalista estilo Tidal + Stories o Direct Message */
                <div className="flex flex-col">
                  <div className="px-5 pb-3 flex items-center justify-between border-b border-white/5">
                    <button
                      type="button"
                      onClick={() => setViewMode('main')}
                      className="flex items-center gap-1 text-xs font-semibold text-white/70 hover:text-white py-1 cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                      <span>Atrás</span>
                    </button>
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/90">
                      Instagram
                    </span>
                    <button
                      type="button"
                      onClick={closeShareSongModal}
                      className="p-1.5 rounded-full bg-white/5 text-white/40 hover:text-white cursor-pointer"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <div className="p-5 flex flex-col items-center gap-5">
                    {/* Vista previa 9:16 limpia estilo Tidal */}
                    <div className="relative w-44 aspect-[9/16] rounded-[26px] overflow-hidden border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85)] bg-[#08080b] flex items-center justify-center select-none">
                      <img
                        src={coverSrc}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover blur-xl brightness-50 saturate-125 scale-125"
                      />

                      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/70" />

                      {/* Tarjeta central estilo Tidal (Portada arriba + Título/Artista + Pie AURA.) */}
                      <div className="relative z-10 w-[80%] rounded-[20px] bg-[#0d0d11]/90 backdrop-blur-xl border border-white/[0.13] p-2.5 shadow-[0_16px_36px_rgba(0,0,0,0.75)] flex flex-col">
                        {/* Portada cuadrada protagonista */}
                        <div className="w-full aspect-square rounded-[13px] overflow-hidden bg-white/5 border border-white/10 shadow-lg">
                          <img
                            src={coverSrc}
                            alt={song.title}
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Título y Artista */}
                        <div className="min-w-0 pt-2.5 pb-2">
                          <p className="text-[11px] font-extrabold text-white truncate leading-tight">
                            {song.title}
                          </p>
                          <p className="text-[9px] font-medium text-white/60 truncate mt-0.5">
                            {song.artist}
                          </p>
                        </div>

                        {/* Separador fino + Pie AURA. y ecualizador */}
                        <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between">
                          <span className="text-[9px] font-black tracking-tight text-white leading-none">
                            AURA<span className="text-brand-primary">.</span>
                          </span>
                          <div className="flex items-center gap-[2px] h-2.5">
                            <span className="w-[1.5px] h-1.5 rounded-full bg-white/35" />
                            <span className="w-[1.5px] h-2.5 rounded-full bg-white/35" />
                            <span className="w-[1.5px] h-2 rounded-full bg-white/35" />
                            <span className="w-[1.5px] h-2.5 rounded-full bg-brand-primary" />
                            <span className="w-[1.5px] h-1.5 rounded-full bg-white/35" />
                          </div>
                        </div>
                      </div>

                      {/* Marca de agua discreta abajo a la derecha */}
                      <span className="absolute bottom-2 right-3 z-20 text-[7px] font-medium text-white/50 tracking-tight drop-shadow">
                        aura.basildo.me
                      </span>
                    </div>

                    {/* Botones de acción limpios */}
                    <div className="w-full space-y-2.5">
                      <button
                        type="button"
                        disabled={isGeneratingStory}
                        onClick={handleInstagramStory}
                        className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2.5 shadow-lg shadow-[#dc2743]/25 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                      >
                        {isGeneratingStory ? (
                          <>
                            <Loader2 size={17} className="animate-spin" />
                            <span>Abriendo Stories...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={17} />
                            <span>Compartir en Stories</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleInstagramDM}
                        className="w-full py-3.5 px-4 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all cursor-pointer"
                      >
                        <Send size={15} />
                        <span>Enviar por Direct Message</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
};
