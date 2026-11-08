import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useFileUrl } from '../hooks/useFileUrl';
import {
  X, Users, Send, Crown, MessageSquare, Copy, Check, LogOut, LogIn,
  Hand, ArrowRightLeft, ListMusic, Flame, Search, Plus, Play, Sparkles, ChevronUp
} from 'lucide-react';
import { Visualizer } from './Visualizer';
import { Song } from '../constants';

interface Member { userId: string; username: string; avatar: string | null; isHost: boolean }
interface SessionMessage {
  id: string;
  user?: { userId: string; username: string; avatar: string | null };
  message: string;
  time: any;
  system?: boolean;
  kind?: string;
  reactions?: Record<string, string[]>;
}

interface LiveReactionItem {
  id: string;
  emoji: string;
  username: string;
}

interface SessionOverlayProps {
  onClose: () => void;
  token: string | null;
  user: any;
  currentSession: string | null;
  messages: SessionMessage[];
  members?: Member[];
  onSendMessage: (msg: string) => void;
  onSendReaction: (messageId: string, reaction: string) => void;
  onCreateSession: () => void;
  onJoinSession: (code: string) => void;
  onLeaveSession: () => void;
  isHost?: boolean;
  onTransferHost?: (targetUserId: string) => void;
  analyser?: AnalyserNode | null;
  active?: boolean;
  currentSong?: Song | null;
  queue?: Song[];
  allSongs?: Song[];
  sessionVotes?: Record<string, string[]>;
  onVoteTrack?: (songId: string) => void;
  onProposeTrack?: (song: Song) => void;
  liveReactions?: LiveReactionItem[];
  onSendLiveReaction?: (emoji: string) => void;
  onPlayFromQueue?: (song: Song) => void;
}

const Avatar: React.FC<{ m: { username: string; avatar: string | null }; size?: number }> = ({ m, size = 36 }) => {
  const src = useFileUrl(m.avatar || undefined);
  return src
    ? <img src={src} alt="" style={{ width: size, height: size }} className="rounded-full object-cover shrink-0 border border-white/10" />
    : <div style={{ width: size, height: size }} className="rounded-full shrink-0 bg-brand-primary/20 text-brand-primary border border-brand-primary/20 flex items-center justify-center text-xs font-black uppercase">
        {(m.username || '?').charAt(0)}
      </div>;
};

const TrackThumb: React.FC<{ url?: string; size?: number }> = ({ url, size = 42 }) => {
  const src = useFileUrl(url, true);
  return src ? (
    <img src={src} alt="" style={{ width: size, height: size }} className="rounded-xl object-cover shrink-0 border border-white/10 bg-white/5" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-xl shrink-0 bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
      <ListMusic size={16} />
    </div>
  );
};

