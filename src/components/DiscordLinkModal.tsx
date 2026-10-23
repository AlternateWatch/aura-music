import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link2, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';

interface DiscordLinkModalProps {
  code: string;
  token: string | null;
  user: any;
  apiBase: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const DiscordLinkModal: React.FC<DiscordLinkModalProps> = ({
  code,
  token,
  user,
  apiBase,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(true);
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('pending');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${apiBase}/api/link-info?code=${encodeURIComponent(code)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Código no encontrado');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.status === 'expired') {
          setError('Este código de vinculación ha caducado. Vuelve a escribir /link en Discord.');
          setStatus('expired');
        } else if (data.status === 'linked') {
          setError('Este código ya ha sido utilizado para vincular una cuenta.');
          setStatus('linked');
        } else {
          setDiscordUsername(data.discord_username || 'Usuario de Discord');
          setStatus('pending');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'No se pudo verificar el código de vinculación.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, apiBase]);

  const handleConfirm = async () => {
    if (!token) return;
    setConfirming(true);
    setError(null);

    try {
      const activeToken = token || localStorage.getItem('aura_token');
      const res = await fetch(`${apiBase}/api/link-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al vincular la cuenta.');
      }

      setSuccess(true);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Error al vincular con Discord.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/75 backdrop-blur-md px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-gradient-to-b from-[#181824] to-[#0f0f17] border border-[#5865F2]/30 rounded-3xl p-6 sm:p-8 w-full max-w-md relative text-white shadow-2xl shadow-[#5865F2]/10"
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-white/40 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={32} className="animate-spin text-[#5865F2]" />
            <p className="text-xs text-white/50">Verificando código de Discord…</p>
          </div>
        ) : success ? (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
              <CheckCircle2 size={36} />
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-2">¡Cuentas vinculadas!</h3>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Tu cuenta de Aura (<span className="text-white font-bold">{user?.username}</span>) ahora está vinculada con Discord (<span className="text-[#5865F2] font-bold">@{discordUsername}</span>). Lo que escuches en el bot de Discord se sumará a tus estadísticas y a tu Aura Wrapped.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-emerald-500 text-black font-black uppercase tracking-wider text-xs hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-base font-black uppercase tracking-tight mb-2">No se pudo vincular</h3>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">{error}</p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#5865F2]/10 border border-[#5865F2]/30 flex items-center justify-center text-[#5865F2] mb-4">
              <Link2 size={32} />
            </div>

            <h3 className="text-lg font-black uppercase tracking-tight mb-1">
              ¿Vincular cuenta de Discord?
            </h3>
            <p className="text-xs text-white/50 mb-6">
              Conecta tu Discord para registrar las escuchas del bot en tu perfil.
            </p>

            <div className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 mb-6 flex items-center justify-between gap-3">
              <div className="flex-1 text-left">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block">Discord</span>
                <span className="text-sm font-black text-[#5865F2] truncate block">@{discordUsername}</span>
              </div>
              <div className="text-white/20">
                <Link2 size={18} />
              </div>
              <div className="flex-1 text-right">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block">Aura</span>
                <span className="text-sm font-black text-white truncate block">{user?.username}</span>
              </div>
            </div>

            <div className="flex flex-col w-full gap-2">
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="w-full py-3.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white font-black uppercase tracking-wider text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {confirming ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Vinculando…</span>
                  </>
                ) : (
                  <span>Confirmar vinculación</span>
                )}
              </button>

              <button
                onClick={onClose}
                disabled={confirming}
                className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-bold uppercase tracking-wider text-[11px] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
