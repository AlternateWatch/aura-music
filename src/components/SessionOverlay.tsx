import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Send, Link, LogIn, Crown, MessageSquare } from 'lucide-react';

interface SessionOverlayProps {
  onClose: () => void;
  token: string | null;
  user: any;
  currentSession: string | null;
  messages: any[];
  onSendMessage: (msg: string) => void;
  onCreateSession: () => void;
  onJoinSession: (code: string) => void;
  onLeaveSession: () => void;
}

export const SessionOverlay: React.FC<SessionOverlayProps> = ({ 
  onClose, token, user, currentSession, messages, onSendMessage, onCreateSession, onJoinSession, onLeaveSession
}) => {
  const [joinCode, setJoinCode] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 font-sans">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#0c0c0c] border border-white/10 rounded-[40px] w-full max-w-4xl h-[80vh] shadow-2xl relative flex overflow-hidden">
        
        {/* Sidebar - Control */}
        <div className="w-1/3 border-r border-white/5 p-10 flex flex-col bg-black/20">
            <h2 className="text-2xl font-bold uppercase tracking-tighter text-white font-serif italic mb-2">Sessions</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/20 mb-10">Collaborative Listening</p>

            {!currentSession ? (
                <div className="space-y-8">
                    <div>
                        <button onClick={onCreateSession} className="w-full py-4 bg-brand-primary text-black rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all mb-4">Start New Session</button>
                        <p className="text-[9px] text-white/20 text-center uppercase font-bold">You will be the host</p>
                    </div>
                    <div className="pt-8 border-t border-white/5">
                        <input type="text" placeholder="ENTER CODE" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-center text-lg font-black tracking-[0.5em] text-white outline-none mb-4 focus:border-brand-primary transition-all" />
                        <button onClick={() => onJoinSession(joinCode)} className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all">Join Session</button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col h-full">
                    <div className="p-6 bg-brand-primary/10 border border-brand-primary/20 rounded-3xl text-center mb-8">
                        <p className="text-[9px] font-bold text-brand-primary uppercase tracking-widest mb-2">ACTIVE SESSION CODE</p>
                        <h4 className="text-3xl font-black text-white tracking-[0.4em]">{currentSession}</h4>
                    </div>
                    <button onClick={onLeaveSession} className="mt-auto w-full py-4 border border-red-500/20 text-red-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest hover:bg-red-500 hover:text-white transition-all">Terminate Connection</button>
                </div>
            )}
        </div>

        {/* Main - Chat */}
        <div className="flex-1 flex flex-col p-0">
            <div className="h-20 border-b border-white/5 flex items-center justify-between px-10">
                <div className="flex items-center gap-3">
                    <MessageSquare size={18} className="text-brand-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Session Broadcast</span>
                </div>
                <button onClick={onClose} className="text-white/20 hover:text-white"><X size={24}/></button>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-6 scrollbar-hide">
                {!currentSession ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-10">
                        <Users size={64} className="mb-4" />
                        <p className="font-bold uppercase tracking-[0.3em]">Waiting for Connection</p>
                    </div>
                ) : messages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.user.userId === user.userId ? 'items-end' : 'items-start'}`}>
                        <span className="text-[8px] font-bold uppercase text-white/20 mb-1 px-2">{m.user.username}</span>
                        <div className={`px-5 py-3 rounded-2xl text-sm max-w-[80%] ${m.user.userId === user.userId ? 'bg-brand-primary text-black font-medium rounded-tr-none' : 'bg-white/5 text-white/80 rounded-tl-none border border-white/5'}`}>
                            {m.message}
                        </div>
                    </div>
                ))}
                <div ref={chatEndRef} />
            </div>

            {currentSession && (
                <form onSubmit={(e) => { e.preventDefault(); const f = e.target as any; onSendMessage(f.msg.value); f.reset(); }} className="p-8 bg-black/40 border-t border-white/5 flex gap-4">
                    <input name="msg" autoComplete="off" placeholder="Say something to the group..." className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white outline-none focus:border-brand-primary transition-all" />
                    <button type="submit" className="p-4 bg-brand-primary text-black rounded-2xl hover:scale-105 transition-all"><Send size={20}/></button>
                </form>
            )}
        </div>
      </motion.div>
    </div>
  );
};