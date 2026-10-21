import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Download, CheckCircle2, X, ExternalLink, ArrowRight } from 'lucide-react';
import { type AppUpdateInfo, getDiffReleaseNotes } from '../hooks/useAppUpdate';
import { hapticImpact } from '../utils/haptics';
import { Capacitor } from '@capacitor/core';
import AuraMedia from '../plugins/auraMedia';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: AppUpdateInfo | null;
  currentVersion: string;
  isWhatsNew?: boolean;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
  currentVersion,
  isWhatsNew = false
}) => {
  const [downloadStarted, setDownloadStarted] = useState(false);

  const diffNotes = getDiffReleaseNotes(updateInfo, currentVersion);

  const notesToDisplay = useMemo(() => {
    if (!updateInfo) return '';
    if (isWhatsNew) {
      const match = updateInfo.history?.find((h) => h.version === currentVersion);
      return match?.notes || updateInfo.releaseNotes || 'Mejoras de rendimiento y estabilidad en esta versión.';
    }
    return diffNotes.notes || 'Mejoras de rendimiento y correcciones en la aplicación.';
  }, [isWhatsNew, updateInfo, currentVersion, diffNotes.notes]);

  const handleClose = () => {
    if (isWhatsNew) {
      localStorage.setItem('aura_last_seen_version', currentVersion);
    }
    onClose();
  };

  const handleStartUpdate = async () => {
    if (!updateInfo) return;
    hapticImpact('heavy');
    setDownloadStarted(true);

    const downloadUrl = updateInfo.downloadUrl;

    // Si estamos en la app nativa de Android, usamos el Intent nativo para abrir Chrome / navegador externo
    if (Capacitor.isNativePlatform() && AuraMedia?.openExternalUrl) {
      try {
        await AuraMedia.openExternalUrl({ url: downloadUrl });
        return;
      } catch (e) {
        console.warn('Error abriendo enlace con AuraMedia:', e);
      }
    }

    // En navegador web convencional o fallback:
    // Abrir una ventana/pestaña limpia primero o descargar directamente sin congelar el hilo UI
    try {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        // En móviles web, window.open o asignar directamente a window.location evita que el navegador descarte el evento
        const w = window.open(downloadUrl, '_blank');
        if (!w || w.closed || typeof w.closed === 'undefined') {
          window.location.assign(downloadUrl);
        }
      } else {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'aura-latest.apk';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          try { document.body.removeChild(link); } catch {}
        }, 100);
      }
    } catch {
      window.location.href = downloadUrl;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && updateInfo && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-[#141414] border border-white/10 rounded-[32px] p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fondo difuminado decorativo */}
            <div
              className="absolute -top-24 -right-24 w-60 h-60 rounded-full blur-3xl pointer-events-none"
              style={{ background: "var(--aura-dj-subtle, rgba(242,125,38,0.2))" }}
            />

            {/* Botón de cerrar */}
            {(!updateInfo.mandatory || isWhatsNew) && (
              <button
                onClick={handleClose}
                className="absolute top-5 right-5 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Cerrar aviso"
              >
                <X size={18} />
              </button>
            )}

            {/* Header con icono decorativo */}
            <div className="flex items-start gap-4 mb-5">
              <div className="w-13 h-13 rounded-2xl aura-dj-btn flex items-center justify-center shrink-0">
                <Sparkles size={24} className="text-white fill-white" />
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-brand-primary">
                    {isWhatsNew ? "Novedades de Aura" : "Actualización de Aura"}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight mt-0.5">
                  {isWhatsNew ? `¡Bienvenido a Aura v${currentVersion}!` : "Nueva versión disponible"}
                </h3>
              </div>
            </div>

            {/* Banner de estado o comparativa de versiones */}
            {isWhatsNew ? (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-brand-primary/10 border border-brand-primary/20 mb-5 text-xs text-brand-primary font-semibold">
                <CheckCircle2 size={16} className="shrink-0" />
                <span>Estás usando la versión v{currentVersion} recién instalada</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white/5 border border-white/5 mb-5 text-xs">
                <div className="flex items-center gap-1.5 text-white/50">
                  <span>Instalada:</span>
                  <span className="font-mono font-semibold text-white/80">v{currentVersion}</span>
                </div>
                <ArrowRight size={14} className="text-white/30 mx-1" />
                <div className="flex items-center gap-1.5">
                  <span className="text-brand-primary font-bold">Nueva:</span>
                  <span className="font-mono font-bold px-2 py-0.5 rounded-lg bg-brand-primary/20 text-brand-primary border border-brand-primary/30">
                    v{updateInfo.latestVersion}
                  </span>
                </div>
              </div>
            )}

            {/* Novedades y Release Notes */}
            <div className="space-y-1.5 mb-6">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">
                  {isWhatsNew
                    ? `Novedades incluidas en esta versión`
                    : diffNotes.isMultiVersion
                    ? `Novedades acumuladas (${diffNotes.versionsCount} versiones)`
                    : `Novedades del parche (v${updateInfo.latestVersion})`}
                </p>
                {!isWhatsNew && diffNotes.isMultiVersion && (
                  <span className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-brand-primary/15 text-brand-primary border border-brand-primary/20">
                    Desde v{currentVersion}
                  </span>
                )}
              </div>
              <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5 text-xs text-white/80 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-sans">
                {notesToDisplay}
              </div>
            </div>

            {/* Estado posterior a iniciar la descarga en modo update */}
            {!isWhatsNew && downloadStarted && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-5 flex items-start gap-3"
              >
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-emerald-200/90 leading-tight">
                  <p className="font-bold">¡Descarga iniciada en tu dispositivo!</p>
                  <p className="mt-1 text-white/60">
                    Revisa la barra de notificaciones de Android. Al finalizar, pulsa el archivo para instalar la actualización sin perder tus canciones ni configuración.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Botones de acción */}
            {isWhatsNew ? (
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm aura-dj-btn hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles size={18} />
                <span>¡Entendido, a escuchar música!</span>
              </button>
            ) : (
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={handleStartUpdate}
                  className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm aura-dj-btn hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download size={18} />
                  <span>{downloadStarted ? "Volver a descargar APK" : "Actualizar ahora"}</span>
                </button>

                {downloadStarted ? (
                  <a
                    href={updateInfo.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 text-center text-xs font-semibold text-white/50 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Descarga manual directa</span>
                    <ExternalLink size={12} />
                  </a>
                ) : !updateInfo.mandatory ? (
                  <button
                    onClick={handleClose}
                    className="w-full py-2.5 text-center text-xs font-semibold text-white/40 hover:text-white transition-colors cursor-pointer"
                  >
                    Más tarde
                  </button>
                ) : null}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
