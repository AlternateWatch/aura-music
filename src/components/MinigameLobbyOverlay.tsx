import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Gamepad2, Volume2, Search, Heart } from 'lucide-react';

interface MinigameLobbyOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: () => void;
}

export const MinigameLobbyOverlay: React.FC<MinigameLobbyOverlayProps> = ({ isOpen, onClose, onStart }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        className="fixed inset-0 z-[600] flex items-center justify-center bg-black/90 backdrop-blur-2xl px-4 font-sans"
      >
        <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, #f97316 0%, transparent 70%)' }} />

        <motion.div 
          initial={{ scale: 0.9, y: 20 }} 
          animate={{ scale: 1, y: 0 }} 
          exit={{ scale: 0.9, y: 20 }}
          className="bg-[#0a0a0a] border border-orange-500/20 rounded-[40px] p-10 md:p-16 w-full max-w-2xl shadow-[0_0_100px_rgba(249,115,22,0.15)] relative overflow-hidden flex flex-col items-center text-center"
        >
          <button onClick={onClose} className="absolute top-8 right-8 text-white/30 hover:text-white transition-colors cursor-pointer">
            <X size={28}/>
          </button>

          <div className="w-24 h-24 bg-orange-500/10 rounded-full flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(249,115,22,0.3)]">
            <Gamepad2 size={40} className="text-orange-500 animate-pulse" />
          </div>

          <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-white mb-4 font-serif italic text-glow">
            Aura <span className="text-orange-500">Recon</span>
          </h2>
          <p className="text-white/40 text-sm md:text-base font-medium mb-12 max-w-md">
            Test your musical knowledge. Listen to the fragment, search your library, and identify the correct track before you run out of lives.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-12 text-left">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden group">
                <Volume2 size={24} className="text-white/30 mb-4 group-hover:text-orange-400 transition-colors" />
                <h3 className="text-white font-bold text-lg mb-1">1. Listen</h3>
                <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest">10 Second Snippet</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden group">
                <Search size={24} className="text-white/30 mb-4 group-hover:text-orange-400 transition-colors" />
                <h3 className="text-white font-bold text-lg mb-1">2. Search</h3>
                <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest">Find in Library</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden group">
                <Heart size={24} className="text-white/30 mb-4 group-hover:text-red-500 transition-colors" />
                <h3 className="text-white font-bold text-lg mb-1">3. Survive</h3>
                <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest">You have 3 Lives</p>
            </div>
          </div>

          <button 
            onClick={onStart}
            className="w-full bg-orange-500 text-black py-5 rounded-2xl font-black uppercase text-lg tracking-[0.2em] shadow-[0_0_40px_rgba(249,115,22,0.4)] hover:bg-orange-400 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
          >
            Commence Link
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};