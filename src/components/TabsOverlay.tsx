import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Guitar, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { type Song } from '../constants';

interface TabsOverlayProps {
  song: Song | null;
  onClose: () => void;
}

export const TabsOverlay: React.FC<TabsOverlayProps> = ({ song, onClose }) => {
  const [songData, setSongData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cleanString = (str: string) => {
    return str
      .replace(/\(.*\)/g, '')
      .replace(/\[.*\]/g, '')
      .replace(/- Single/gi, '')
      .replace(/Remastered|Official|Video|EP/gi, '')
      .trim();
  };

  useEffect(() => {
    if (!song) return;

    const findTabs = async () => {
      setIsLoading(true);
      setError(null);
      
      // FIXED: Correct reference to tabs_url to match DB and App.tsx mapping
      if (song.tabs_url) {
        setSongData({ 
            id: 'custom', 
            title: song.title, 
            artist: { name: song.artist },
            url: song.tabs_url 
        });
        setIsLoading(false);
        return;
      }

      const cleanedTitle = cleanString(song.title);
      const cleanedArtist = cleanString(song.artist).toLowerCase();
      
      try {
        const response = await fetch(`/api/proxy/tabs?pattern=${encodeURIComponent(cleanedTitle)}`);
        const results = await response.json();

        if (results && results.length > 0) {
          const match = results.find((r: any) => 
            r.artist.name.toLowerCase().includes(cleanedArtist) || 
            cleanedArtist.includes(r.artist.name.toLowerCase())
          );
          const finalMatch = match || results[0];
          setSongData({
            ...finalMatch,
            url: `https://www.songsterr.com/a/wa/song?id=${finalMatch.id}`
          });
        } else {
          setError(`No interactive tabs found for "${cleanedTitle}"`);
        }
      } catch (err) {
        setError("Tab Engine connection failure.");
      } finally {
        setIsLoading(false);
      }
    };

    findTabs();
  }, [song]);

  if (!song) return null;

  const handleLaunch = () => {
    if (songData?.url) {
      window.open(songData.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-2xl flex flex-col font-sans">
      <div className="h-20 flex items-center justify-between px-10 border-b border-white/5 bg-black/40">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-brand-primary/10 rounded-lg text-brand-primary"><Guitar size={20} /></div>
          <div>
            <h2 className="text-[14px] font-bold text-white tracking-[0.2em] uppercase font-serif italic leading-none">{song.title}</h2>
            <p className="text-[9px] text-white/30 font-bold uppercase tracking-[0.3em] mt-2">Interactive Tabs & Notation</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white"><X size={20} /></button>
      </div>

      <div className="flex-1 flex items-center justify-center p-10">
        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-brand-primary" size={40} />
            <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.3em]">Querying Songsterr Database...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 bg-red-500/5 rounded-full flex items-center justify-center mb-2"><AlertCircle className="text-red-500/40" size={32} /></div>
            <p className="text-[11px] font-bold text-white/30 uppercase tracking-[0.2em] max-w-xs leading-relaxed">{error}</p>
            <button onClick={onClose} className="mt-4 text-[9px] font-bold text-brand-primary uppercase border border-brand-primary/20 px-8 py-2.5 rounded-full hover:bg-brand-primary/10 transition-all tracking-widest">Return to Library</button>
          </div>
        ) : (
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-2xl bg-white/[0.02] border border-white/5 rounded-[40px] p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-brand-primary/5 to-transparent pointer-events-none" />
            <div className="relative z-10">
                <div className="w-24 h-24 mx-auto mb-8 rounded-3xl overflow-hidden shadow-2xl border border-white/10">
                    <img src={song.coverUrl || '/default-cover.jpg'} className="w-full h-full object-cover" alt="" />
                </div>
                <p className="text-brand-primary text-[10px] font-bold uppercase tracking-[0.4em] mb-3">Engine Synchronized</p>
                <h3 className="text-4xl md:text-5xl font-serif italic text-white tracking-tighter mb-2">{song.title}</h3>
                <p className="text-white/40 text-lg font-medium mb-12">by {songData.artist.name}</p>
                <div className="flex flex-col items-center gap-6">
                    <button onClick={handleLaunch} className="group flex items-center gap-4 bg-white text-black px-10 py-5 rounded-2xl font-bold uppercase text-[12px] tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(255,255,255,0.1)]">
                        <ExternalLink size={18} /> Launch Interactive Player
                    </button>
                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em] max-w-sm leading-relaxed">
                        The player will open in a secure window. You can change instruments, adjust tempo, and view notation there.
                    </p>
                </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="p-4 bg-black/60 border-t border-white/5 text-center">
        <p className="text-[8px] text-white/10 font-bold uppercase tracking-[0.4em]">
            AURA PORTAL v2.4 • Source: {songData?.id === 'custom' ? 'User-provided Link' : 'Songsterr Engine'}
        </p>
      </div>
    </motion.div>
  );
};