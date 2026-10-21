import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Shield, Calendar, Music, ListMusic, Loader2, Mail, Camera, Activity, Sparkles } from 'lucide-react';

// En Android (Capacitor) el origen es https://localhost, así que las rutas relativas
// como '/api/users/me' devolverían el index.html de la app en vez de la API.
const API_BASE = "https://aura.basildo.me";
const resolveUrl = (p?: string | null) =>
  !p ? undefined : p.startsWith('/') ? `${API_BASE}${p}` : p;

interface ProfileOverlayProps {
  onClose: () => void;
  token: string | null;
  isNormalizerEnabled: boolean;
  onToggleNormalizer: (val: boolean) => void;
  onOpenAudioSettings?: () => void;
  currentVersion?: string;
  isCheckingUpdate?: boolean;
  updateCheckMessage?: string | null;
  onCheckForUpdates?: () => void;
  onOpenWhatsNew?: () => void;
}

export const ProfileOverlay: React.FC<ProfileOverlayProps> = ({ 
  onClose,
  token,
  isNormalizerEnabled,
  onToggleNormalizer,
  onOpenAudioSettings,
  currentVersion = "1.0.0",
  isCheckingUpdate = false,
  updateCheckMessage = null,
  onCheckForUpdates,
  onOpenWhatsNew
}) => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/me`, { headers: { 'Authorization': `Bearer ${token}` } });
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
      const res = await fetch(`${API_BASE}/api/users/profile-pic`, {
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
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#121212] border border-white/10 rounded-[40px] p-8 sm:p-10 w-full max-w-lg shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-8 right-8 text-white/20 hover:text-white transition-colors"><X size={24}/></button>
        {loading ? (
            <div className="py-20 flex flex-col items-center gap-4"><Loader2 className="animate-spin text-brand-primary" size={32} /><p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Accessing Vault...</p></div>
        ) : (
            <>
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="relative group">
                        <div className="w-24 h-24 bg-gradient-to-br from-brand-primary to-purple-600 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(99,102,241,0.2)] overflow-hidden">
                            {profile?.profile_pic_path ? (
                                <img src={resolveUrl(profile.profile_pic_path)} className="w-full h-full object-cover" />
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
                    {onOpenAudioSettings && (
                        <button onClick={onOpenAudioSettings} className="mt-4 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-all outline-none">
                            Equalizer & loudness settings
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-10">
                    <div className="text-center p-6 bg-white/[0.02] border border-white/5 rounded-[24px]"><Music size={20} className="mx-auto mb-2 text-white/20" /><h4 className="text-2xl font-bold text-white">{profile?.stats?.tracks}</h4><p className="text-[8px] font-bold uppercase text-white/30 tracking-widest mt-1">Contributions</p></div>
                    <div className="text-center p-6 bg-white/[0.02] border border-white/5 rounded-[24px]"><ListMusic size={20} className="mx-auto mb-2 text-white/20" /><h4 className="text-2xl font-bold text-white">{profile?.stats?.playlists}</h4><p className="text-[8px] font-bold uppercase text-white/30 tracking-widest mt-1">Library Lists</p></div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-2xl"><Mail size={16} className="text-white/20" /><p className="text-sm font-medium text-white/60">{profile?.email}</p></div>

                {/* Sección Versión y Actualizaciones */}
                <div className="mt-4 p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Sparkles size={16} className="text-brand-primary" />
                        <div>
                            <p className="text-xs font-bold text-white leading-none">Aura Music</p>
                            <p className="text-[10px] text-white/40 mt-1">Versión {currentVersion || '1.0.0'}</p>
                        </div>
                    </div>
                    {onCheckForUpdates && (
                        <button
                            type="button"
                            onClick={onCheckForUpdates}
                            disabled={isCheckingUpdate}
                            className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-white transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                        >
                            {isCheckingUpdate ? (
                                <>
                                    <Loader2 size={12} className="animate-spin text-brand-primary" />
                                    <span>Buscando...</span>
                                </>
                            ) : (
                                <span>Buscar actualizaciones</span>
                            )}
                        </button>
                    )}
                </div>
                {updateCheckMessage && (
                    <p className="mt-2 text-center text-[10px] font-medium text-brand-primary/90 animate-in fade-in">
                        {updateCheckMessage}
                    </p>
                )}
            </>
        )}
      </motion.div>
    </div>
  );
};