const fmtTime = (t: any) => {
  const d = new Date(t);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const LIVE_EMOJIS = ['🔥', '❤️', '🚀', '🎸', '🤯', '👏', '✨'];

export const SessionOverlay: React.FC<SessionOverlayProps> = ({
  onClose, user, currentSession, messages, members = [], onSendMessage, onCreateSession, onJoinSession, onLeaveSession,
  isHost = false, onTransferHost, analyser, active, onSendReaction,
  currentSong, queue = [], allSongs = [], sessionVotes = {}, onVoteTrack, onProposeTrack,
  liveReactions = [], onSendLiveReaction, onPlayFromQueue
}) => {
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat');
  const [proposeQuery, setProposeQuery] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const myId = String(user?.userId ?? user?.id ?? '');
  const copyCode = async () => {
    if (!currentSession) return;
    try { await navigator.clipboard.writeText(currentSession); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft('');
  };
  const sayHi = () => onSendMessage('👋 ¡Hola a todos!');

  const getEmojiCounts = (reactions: Record<string, string[]> | undefined) => {
    if (!reactions) return {};
    const counts: Record<string, number> = {};
    Object.values(reactions).forEach(userEmojis => {
      if (Array.isArray(userEmojis)) {
        userEmojis.forEach(emoji => {
          counts[emoji] = (counts[emoji] || 0) + 1;
        });
      }
    });
    return counts;
  };

  // Calcular canciones siguientes en la cola
  const upcomingSongs = useMemo(() => {
    if (!Array.isArray(queue) || queue.length === 0) return [];
    if (!currentSong) return queue.slice(0, 50);
    const idx = queue.findIndex(s => String(s?.id) === String(currentSong.id));
    if (idx === -1) return queue.filter(s => String(s?.id) !== String(currentSong.id)).slice(0, 50);
    return queue.slice(idx + 1, idx + 51);
  }, [queue, currentSong]);

  // Buscador rápido para proponer canciones a la cola
  const proposeResults = useMemo(() => {
    const q = proposeQuery.trim().toLowerCase();
    if (!q || !Array.isArray(allSongs)) return [];
    return allSongs
      .filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [proposeQuery, allSongs]);

  const totalVotesCount = useMemo(() => {
    return Object.values(sessionVotes).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
  }, [sessionVotes]);

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl p-0 md:px-4 font-sans">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="relative bg-[#0c0c0c] border border-white/10 md:rounded-[40px] w-full max-w-5xl h-full md:h-[85vh] shadow-2xl flex flex-col md:flex-row overflow-hidden">

        {/* Contenedor flotante de reacciones en vivo */}
        <div className="pointer-events-none absolute bottom-24 right-6 z-[650] flex flex-col-reverse items-end gap-2 max-h-[60%] overflow-hidden">
          <AnimatePresence>
            {liveReactions.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 30, scale: 0.6 }}
                animate={{ opacity: 1, y: -20, scale: 1 }}
                exit={{ opacity: 0, y: -90, scale: 0.8 }}
                transition={{ duration: 2.4, ease: 'easeOut' }}
                className="flex items-center gap-2 bg-black/80 border border-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-xl"
              >
                <span className="text-xl leading-none">{r.emoji}</span>
                <span className="text-[10px] font-bold text-white/80 tracking-wide">{r.username}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Panel izquierdo: control + personas */}
        <div className="md:w-[340px] md:shrink-0 border-b md:border-b-0 md:border-r border-white/5 p-6 md:p-8 flex flex-col bg-black/20 max-h-[42%] md:max-h-none overflow-y-auto scrollbar-hide">
          <div className="flex items-start justify-between md:block">
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-tighter text-white font-serif italic">Sessions</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/20 mt-1 mb-6">Collaborative Listening</p>
            </div>
            <button onClick={onClose} className="md:hidden text-white/30 hover:text-white"><X size={22} /></button>
          </div>

          {!currentSession ? (
            <div className="space-y-8">
              <div>
                <button onClick={onCreateSession} className="w-full py-4 bg-brand-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all mb-3">Start New Session</button>
                <p className="text-[9px] text-white/20 text-center uppercase font-bold">You will be the host</p>
              </div>
              <div className="pt-8 border-t border-white/5">
                <input type="text" placeholder="ENTER CODE" maxLength={10} value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter' && joinCode.trim()) onJoinSession(joinCode); }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-center text-lg font-black tracking-[0.5em] text-white outline-none mb-4 focus:border-brand-primary transition-all" />
                <button onClick={() => onJoinSession(joinCode.trim().toUpperCase())} disabled={!joinCode.trim()}
                  className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all disabled:opacity-30 disabled:hover:scale-100 flex items-center justify-center gap-2">
                  <LogIn size={14} /> Join Session
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Código con botón de copiar */}
              <button onClick={copyCode} title="Copiar código"
                className="group relative overflow-hidden p-5 bg-brand-primary/10 border border-brand-primary/20 rounded-3xl text-center mb-5 hover:bg-brand-primary/15 transition-all">
                <div className="relative z-10">
                  <p className="text-[9px] font-bold text-brand-primary uppercase tracking-widest mb-2 flex items-center justify-center gap-2">
                    Active session code {copied ? <Check size={11} /> : <Copy size={11} className="opacity-60 group-hover:opacity-100" />}
                  </p>
                  <h4 className="text-3xl font-black text-white tracking-[0.4em] pl-[0.4em]">{currentSession}</h4>
                  <p className="text-[9px] text-white/30 mt-2 uppercase font-bold">{copied ? 'Copiado' : 'Toca para copiar'}</p>
                </div>
              </button>

              {/* Personas activas */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                  <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span>
                  En la sesión
                </span>
                <span className="text-[10px] font-black text-white/60 bg-white/5 rounded-full px-2.5 py-1">{members.length}</span>
              </div>
              <div className="flex-1 min-h-[80px] overflow-y-auto space-y-1.5 scrollbar-hide pr-1">
                <AnimatePresence initial={false}>
                  {members.map(m => (
                    <motion.div key={m.userId} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                      className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
                      <Avatar m={m} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white/90 truncate">{m.username}{m.userId === myId && <span className="text-white/30 font-normal"> (tú)</span>}</p>
                        {m.isHost && <p className="text-[9px] uppercase font-bold tracking-widest text-amber-400/80">Anfitrión</p>}
                      </div>
                      {isHost && !m.isHost && (
                        confirmTransferId === m.userId ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => { onTransferHost?.(m.userId); setConfirmTransferId(null); }}
                              className="text-[9px] font-bold uppercase bg-brand-primary text-black rounded-full px-2.5 py-1">Confirmar</button>
                            <button onClick={() => setConfirmTransferId(null)}
                              className="text-[9px] font-bold uppercase text-white/40 rounded-full px-2 py-1">No</button>
                          </div>
                        ) : (
                          <button title="Hacer anfitrión" onClick={() => setConfirmTransferId(m.userId)}
                            className="p-1.5 rounded-full text-white/30 hover:text-amber-400 hover:bg-amber-400/10 transition-all shrink-0">
                            <ArrowRightLeft size={13} />
                          </button>
                        )
                      )}
                      {m.isHost && <Crown size={14} className="text-amber-400 shrink-0" />}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {members.length === 0 && <p className="text-xs text-white/20 text-center py-4">Conectando…</p>}
              </div>

              <button onClick={onLeaveSession}
                className="mt-5 w-full py-3.5 border border-red-500/20 text-red-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2">
                <LogOut size={13} /> Leave Session
              </button>
            </div>
          )}
        </div>

        {/* Panel derecho: Chat en Vivo + Cola y Votación */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-16 md:h-20 border-b border-white/5 flex items-center justify-between px-4 md:px-8 shrink-0 gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  activeTab === 'chat'
                    ? 'bg-brand-primary text-black shadow-lg'
                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                }`}
              >
                <MessageSquare size={14} />
                <span>Chat en Vivo</span>
              </button>

              {currentSession && (
                <button
                  type="button"
                  onClick={() => setActiveTab('queue')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    activeTab === 'queue'
                      ? 'bg-brand-primary text-black shadow-lg'
                      : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <ListMusic size={14} />
                  <span>Cola y Votos</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                    activeTab === 'queue' ? 'bg-black/20 text-black' : 'bg-white/10 text-white/70'
                  }`}>
                    {upcomingSongs.length}
                  </span>
                  {totalVotesCount > 0 && (
                    <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                      activeTab === 'queue' ? 'bg-black/20 text-black' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      <Flame size={10} /> {totalVotesCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            <button onClick={onClose} className="hidden md:block text-white/20 hover:text-white"><X size={24} /></button>
          </div>

          {/* Contenido de la pestaña activa */}
          {activeTab === 'chat' ? (
            <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-4 scrollbar-hide">
              {!currentSession ? (
                <div className="h-full flex flex-col items-center justify-center opacity-10">
                  <Users size={64} className="mb-4" />
                  <p className="font-bold uppercase tracking-[0.3em] text-center">Waiting for Connection</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-white/20">
                  <MessageSquare size={40} className="mb-3" />
                  <p className="text-xs font-bold uppercase tracking-widest">Nadie ha hablado aún</p>
                </div>
              ) : messages.map((m, i) => {
                if (m.system) {
                  return (
                    <div key={i} className="flex justify-center">
                      <span className={`text-[11px] font-medium px-4 py-1.5 rounded-full border text-center ${
                        m.kind === 'join' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                        : m.kind === 'leave' ? 'bg-white/5 border-white/10 text-white/40'
                        : 'bg-brand-primary/10 border-brand-primary/20 text-brand-primary'}`}>
                        {m.message}
                      </span>
                    </div>
                  );
                }
                const msgUserId = String(m.user?.userId ?? (m.user as any)?.id ?? '');
                const mine = !!msgUserId && msgUserId === myId;
                return (
                  <div key={i} className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
                    {!mine && <Avatar m={{ username: m.user?.username ?? '?', avatar: m.user?.avatar ?? null }} size={32} />}
                    <div className={`flex flex-col max-w-[80%] ${mine ? 'items-end' : 'items-start'}`}>
                      <span className="text-[9px] font-bold uppercase text-white/25 mb-1 px-2">
                        {mine ? 'Tú' : m.user?.username} <span className="text-white/15 font-medium normal-case">{fmtTime(m.time)}</span>
                      </span>
                      <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'} group w-fit ${mine ? 'ml-auto' : 'mr-auto'}`}>
                        <div className={`px-5 py-3 rounded-2xl text-sm break-words ${mine ? 'bg-brand-primary text-black font-medium rounded-tr-none' : 'bg-white/5 text-white/80 rounded-tl-none border border-white/5'}`}>
                          {m.message}
                        </div>
                        <div className={`flex flex-wrap gap-1 px-1 ${mine ? 'justify-end flex-row-reverse ml-auto' : 'justify-start mr-auto'} w-fit`}>
                          {m.reactions && Object.entries(getEmojiCounts(m.reactions)).map(([emoji, count]) => (
                            <span key={emoji} className="text-[10px] bg-white/10 rounded-full px-1.5 py-0.5 flex items-center gap-1 cursor-pointer hover:bg-white/20 transition-all border border-white/5"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (typeof onSendReaction === 'function') {
                                  onSendReaction(m.id, emoji);
                                }
                              }}>
                              {emoji} <span className="text-white/60 font-bold">{count}</span>
                            </span>
                          ))}
                          <div className={`flex gap-1 px-1 border-l border-white/10 ml-1 opacity-0 group-hover:opacity-100 transition-opacity ${mine ? 'flex-row-reverse border-l-0 border-r' : ''}`}>
                            {['❤️', '🔥', '😂', '😮', '😢'].map(emoji => (
                              <button key={emoji} onClick={(e) => {
                                e.stopPropagation();
                                if (typeof onSendReaction === 'function') {
                                  onSendReaction(m.id, emoji);
                                }
                              }} className="hover:scale-125 transition-transform p-0.5">
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          ) : (
            /* Pestaña de Cola Colaborativa y Votación en Tiempo Real */
            <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6 scrollbar-hide">
              {/* Buscador para proponer canciones */}
              <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-4">
                <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-brand-primary transition-all">
                  <Search size={16} className="text-white/40 shrink-0" />
                  <input
                    type="text"
                    value={proposeQuery}
                    onChange={(e) => setProposeQuery(e.target.value)}
                    placeholder="Buscar en la biblioteca para proponer en la cola..."
                    className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
                  />
                  {proposeQuery && (
                    <button type="button" onClick={() => setProposeQuery('')} className="text-white/30 hover:text-white">
                      <X size={14} />
                    </button>
                  )}
                </div>

                {proposeResults.length > 0 && (
                  <div className="mt-3 space-y-1.5 max-h-56 overflow-y-auto pr-1 scrollbar-hide">
                    {proposeResults.map((song) => {
                      const voters = sessionVotes[String(song.id)] || [];
                      const inUpcoming = upcomingSongs.some(s => String(s.id) === String(song.id));
                      return (
                        <div key={song.id} className="flex items-center gap-3 p-2 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 transition-all">
                          <TrackThumb url={song.coverUrl} size={38} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-white truncate">{song.title}</p>
                            <p className="text-[10px] text-white/40 truncate">{song.artist}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onProposeTrack?.(song);
                              setProposeQuery('');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-brand-primary text-black text-[10px] font-black uppercase tracking-wider flex items-center gap-1 hover:scale-105 transition-all shrink-0"
                          >
                            <Plus size={12} />
                            {inUpcoming ? `Votar (${voters.length})` : 'Proponer'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sonando ahora */}
              {currentSong && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-primary mb-2.5 flex items-center gap-2">
                    <Sparkles size={12} /> Sonando Ahora en la Sala
                  </p>
                  <div className="flex items-center gap-4 p-3.5 rounded-3xl bg-brand-primary/10 border border-brand-primary/25">
                    <TrackThumb url={currentSong.coverUrl} size={52} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-white truncate">{currentSong.title}</p>
                      <p className="text-xs text-white/60 truncate">{currentSong.artist}</p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-brand-primary/20 text-brand-primary text-[9px] font-black uppercase tracking-widest">
                      En vivo
                    </span>
                  </div>
                </div>
              )}

              {/* Siguientes en Cola con Votación */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/50">
                    Siguientes en Cola · Vota para subir canciones
                  </p>
                  <span className="text-[10px] text-white/30 font-bold">{upcomingSongs.length} pistas</span>
                </div>

                {upcomingSongs.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-white/10 rounded-3xl">
                    <ListMusic size={32} className="mx-auto mb-2 text-white/20" />
                    <p className="text-xs font-bold text-white/40 uppercase tracking-widest">No hay pistas pendientes en la cola</p>
                    <p className="text-[11px] text-white/25 mt-1">Usa el buscador de arriba para proponer la siguiente canción</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {upcomingSongs.map((song, idx) => {
                      const sid = String(song.id);
                      const voters = Array.isArray(sessionVotes[sid]) ? sessionVotes[sid] : [];
                      const voteCount = voters.length;
                      const hasVoted = !!myId && voters.includes(myId);

                      return (
                        <motion.div
                          key={`${sid}-${idx}`}
                          layout
                          className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                            voteCount > 0
                              ? 'bg-brand-primary/[0.07] border-brand-primary/25'
                              : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                          }`}
                        >
                          <span className={`w-6 text-center text-[11px] font-black tabular-nums ${
                            idx === 0 && voteCount > 0 ? 'text-brand-primary' : 'text-white/30'
                          }`}>
                            #{idx + 1}
                          </span>

                          <TrackThumb url={song.coverUrl} size={42} />

                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-white truncate">{song.title}</p>
                            <p className="text-[11px] text-white/45 truncate">{song.artist}</p>
                          </div>

                          {isHost && onPlayFromQueue && (
                            <button
                              type="button"
                              onClick={() => onPlayFromQueue(song)}
                              title="Reproducir ahora (Anfitrión)"
                              className="p-2 rounded-xl bg-white/5 text-white/50 hover:text-white hover:bg-white/15 transition-all shrink-0"
                            >
                              <Play size={13} fill="currentColor" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onVoteTrack?.(sid)}
                            title={hasVoted ? 'Quitar mi voto' : 'Votar para que suene antes'}
                            className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shrink-0 ${
                              hasVoted
                                ? 'bg-brand-primary text-black shadow-md scale-105'
                                : voteCount > 0
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <ChevronUp size={15} strokeWidth={3} />
                            <span className="tabular-nums">{voteCount}</span>
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Barra rápida de reacciones en vivo + Input de chat */}
          {currentSession && (
            <div className="bg-black/40 border-t border-white/5 shrink-0">
              {/* Barra de reacciones flotantes en vivo */}
              <div className="px-4 md:px-8 pt-3 pb-1 flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide">
                <span className="text-[9px] font-black uppercase tracking-widest text-white/30 shrink-0">
                  Reacción en vivo:
                </span>
                <div className="flex items-center gap-1.5">
                  {LIVE_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onSendLiveReaction?.(emoji)}
                      className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/5 text-base leading-none hover:scale-125 active:scale-95 transition-all"
                      title={`Enviar ${emoji} a la sala`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'chat' && (
                <form onSubmit={send} className="p-4 md:px-8 md:pb-6 md:pt-3 flex gap-3">
                  <button type="button" onClick={sayHi} title="Saludar" className="p-4 bg-white/5 border border-white/10 text-white/70 rounded-2xl hover:bg-white/10 transition-all"><Hand size={20} /></button>
                  <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={500} autoComplete="off" placeholder="Say something to the group..."
                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-brand-primary transition-all" />
                  <button type="submit" disabled={!draft.trim()} className="p-4 bg-brand-primary text-black rounded-2xl hover:scale-105 transition-all disabled:opacity-30 disabled:hover:scale-100"><Send size={20} /></button>
                </form>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
