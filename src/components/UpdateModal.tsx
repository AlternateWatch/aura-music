import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Download, CheckCircle2, X, ExternalLink, ShieldAlert, ArrowRight } from 'lucide-react';
import { type AppUpdateInfo } from '../hooks/useAppUpdate';
import { hapticImpact } from '../utils/haptics';
import { Capacitor } from '@capacitor/core';
import AuraMedia from '../plugins/auraMedia';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: AppUpdateInfo | null;
  currentVersion: string;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
  currentVersion
}) => {
  const [downloadStarted, setDownloadStarted] = useState(false);

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

    // En navegador web convencional o fallback
    try {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'aura-latest.apk';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
            <div className="absolute -top-24 -right-24 w-60 h-60 bg-gradient-to-br from-amber-500/20 via-[#F27D26]/20 to-rose-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Botón de cerrar si no es obligatoria */}
            {!updateInfo.mandatory && (
              <button
                onClick={onClose}
                className="absolute top-5 right-5 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Cerrar aviso"
              >
                <X size={18} />
              </button>
            )}

            {/* Header con icono decorativo */}
            <div className="flex items-start gap-4 mb-5">
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-amber-500 via-[#F27D26] to-rose-500 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                <Sparkles size={24} className="text-white fill-white" />
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-brand-primary">
                    Actualización de Aura
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight mt-0.5">
                  Nueva versión disponible
                </h3>
              </div>
            </div>

            {/* Comparativa de versiones */}
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

            {/* Novedades y Release Notes */}
            <div className="space-y-1.5 mb-6">
              <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">
                Novedades de esta versión
              </p>
              <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5 text-xs text-white/80 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap font-sans">
                {updateInfo.releaseNotes || "Mejoras de rendimiento y correcciones en la aplicación."}
              </div>
            </div>

            {/* Estado posterior a iniciar la descarga */}
            {downloadStarted && (
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
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleStartUpdate}
                className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm bg-gradient-to-r from-amber-500 via-[#F27D26] to-rose-500 text-white shadow-lg shadow-orange-500/25 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
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
                  onClick={onClose}
                  className="w-full py-2.5 text-center text-xs font-semibold text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  Más tarde
                </button>
              ) : null}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
