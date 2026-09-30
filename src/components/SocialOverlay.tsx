import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, UserPlus, Music, Activity, MessageSquare, ArrowRight, Clock, Check, UserX, Search as SearchIcon, Radio, ArrowLeft, Send, MailPlus } from 'lucide-react';
import { useFileUrl } from '../hooks/useFileUrl';

interface Friend {
  id: string;
  username: string;
  profile_pic_path: string | null;
  status: 'pending' | 'accepted' | 'blocked';
}

interface FriendRequest {
  id: string;
  username: string;
  profile_pic_path: string | null;
}

interface SearchResult {
  id: string;
  username: string;
  profile_pic_path: string | null;
  outgoingStatus: 'pending' | 'accepted' | 'blocked' | null; // yo -> ellos
  incomingStatus: 'pending' | 'accepted' | 'blocked' | null; // ellos -> yo
}

interface LiveActivity {
  userId: string;
  username: string;
  profile_pic_path: string | null;
  trackId: string | null;
  title: string | null;
  artist: string | null;
  updatedAt: number;
}

interface ChatFriend {
  id: string;
  username: string;
  profile_pic_path: string | null;
}

interface ChatMessage {
  id: number;
  sender_id: string;
  receiver_id: string;
  message: string;
  created_at: string;
}

interface SocialOverlayProps {
  onClose: () => void;
  user: any;
  token: string | null;
  socket?: any; // socket.io del componente padre; sin él el chat solo funciona con recarga
  currentSession?: string | null; // si estás en una sesión, se puede invitar a la gente
}

const Avatar: React.FC<{ u: { username: string; profile_pic_path: string | null }; size?: number; ring?: boolean }> = ({ u, size = 40, ring = true }) => {
  const src = useFileUrl(u.profile_pic_path || undefined);
  const style = { width: size, height: size };
  const ringClass = ring ? 'ring-2 ring-white/10' : '';
  return src ? (
    <img src={src} alt="" style={style} className={`rounded-full object-cover shrink-0 ${ringClass}`} />
  ) : (
    <div style={style} className={`rounded-full bg-gradient-to-br from-brand-primary/30 to-brand-primary/5 text-brand-primary shrink-0 flex items-center justify-center font-black uppercase ${ringClass}`}>
      {(u.username || '?').charAt(0)}
    </div>
  );
};

