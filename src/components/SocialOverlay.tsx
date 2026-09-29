import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, UserPlus, Music, Activity, MessageSquare, ArrowRight, Clock } from 'lucide-react';
import { useFileUrl } from '../hooks/useFileUrl';

interface Friend {
  id: string;
  username: string;
  profile_pic_path: string | null;
  status: 'pending' | 'accepted' | 'blocked';
}

interface Activity {
  userId: string;
  trackId: string | null;
  title: string | null;
  artist: string | null;
  updatedAt: number;
}

interface SocialOverlayProps {
  onClose: () => void;
  user: any;
  token: string | null;
}

const Avatar: React.FC<{ u: Friend | { username: string; profile_pic_path: string | null }; size?: number }> = ({ u, size = 40 }) => {
  const src = useFileUrl(u.profile_pic_path || undefined);
  return src ? (
    <img src={src} alt="" style={{ width: size, height: size }} className="rounded-full object-cover border border-white/10" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-full bg-brand-primary/20 text-brand-primary border border-brand-primary/20 flex items-center justify-center text-xs font-black uppercase">
      {(u.username || '?').charAt(0)}
    </div>
  );
};

export const SocialOverlay: React.FC<SocialOverlayProps> = ({ onClose, user, token }) => {
  const [activeTab, setActiveTab] = useState<'activity' | 'friends'>('activity');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSocialData = async () => {
    if (!token) return;
    try {
      const [friendsRes, activityRes] = await Promise.all([
        fetch('/api/social/friends', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/social/activity', { headers: { Authorization: `Bearer ${token}` } })
      ]);

      const friendsData = await friendsRes.json();
      const activityData = await activityRes.json();

      // PROTECCIÓN: Solo guardamos si la respuesta es realmente un Array
      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setActivity(Array.isArray(activityData) ? activityData : []);

    } catch (e) {
      console.error("Failed to fetch social data", e);
      setFriends([]);
      setActivity([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSocialData();
    const interval = setInterval(fetchSocialData, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const sendFriendRequest = async (friendId: string) => {
    try {
      await fetch('/api/social/friend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendId })
      });
      fetchSocialData();
    } catch (e) {
      console.error("Request failed", e);
    }
  };

  // PROTECCIÓN EXTRA: Asegurar que friends es un array antes de filtrar
  const safeFriends = Array.isArray(friends) ? friends : [];
  const filteredFriends = safeFriends.filter(f =>
    f && f.username && f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl p-0 md:px-4 font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0c0c0c] border border-white/10 md:rounded-[40px] w-full max-w-5xl h-full md:h-[85vh] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-10 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary/10 rounded-2xl">
              <Users className="text-brand-primary" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-tighter text-white font-serif italic">Social Hub</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Connect & Listen Together</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white transition-colors">
            <X size={28} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-4 gap-2 bg-black/20 border-b border-white/5">
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'activity' ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <Activity size={14} /> Live Activity
            </div>
          </button>
          <button
            onClick={() => setActiveTab('friends')}
            className={`flex-1 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'friends' ? 'bg-brand-primary text-black' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <Users size={14} /> My Network
            </div>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 scrollbar-hide">
          {loading ? (
            <div className="h-full flex items-center justify-center text-white/20 font-bold uppercase tracking-widest">
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
                  className="flex items-center gap-4 p-4 rounded-3xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-all group"
                >
                  <div className="relative">
                    <Avatar u={{ username: 'User', profile_pic_path: null }} size={50} />
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0c0c0c] rounded-full"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Listening Now</p>
                    <p className="text-white font-bold truncate">{act.title || 'Unknown Track'}</p>
                    <p className="text-white/60 text-sm truncate">{act.artist || 'Unknown Artist'}</p>
                  </div>
                  <button className="p-3 rounded-full bg-brand-primary/10 text-brand-primary opacity-0 group-hover:opacity-100 transition-all hover:bg-brand-primary hover:text-black">
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
            <div className="space-y-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search friends..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 text-white outline-none focus:border-brand-primary transition-all"
                />
                <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredFriends.length > 0 ? filteredFriends.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-3">
                      <Avatar u={f} size={40} />
                      <div>
                        <p className="text-white font-bold">{f.username}</p>
                        <p className={`text-[9px] font-bold uppercase ${f.status === 'accepted' ? 'text-emerald-400' : 'text-white/30'}`}>
                          {f.status}
                        </p>
                      </div>
                    </div>
                    {f.status === 'pending' && (
                      <div className="flex items-center gap-2 text-white/20 text-[10px] font-bold uppercase tracking-widest">
                        <Clock size={12} /> Waiting
                      </div>
                    )}
                    {f.status === 'accepted' && (
                      <button className="p-2 rounded-xl bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-black transition-all">
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )) : (
                  <div className="col-span-full text-center py-12 text-white/20">
                    <p className="font-bold uppercase tracking-widest">No friends found</p>
                    <p className="text-xs mt-2">Start adding people to your network!</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SocialOverlay;
