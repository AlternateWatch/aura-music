import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Copy, Check, X, MessageCircle, Send, Camera, Sparkles, ExternalLink } from 'lucide-react';
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
import { useFileUrl } from '../hooks/useFileUrl';
import { DEFAULT_COVER, getThumbnailUrl } from '../utils/api';
import { hapticImpact } from '../utils/haptics';

export const ShareSongOverlay: React.FC = () => {
  const song = useSyncExternalStore(subscribeShareStore, getActiveShareSongSnapshot, getActiveShareSongSnapshot);
  const toast = useSyncExternalStore(subscribeShareStore, getShareToastSnapshot, getShareToastSnapshot);
  const resolvedCover = useFileUrl(song?.coverUrl);

  if (typeof document === 'undefined') return null;

  const handleShareWhatsApp = async () => {
    if (!song) return;
    hapticImpact('medium');
    const text = getSongShareText(song);
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    closeShareSongModal();
    await openShareDeepLink(waUrl);
  };

  const handleShareInstagram = async () => {
    if (!song) return;
    hapticImpact('medium');
    await copySongShareLink(song);
    closeShareSongModal();
    const sharedNatively = await triggerNativeSystemShare(song);
    if (!sharedNatively) {
      showShareToast(
        'Enlace copiado para Instagram',
        'Pégalo directamente en un mensaje directo o en el sticker de Enlace de tu Historia'
      );
      await openShareDeepLink('https://www.instagram.com/');
    }
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

      {/* Hoja inferior de Compartir en Móvil (WhatsApp, Instagram, Telegram, etc.) */}
      <AnimatePresence>
        {song && (
          <div className="fixed inset-0 z-[750] flex flex-col justify-end font-sans">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={closeShareSongModal}
            />

            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="relative z-[751] w-full max-w-lg mx-auto bg-[#141416] border-t border-white/10 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto my-3 shrink-0" />

              {/* Cabecera con tarjeta de la canción */}
              <div className="px-5 pb-4 flex items-center justify-between gap-3 border-b border-white/5">
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <img
                    src={getThumbnailUrl(resolvedCover || song.coverUrl, 300) || DEFAULT_COVER}
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
                    onClick={handleShareInstagram}
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
};