export const SocialOverlay: React.FC<SocialOverlayProps> = ({ onClose, user, token, socket, currentSession }) => {
  const [activeTab, setActiveTab] = useState<'activity' | 'friends'>('activity');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [activity, setActivity] = useState<LiveActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // Chat privado (se abre desde la flecha de "My Network" o el globo de "Live Activity")
  const [activeChat, setActiveChat] = useState<ChatFriend | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  const fetchSocialData = async () => {
    if (!token) return;
    try {
      const [friendsRes, activityRes, requestsRes] = await Promise.all([
        fetch('/api/social/friends', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/social/activity', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/social/requests', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const friendsData = await friendsRes.json();
      const activityData = await activityRes.json();
      const requestsData = await requestsRes.json();

      // PROTECCIÓN: Solo guardamos si la respuesta es realmente un Array
      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setActivity(Array.isArray(activityData) ? activityData : []);
      setRequests(Array.isArray(requestsData) ? requestsData : []);

    } catch (e) {
      console.error("Failed to fetch social data", e);
      setFriends([]);
      setActivity([]);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSocialData();
    const interval = setInterval(fetchSocialData, 30000);
    return () => clearInterval(interval);
  }, [token]);

  // Mensajes que llegan mientras el chat con esa persona está abierto.
  useEffect(() => {
    if (!socket) return;
    const onMessage = (msg: ChatMessage) => {
      if (activeChat && String(msg.sender_id) === String(activeChat.id)) {
        setChatMessages(prev => [...prev, msg]);
      }
    };
    socket.on('receive-private-message', onMessage);
    return () => socket.off('receive-private-message', onMessage);
  }, [socket, activeChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openChat = async (friend: ChatFriend) => {
    setActiveChat(friend);
    setChatMessages([]);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/social/chat/${friend.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setChatMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('No se pudo cargar el chat', e);
    } finally {
      setChatLoading(false);
    }
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || !activeChat) return;
    setChatInput('');
    try {
      const res = await fetch('/api/social/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receiverId: activeChat.id, message: text }),
      });
      const saved = await res.json();
      setChatMessages(prev => [...prev, saved]);
      socket?.emit('send-private-message', { sender: user, receiverId: activeChat.id, message: text });
    } catch (e) {
      console.error('No se pudo enviar el mensaje', e);
    }
  };

  // Busca usuarios de verdad en el servidor a partir de 2 caracteres.
  // Con menos, se vuelve a la lista de amigos de siempre (searchResults = null).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || !token) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/social/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error('Social search failed', e);
          setSearchResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, token]);

  const sendFriendRequest = async (friendId: string) => {
    setSendingTo(friendId);
    try {
      await fetch('/api/social/friend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendId })
      });
      // Refleja el envío al momento en los resultados de búsqueda, sin esperar
      // a la siguiente búsqueda ni al refresco de la lista de amigos.
      setSearchResults(prev => prev ? prev.map(u => u.id === friendId ? { ...u, outgoingStatus: 'pending' } : u) : prev);
      fetchSocialData();
    } catch (e) {
      console.error("Request failed", e);
    } finally {
      setSendingTo(null);
    }
  };

  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const inviteToSession = (friendId: string) => {
    if (!currentSession || !socket) return;
    socket.emit('send-session-invite', { senderName: user?.username, receiverId: friendId, code: currentSession });
    setInvitedIds(prev => new Set(prev).add(friendId));
    setTimeout(() => setInvitedIds(prev => { const next = new Set(prev); next.delete(friendId); return next; }), 3000);
  };

  const respondToRequest = async (friendId: string, accept: boolean) => {
    setRespondingTo(friendId);
    // Se quita de la lista al momento, sin esperar a la respuesta del servidor.
    setRequests(prev => prev.filter(r => r.id !== friendId));
    try {
      await fetch('/api/social/friend-request/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendId, accept })
      });
      fetchSocialData();
    } catch (e) {
      console.error("Respond failed", e);
    } finally {
      setRespondingTo(null);
    }
  };

  // PROTECCIÓN EXTRA: Asegurar que friends es un array antes de filtrar
  const safeFriends = Array.isArray(friends) ? friends : [];
  const filteredFriends = safeFriends.filter(f =>
    f && f.username && f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const acceptedCount = safeFriends.filter(f => f.status === 'accepted').length;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl p-0 md:px-4 font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0c0c0c] border border-white/10 md:rounded-[40px] w-full max-w-5xl h-full md:h-[85vh] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-10 shrink-0 bg-gradient-to-r from-brand-primary/[0.06] to-transparent">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary/10 rounded-2xl">
              <Users className="text-brand-primary" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-tighter text-white font-serif italic">Social Hub</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">
                {acceptedCount} {acceptedCount === 1 ? 'amigo' : 'amigos'} · Connect & Listen Together
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white hover:rotate-90 transition-all duration-300">
            <X size={28} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-4 gap-2 bg-black/20 border-b border-white/5">
          <button
            onClick={() => setActiveTab('activity')}
            className={`relative flex-1 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'activity' ? 'bg-brand-primary text-black shadow-lg shadow-brand-primary/20' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <Activity size={14} /> Live Activity
              {activity.length > 0 && (
                <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${activeTab === 'activity' ? 'bg-black/20' : 'bg-brand-primary text-black'}`}>
                  {activity.length}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('friends')}
            className={`relative flex-1 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'friends' ? 'bg-brand-primary text-black shadow-lg shadow-brand-primary/20' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <Users size={14} /> My Network
              {requests.length > 0 && (
                <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center animate-pulse ${activeTab === 'friends' ? 'bg-black/20' : 'bg-red-500 text-white'}`}>
                  {requests.length}
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 scrollbar-hide">
          {loading ? (
            <div className="h-full flex items-center justify-center text-white/20 font-bold uppercase tracking-widest gap-3">
              <span className="w-2 h-2 rounded-full bg-brand-primary animate-ping" />
              Loading Social Hub...
            </div>
          ) : activeTab === 'activity' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.isArray(activity) && activity.length > 0 ? activity.map((act, i) => (
                <motion.div
                  key={act.userId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 p-4 rounded-3xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 hover:border-brand-primary/20 hover:from-white/[0.06] transition-all group"
                >
                  <div className="relative">
                    <Avatar u={{ username: act.username, profile_pic_path: act.profile_pic_path }} size={50} />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#0c0c0c] rounded-full flex items-center justify-center">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5">
                      <Radio size={10} className="text-emerald-400" /> {act.username} · Escuchando ahora
                    </p>
                    <p className="text-white font-bold truncate">{act.title || 'Unknown Track'}</p>
                    <p className="text-white/60 text-sm truncate">{act.artist || 'Unknown Artist'}</p>
                  </div>
                  <button
                    onClick={() => openChat({ id: act.userId, username: act.username, profile_pic_path: act.profile_pic_path })}
                    className="p-3 rounded-full bg-brand-primary/10 text-brand-primary opacity-0 group-hover:opacity-100 transition-all hover:bg-brand-primary hover:text-black"
                  >
                    <MessageSquare size={18} />
                  </button>
                </motion.div>
              )) : (
                <div className="col-span-full h-64 flex flex-col items-center justify-center text-white/20">
                  <Music size={48} className="mb-4 opacity-20" />
                  <p className="font-bold uppercase tracking-widest">No friends are listening right now</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {/* Solicitudes pendientes */}
              {requests.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2">
                    <UserPlus size={12} className="text-brand-primary" /> Solicitudes pendientes ({requests.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <AnimatePresence>
                      {requests.map(r => (
                        <motion.div
                          key={r.id}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="flex items-center justify-between p-4 rounded-2xl bg-brand-primary/[0.06] border border-brand-primary/20"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar u={r} size={40} />
                            <p className="text-white font-bold truncate">{r.username}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => respondToRequest(r.id, true)}
                              disabled={respondingTo === r.id}
                              title="Aceptar"
                              className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all disabled:opacity-40"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => respondToRequest(r.id, false)}
                              disabled={respondingTo === r.id}
                              title="Rechazar"
                              className="p-2 rounded-xl bg-white/5 text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-40"
                            >
                              <UserX size={16} />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              <div>
                <div className="relative">
                  <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                  <input
                    type="text"
                    placeholder="Busca a alguien por su nombre de usuario..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 pr-12 text-white outline-none focus:border-brand-primary focus:bg-white/[0.07] transition-all"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors">
                      <X size={16} />
                    </button>
                  )}
                </div>

                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-6 mb-3">
                  {searchQuery.trim().length >= 2 ? 'Resultados' : 'Tus amigos'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {searchQuery.trim().length >= 2 ? (
                    searching && !searchResults ? (
                      <div className="col-span-full text-center py-12 text-white/20 font-bold uppercase tracking-widest text-xs">Buscando...</div>
                    ) : searchResults && searchResults.length > 0 ? searchResults.map(u => {
                      const isFriend = u.outgoingStatus === 'accepted' || u.incomingStatus === 'accepted';
                      const requestSent = u.outgoingStatus === 'pending';
                      const requestReceived = u.incomingStatus === 'pending' && !requestSent;
                      return (
                        <div key={u.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar u={u} size={40} />
                            <div className="min-w-0">
                              <p className="text-white font-bold truncate">{u.username}</p>
                              {isFriend && <p className="text-[9px] font-bold uppercase text-emerald-400">Ya sois amigos</p>}
                              {requestSent && <p className="text-[9px] font-bold uppercase text-white/30">Solicitud enviada</p>}
                              {requestReceived && <p className="text-[9px] font-bold uppercase text-brand-primary">Te ha enviado una solicitud</p>}
                            </div>
                          </div>
                          {isFriend ? (
                            <div className="flex items-center gap-2 shrink-0">
                              {currentSession && (
                                <button
                                  onClick={() => inviteToSession(u.id)}
                                  disabled={invitedIds.has(u.id)}
                                  title="Invitar a la sesión"
                                  className={`p-2 rounded-xl transition-all ${invitedIds.has(u.id) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40 hover:bg-brand-primary/10 hover:text-brand-primary'}`}
                                >
                                  {invitedIds.has(u.id) ? <Check size={16} /> : <MailPlus size={16} />}
                                </button>
                              )}
                              <button onClick={() => openChat(u)} className="p-2 rounded-xl bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-black transition-all">
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          ) : requestSent ? (
                            <div className="flex items-center gap-2 text-white/20 text-[10px] font-bold uppercase tracking-widest shrink-0">
                              <Clock size={12} /> Waiting
                            </div>
                          ) : requestReceived ? (
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => respondToRequest(u.id, true)} title="Aceptar" className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all">
                                <Check size={16} />
                              </button>
                              <button onClick={() => respondToRequest(u.id, false)} title="Rechazar" className="p-2 rounded-xl bg-white/5 text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-all">
                                <UserX size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => sendFriendRequest(u.id)}
                              disabled={sendingTo === u.id}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-primary text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:brightness-110 transition-all shrink-0"
                            >
                              <UserPlus size={14} /> {sendingTo === u.id ? 'Enviando...' : 'Añadir'}
                            </button>
                          )}
                        </div>
                      );
                    }) : (
                      <div className="col-span-full text-center py-12 text-white/20">
                        <p className="font-bold uppercase tracking-widest">No se ha encontrado a nadie</p>
                        <p className="text-xs mt-2">Comprueba que el nombre de usuario esté bien escrito.</p>
                      </div>
                    )
                  ) : filteredFriends.length > 0 ? filteredFriends.map(f => (
                    <div key={f.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar u={f} size={40} />
                        <div className="min-w-0">
                          <p className="text-white font-bold truncate">{f.username}</p>
                          <p className={`text-[9px] font-bold uppercase flex items-center gap-1 ${f.status === 'accepted' ? 'text-emerald-400' : 'text-white/30'}`}>
                            {f.status === 'accepted' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                            {f.status === 'accepted' ? 'Amigos' : f.status}
                          </p>
                        </div>
                      </div>
                      {f.status === 'pending' && (
                        <div className="flex items-center gap-2 text-white/20 text-[10px] font-bold uppercase tracking-widest shrink-0">
                          <Clock size={12} /> Waiting
                        </div>
                      )}
                      {f.status === 'accepted' && (
                        <div className="flex items-center gap-2 shrink-0">
                          {currentSession && (
                            <button
                              onClick={() => inviteToSession(f.id)}
                              disabled={invitedIds.has(f.id)}
                              title="Invitar a la sesión"
                              className={`p-2 rounded-xl transition-all ${invitedIds.has(f.id) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40 hover:bg-brand-primary/10 hover:text-brand-primary'}`}
                            >
                              {invitedIds.has(f.id) ? <Check size={16} /> : <MailPlus size={16} />}
                            </button>
                          )}
                          <button onClick={() => openChat(f)} className="p-2 rounded-xl bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-black transition-all">
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  )) : (
                    <div className="col-span-full text-center py-12 text-white/20">
                      <Users size={40} className="mx-auto mb-3 opacity-20" />
                      <p className="font-bold uppercase tracking-widest">No friends found</p>
                      <p className="text-xs mt-2">Escribe un nombre arriba para buscar y añadir gente nueva.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel de chat privado, se desliza por encima del resto */}
        <AnimatePresence>
          {activeChat && (
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-0 bg-[#0c0c0c] flex flex-col"
            >
              <div className="h-20 border-b border-white/5 flex items-center gap-4 px-6 md:px-10 shrink-0">
                <button onClick={() => setActiveChat(null)} className="text-white/40 hover:text-white transition-colors">
                  <ArrowLeft size={22} />
                </button>
                <Avatar u={activeChat} size={36} />
                <p className="font-bold text-white">{activeChat.username}</p>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-3 scrollbar-hide">
                {chatLoading ? (
                  <div className="h-full flex items-center justify-center text-white/20 font-bold uppercase tracking-widest text-xs">Cargando conversación...</div>
                ) : chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-white/20">
                    <MessageSquare size={40} className="mb-3 opacity-20" />
                    <p className="font-bold uppercase tracking-widest text-xs">Aún no hay mensajes</p>
                    <p className="text-xs mt-1">Escribe algo para empezar la conversación.</p>
                  </div>
                ) : chatMessages.map((m) => {
                  const mine = String(m.sender_id) === String(user?.userId);
                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm max-w-[75%] ${mine ? 'bg-brand-primary text-black rounded-tr-sm' : 'bg-white/5 text-white/80 rounded-tl-sm'}`}>
                        {m.message}
                      </div>
                      <span className="text-[9px] text-white/20 mt-1 uppercase font-bold">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 md:p-10 pt-0 shrink-0">
                <div className="relative">
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                    placeholder="Escribe un mensaje..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pr-14 text-white outline-none focus:border-brand-primary transition-all"
                  />
                  <button onClick={sendChatMessage} className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-brand-primary text-black hover:brightness-110 transition-all">
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default SocialOverlay;
