import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Clock, Disc3, Mic2, Loader2 } from 'lucide-react';

type Range = 'month' | 'year' | 'all';

interface TrackStat { trackId: string | null; title: string; artist: string; album: string | null; totalMs: number; plays: number }
interface ArtistStat { artist: string; totalMs: number; plays: number }
interface WrappedData {
  range: Range;
  totalMinutes: number;
  distinctTracks: number;
  topTracks: TrackStat[];
  topArtists: ArtistStat[];
}

interface WrappedOverlayProps {
  onClose: () => void;
  apiBase: string;
  token: string | null;
}

const RANGE_LABELS: Record<Range, string> = { month: 'Últimos 30 días', year: 'Este año', all: 'Desde siempre' };

export const WrappedOverlay: React.FC<WrappedOverlayProps> = ({ onClose, apiBase, token }) => {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const activeToken = token || localStorage.getItem('aura_token');
    fetch(`${apiBase}/api/stats/wrapped?range=${range}`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    })
      .then((r) => { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setError('No se ha podido cargar el resumen.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, apiBase, token]);

  const hasData = !!data && (data.topTracks.length > 0 || data.topArtists.length > 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[400] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl bg-gradient-to-b from-[#1a1220] to-[#0b0710] border border-brand-primary/20 p-6 text-white scrollbar-hide">

        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"><X size={18} /></button>

        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-brand-primary" />
          <h2 className="text-lg font-black uppercase tracking-tight">Tu Aura Wrapped</h2>
        </div>
        <p className="text-[11px] text-white/40 mb-5">Lo que más has escuchado</p>

        <div className="flex gap-2 mb-6">
          {(['month', 'year', 'all'] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`flex-1 text-[10px] font-bold uppercase tracking-wide py-2 rounded-full transition-all ${range === r ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-white/30 gap-2">
            <Loader2 size={22} className="animate-spin" />
            <p className="text-[11px]">Calculando…</p>
          </div>
        )}

        {!loading && error && (
          <p className="text-center text-[11px] text-red-400 py-10">{error}</p>
        )}

        {!loading && !error && data && !hasData && (
          <p className="text-center text-[11px] text-white/30 py-10">
            Todavía no hay suficiente escucha en este periodo. Vuelve cuando hayas puesto algo de música.
          </p>
        )}

        {!loading && !error && data && hasData && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-white/[0.04] border border-white/5 rounded-2xl p-4 text-center">
                <Clock size={16} className="text-brand-primary mx-auto mb-1.5" />
                <p className="text-2xl font-black tabular-nums">{data.totalMinutes}</p>
                <p className="text-[9px] uppercase font-bold text-white/40 tracking-widest">minutos</p>
              </div>
              <div className="bg-white/[0.04] border border-white/5 rounded-2xl p-4 text-center">
                <Disc3 size={16} className="text-brand-primary mx-auto mb-1.5" />
                <p className="text-2xl font-black tabular-nums">{data.distinctTracks}</p>
                <p className="text-[9px] uppercase font-bold text-white/40 tracking-widest">canciones distintas</p>
              </div>
            </div>

            {data.topArtists.length > 0 && (
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2">
                  <Mic2 size={12} /> Top artistas
                </p>
                <div className="space-y-2">
                  {data.topArtists.map((a, i) => (
                    <div key={a.artist} className="flex items-center gap-3">
                      <span className="text-lg font-black text-brand-primary/60 w-5 shrink-0 tabular-nums">{i + 1}</span>
                      <p className="text-sm font-semibold truncate flex-1">{a.artist}</p>
                      <span className="text-[10px] text-white/30 shrink-0 tabular-nums">{Math.round(a.totalMs / 60000)} min</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.topTracks.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2">
                  <Disc3 size={12} /> Top canciones
                </p>
                <div className="space-y-2">
                  {data.topTracks.map((t, i) => (
                    <div key={`${t.trackId}-${t.title}`} className="flex items-center gap-3">
                      <span className="text-lg font-black text-brand-primary/60 w-5 shrink-0 tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{t.title}</p>
                        <p className="text-[10px] text-white/30 truncate">{t.artist}</p>
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0 tabular-nums">{t.plays}x</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
