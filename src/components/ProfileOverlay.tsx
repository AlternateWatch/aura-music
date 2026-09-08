import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Shield, Calendar, Music, ListMusic, Loader2, Mail, Camera, Activity } from 'lucide-react';

interface ProfileOverlayProps {
  onClose: () => void;
  token: string | null;
  isNormalizerEnabled: boolean;
  onToggleNormalizer: (val: boolean) => void;
}

export const ProfileOverlay: React.FC<ProfileOverlayProps> = ({ 
  onClose, token, isNormalizerEnabled, onToggleNormalizer 
}) => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/users/me', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      setProfile(data);
    } catch (e) { console.error("Profile load error", e); }
    setLoading(false);
  };

  useEffect(() => { fetchProfile(); }, [token]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('profile_pic', file);
    try {
      const res = await fetch('/api/users/profile-pic', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        const currentUser = JSON.parse(localStorage.getItem('aura_user') || '{}');
        localStorage.setItem('aura_user', JSON.stringify({ ...currentUser, profile_pic_path: data.profile_pic_path }));
        fetchProfile(); 
      }
    } catch (e) { console.error("Upload failed"); }
    setIsUploading(false);
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 font-sans">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-[40px] p-10 w-full max-w-lg shadow-2xl relative overflow-hidden">
        <button onClick={onClose} className="absolute top-8 right-8 text-white/20 hover:text-white transition-colors"><X size={24}/></button>
        {loading ? (
            <div className="py-20 flex flex-col items-center gap-4"><Loader2 className="animate-spin text-brand-primary" size={32} /><p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Accessing Vault...</p></div>
        ) : (
            <>
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="relative group">
                        <div className="w-24 h-24 bg-gradient-to-br from-brand-primary to-purple-600 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(99,102,241,0.2)] overflow-hidden">
                            {profile?.profile_pic_path ? (
                                <img src={profile.profile_pic_path} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-3xl font-black text-black uppercase">{profile?.username?.[0]}</span>
                            )}
                        </div>
                        <button onClick={() => fileInputRef.current?.click()} className="absolute bottom-4 right-0 p-2 bg-white text-black rounded-full shadow-xl hover:scale-110 transition-all">
                            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                        </button>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                    </div>
                    <h2 className="text-3xl font-bold uppercase tracking-tighter text-white font-serif italic">{profile?.username}</h2>
                    <span className="mt-2 px-3 py-1 bg-white/5 rounded-full text-[10px] font-bold uppercase tracking-widest text-white/40 border border-white/5">{profile?.role}</span>
                </div>

                <div className="mb-10 p-6 bg-white/[0.02] border border-white/5 rounded-[24px]">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Activity className="text-brand-primary" size={18} />
                            <div><p className="text-sm font-bold text-white leading-none">Normalizer</p><p className="text-[9px] font-bold uppercase text-white/20 tracking-wider mt-1">Automatic Volume Leveling</p></div>
                        </div>
                        <button onClick={() => onToggleNormalizer(!isNormalizerEnabled)} className={`w-12 h-6 rounded-full transition-all relative ${isNormalizerEnabled ? 'bg-brand-primary' : 'bg-white/10'}`}>
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isNormalizerEnabled ? 'left-7' : 'left-1'}`} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-10">
                    <div className="text-center p-6 bg-white/[0.02] border border-white/5 rounded-[24px]"><Music size={20} className="mx-auto mb-2 text-white/20" /><h4 className="text-2xl font-bold text-white">{profile?.stats?.tracks}</h4><p className="text-[8px] font-bold uppercase text-white/30 tracking-widest mt-1">Contributions</p></div>
                    <div className="text-center p-6 bg-white/[0.02] border border-white/5 rounded-[24px]"><ListMusic size={20} className="mx-auto mb-2 text-white/20" /><h4 className="text-2xl font-bold text-white">{profile?.stats?.playlists}</h4><p className="text-[8px] font-bold uppercase text-white/30 tracking-widest mt-1">Library Lists</p></div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-2xl"><Mail size={16} className="text-white/20" /><p className="text-sm font-medium text-white/60">{profile?.email}</p></div>
            </>
        )}
      </motion.div>
    </div>
  );
};