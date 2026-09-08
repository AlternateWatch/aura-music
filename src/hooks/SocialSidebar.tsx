import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X, Search, Activity, UserPlus, Check, MessageCircle, UserMinus, ArrowLeft, Send, MailPlus, Users } from "lucide-react";

export function SocialSidebar({ token, user, socket, unreadSenders, setUnreadSenders, currentSession, onClose }: any) {
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [friends, setFriends] = useState<any[]>([]);
    const [pending, setPending] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [activeChat, setActiveChat] = useState<any | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [chatInput, setChatInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    const loadSocial = async () => {
        try {
            const res = await fetch('/api/social/friends', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (res.ok) { setFriends(data.friends || []); setPending(data.pending || []); }
        } catch (e) { console.error("Social load failed", e); }
    };

    const fetchSearch = async (q: string) => {
        setIsSearching(true);
        try {
            const res = await fetch(`/api/social/search?q=${q}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            setResults(data || []);
        } catch(e) {}
        setIsSearching(false);
    };

    useEffect(() => { loadSocial(); fetchSearch(""); }, []);
    useEffect(() => { const t = setTimeout(() => fetchSearch(search), 200); return () => clearTimeout(t); }, [search]);

    useEffect(() => {
        if (!socket) return;
        const h = (msg: any) => { if (activeChat && String(msg.sender_id) === String(activeChat.id)) setMessages(p => [...p, msg]); };
        socket.on('receive-private-message', h);
        return () => { socket.off('receive-private-message', h); };
    }, [activeChat, socket]);

    useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const openChat = async (f: any) => {
        setActiveChat(f);
        setUnreadSenders((p: string[]) => p.filter(id => id !== String(f.id)));
        const res = await fetch(`/api/social/chat/${f.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
        setMessages(await res.json());
    };

    const sendMessage = async () => {
        if (!chatInput.trim() || !activeChat) return;
        const res = await fetch('/api/social/chat', { method: "POST", headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ receiverId: activeChat.id, message: chatInput }) });
        const msg = await res.json();
        setMessages(p => [...p, msg]);
        socket?.emit('send-private-message', { sender: user, receiverId: activeChat.id, message: chatInput });
        setChatInput("");
    };

    return (
        <motion.div 
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} 
          // FIXED: Responsive width (full screen on mobile, 80 on desktop)
          className="fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-[#0f0f0f]/95 border-l border-white/10 z-[300] p-6 md:p-8 flex flex-col gap-6 md:gap-8 shadow-2xl backdrop-blur-xl text-white font-sans"
        >
            {!activeChat ? (
                <>
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold uppercase tracking-tighter italic font-serif">Circle</h2>
                        <button onClick={onClose} className="opacity-40 hover:opacity-100 p-2"><X/></button>
                    </div>
                    <div className="relative">
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find producers..." className="w-full bg-white/5 border border-white/10 p-3 rounded-xl outline-none focus:border-brand-primary" />
                        <div className="absolute right-3 top-4">{isSearching ? <Activity size={14} className="animate-spin text-brand-primary"/> : <Search size={14} className="opacity-20"/>}</div>
                    </div>
                    
                    {results.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest">{search ? "Search Results" : "Discovery"}</h3>
                            <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                                {results.map(r => (
                                    <div key={r.id} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                                        <span className="text-xs font-bold">{r.username}</span>
                                        <button onClick={async () => { await fetch('/api/social/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ receiverId: r.id }) }); alert("Sent"); fetchSearch(search); }} className="text-brand-primary hover:scale-110 transition-transform"><UserPlus size={16}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {pending.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-[10px] uppercase font-bold text-amber-500/50 tracking-widest">Requests</h3>
                            {pending.map(p => (
                                <div key={p.id} className="bg-amber-500/10 p-3 rounded-xl flex justify-between border border-amber-500/20 items-center">
                                    <span className="text-xs font-bold">{p.username}</span>
                                    <button onClick={async () => { await fetch('/api/social/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ senderId: p.id }) }); loadSocial(); }} className="text-green-500 bg-white/5 p-1 rounded-lg"><Check size={16}/></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto space-y-4 scrollbar-hide">
                        <h3 className="text-[10px] uppercase font-bold text-white/30 tracking-widest border-b border-white/5 pb-2">Friends</h3>
                        {friends.length > 0 ? friends.map(f => (
                            <div key={f.id} className="flex items-center justify-between group bg-white/[0.02] p-3 rounded-xl hover:bg-white/[0.04] transition-all relative">
                                <div className="flex items-center gap-3 cursor-pointer" onClick={() => openChat(f)}>
                                    <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 relative shrink-0">
                                        {f.profile_pic_path ? <img src={f.profile_pic_path} className="w-full h-full object-cover"/> : <Users size={12} className="m-auto mt-2 opacity-20"/>}
                                        {unreadSenders.includes(String(f.id)) && <div className="absolute inset-0 bg-red-500/40 animate-pulse"/>}
                                    </div>
                                    <span className={`text-xs font-bold truncate ${unreadSenders.includes(String(f.id)) ? 'text-red-400 animate-pulse' : 'text-white/80'}`}>{f.username}</span>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    {currentSession && <button title="Invite" onClick={() => socket?.emit('send-session-invite', { senderName: user.username, receiverId: f.id, code: currentSession })} className="p-1.5 bg-brand-primary/10 rounded-full text-brand-primary"><MailPlus size={14}/></button>}
                                    <button onClick={() => openChat(f)} className="p-1.5 bg-white/5 rounded-full relative"><MessageCircle size={14}/>{unreadSenders.includes(String(f.id)) && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-black" />}</button>
                                    <button title="Remove" onClick={async () => { if(confirm("Remove?")) { await fetch(`/api/social/friend/${f.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); loadSocial(); } }} className="opacity-0 group-hover:opacity-100 text-red-500/50 hover:text-red-500 transition-all"><UserMinus size={14}/></button>
                                </div>
                            </div>
                        )) : (
                            <p className="text-[10px] text-white/10 text-center py-10 uppercase font-bold tracking-widest">Lonely in here...</p>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex flex-col h-full gap-4">
                    <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                        <button onClick={() => setActiveChat(null)} className="text-white/40 hover:text-white transition-all p-2"><ArrowLeft/></button>
                        <span className="text-sm font-bold">{activeChat.username}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex flex-col ${String(m.sender_id) === String(user.userId) ? 'items-end' : 'items-start'}`}>
                                <div className={`p-3 rounded-2xl text-xs max-w-[85%] ${String(m.sender_id) === String(user.userId) ? 'bg-brand-primary text-black rounded-tr-none' : 'bg-white/5 text-white/80 rounded-tl-none'}`}>{m.message}</div>
                                <span className="text-[8px] text-white/20 mt-1 uppercase font-bold">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        ))}
                        <div ref={scrollRef} />
                    </div>
                    <div className="relative mt-auto">
                        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Transmit..." className="w-full bg-white/5 border border-white/10 p-4 rounded-xl outline-none focus:border-brand-primary font-bold text-sm" />
                        <button onClick={sendMessage} className="absolute right-4 top-4 text-brand-primary hover:scale-110 transition-all"><Send size={20}/></button>
                    </div>
                </div>
            )}
        </motion.div>
    );
}