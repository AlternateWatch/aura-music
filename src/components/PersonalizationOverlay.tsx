import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Palette, Check, Image as ImageIcon, Loader2 } from 'lucide-react';

export interface Theme {
  id: string;
  name: string;
  preview: string;
  color: string;
  className: string;
}

export const THEMES: Theme[] = [
  { id: 'dark', name: 'Void Black', preview: 'bg-black', color: '#6366f1', className: 'bg-[#050505] text-white' },
  { id: 'light', name: 'Pure White', preview: 'bg-gray-100', color: '#ffffff', className: 'bg-white text-black' },
  { id: 'nebula', name: 'Nebula', preview: 'bg-gradient-to-br from-indigo-900 via-purple-900 to-black', color: '#ec4899', className: 'bg-[#0a001a] text-white' },
  { id: 'sunset', name: 'Sunset', preview: 'bg-gradient-to-br from-orange-600 to-rose-900', color: '#f59e0b', className: 'bg-[#1a0a00] text-white' },
  { id: 'emerald', name: 'Emerald', preview: 'bg-gradient-to-br from-emerald-900 to-black', color: '#10b981', className: 'bg-[#001a0a] text-white' },
  { id: 'custom', name: 'Custom Wall', preview: 'bg-zinc-800', color: '#6366f1', className: 'bg-black text-white' },
];

interface PersonalizationOverlayProps {
  onClose: () => void;
  activeTheme: string;
  onThemeSelect: (id: string) => void;
  token: string | null;
  onBackgroundUpload: (url: string) => void;
}

export const PersonalizationOverlay: React.FC<PersonalizationOverlayProps> = ({ 
  onClose, activeTheme, onThemeSelect, token, onBackgroundUpload 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('custom_bg', file);
    try {
      const res = await fetch('/api/users/custom-bg', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        onBackgroundUpload(data.custom_bg_path);
        onThemeSelect('custom');
      }
    } catch (e) { console.error("BG Upload error"); }
    setIsUploading(false);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 font-sans">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-[#121212] border border-white/10 rounded-[40px] p-10 w-full max-w-2xl shadow-2xl relative">
        <button onClick={onClose} className="absolute top-8 right-8 text-white/20 hover:text-white"><X size={24}/></button>
        
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary/10 rounded-2xl text-brand-primary"><Palette size={24} /></div>
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-tighter text-white font-serif italic">Personalization</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Customize your AURA environment</p>
            </div>
          </div>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 bg-white/5 border border-white/10 px-5 py-3 rounded-2xl hover:bg-white/10 transition-all"
          >
            {isUploading ? <Loader2 className="animate-spin text-brand-primary" size={16} /> : <ImageIcon size={16} />}
            <span className="text-[10px] font-bold uppercase tracking-widest text-white">Upload Wall</span>
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleUpload} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {THEMES.map((theme) => (
            <div key={theme.id} onClick={() => onThemeSelect(theme.id)} className={`group cursor-pointer relative rounded-[24px] p-4 border-2 transition-all duration-500 ${activeTheme === theme.id ? 'border-brand-primary bg-white/5' : 'border-white/5 bg-white/[0.02] hover:border-white/20'}`}>
              <div className={`w-full aspect-video rounded-xl mb-3 shadow-inner overflow-hidden ${theme.preview}`}>
                  {activeTheme === theme.id && <div className="w-full h-full flex items-center justify-center bg-black/20"><Check className="text-white" size={24} /></div>}
              </div>
              <p className={`text-xs font-bold uppercase tracking-widest text-center ${activeTheme === theme.id ? 'text-brand-primary' : 'text-white/40'}`}>{theme.name}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};