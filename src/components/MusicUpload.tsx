import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Upload, Music, Image as ImageIcon, 
  CheckCircle2, AlertCircle, Loader2 
} from 'lucide-react';

interface MusicUploadProps {
  onClose: () => void;
  onUploadComplete: () => void;
}

export const MusicUpload: React.FC<MusicUploadProps> = ({ onClose, onUploadComplete }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [trackNumber, setTrackNumber] = useState(0);
  const [tabsUrl, setTabsUrl] = useState(''); 
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (hasSelected) { setShowSuggestions(false); return; }
    const timer = setTimeout(async () => {
      if (title.length > 2) {
        try {
            const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=song&limit=5`);
            const data = await res.json();
            setSuggestions(data.results || []);
            setShowSuggestions(data.results?.length > 0);
        } catch(e) {}
      } else { setShowSuggestions(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [title, hasSelected]);

  const selectSuggestion = async (track: any) => {
    setHasSelected(true);
    setTitle(track.trackName);
    setArtist(track.artistName);
    setAlbum(track.collectionName || '');
    setTrackNumber(track.trackNumber || 0);
    setShowSuggestions(false);
    if (track.artworkUrl100) {
      const highRes = track.artworkUrl100.replace('100x100bb', '600x600bb');
      setCoverPreview(highRes);
      const response = await fetch(highRes);
      const blob = await response.blob();
      setCoverFile(new File([blob], "cover.jpg", { type: "image/jpeg" }));
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) { setError("Select a valid audio file (MP3 or FLAC)."); return; }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
formData.append('title', title);
formData.append('artist', artist);
formData.append('album', album);

// IMPORTANTE: los nombres deben coincidir con los del backend
formData.append('track_number', trackNumber.toString());
formData.append('tabs_url', tabsUrl);

formData.append('audio', audioFile);
if (coverFile) formData.append('cover', coverFile);

    try {
      const response = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('aura_token')}` },
        body: formData
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => { onUploadComplete(); onClose(); }, 2000);
      } else {
        const data = await response.json();
        setError(data.error || "Upload failed.");
      }
    } catch (err) { setError("Could not connect to server."); }
    setIsUploading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-[#121212] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 p-6">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-brand-primary" />
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/90">Contribute Track</h2>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white"><X size={20} /></button>
        </div>

        {success ? (
          <div className="py-20 text-center">
            <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Submitted to Moderation</p>
          </div>
        ) : (
          <form onSubmit={handleUpload} className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="space-y-4">
                <div className="relative" ref={dropdownRef}>
                  <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Track Title</label>
                  <input type="text" required value={title} onFocus={() => !hasSelected && title.length > 2 && setShowSuggestions(true)} onChange={e => { setTitle(e.target.value); setHasSelected(false); }} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium" />
                  {showSuggestions && (
                    <div className="absolute left-0 right-0 mt-2 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden z-[120] shadow-2xl">
                      {suggestions.map((s, i) => (
                        <div key={i} onClick={() => selectSuggestion(s)} className="flex items-center gap-3 p-3 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0">
                          <img src={s.artworkUrl60} className="w-8 h-8 rounded" alt="" />
                          <div className="truncate"><p className="text-xs font-bold text-white truncate">{s.trackName}</p><p className="text-[9px] text-white/40 uppercase font-bold tracking-wider">{s.artistName}</p></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Artist Name</label>
                  <input type="text" required value={artist} onChange={e => setArtist(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block">Album Name</label>
                  <input type="text" value={album} onChange={e => setAlbum(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-medium" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2 block text-brand-primary">Songsterr Link (Optional)</label>
                  <input type="url" placeholder="https://www.songsterr.com/..." value={tabsUrl} onChange={e => setTabsUrl(e.target.value)} className="w-full bg-white/5 border border-brand-primary/20 rounded-xl p-3 text-xs text-white outline-none font-medium" />
                </div>
              </div>

              <div className="flex flex-col gap-4 h-full">
                <div onClick={() => audioInputRef.current?.click()} className={`cursor-pointer flex flex-col items-center justify-center border-2 border-dashed rounded-2xl flex-1 min-h-[140px] transition-all ${audioFile ? 'border-brand-primary bg-brand-primary/5' : 'border-white/10 hover:border-white/20'}`}>
                  {/* UPDATED: Prompts for MP3 / FLAC and accepts multiple audio mimes */}
                  <input type="file" ref={audioInputRef} className="hidden" accept="audio/mpeg,audio/flac,audio/x-flac" onChange={e => setAudioFile(e.target.files?.[0] || null)} />
                  <Music className={`mb-2 ${audioFile ? 'text-brand-primary' : 'text-white/20'}`} size={24} />
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-center px-2 truncate w-full">{audioFile ? audioFile.name : 'Select MP3 / FLAC'}</p>
                </div>
                <div onClick={() => coverInputRef.current?.click()} className="relative cursor-pointer overflow-hidden flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl h-[100px] hover:border-white/20">
                  <input type="file" ref={coverInputRef} className="hidden" accept="image/*" onChange={e => { if(e.target.files?.[0]){ setCoverFile(e.target.files[0]); setCoverPreview(URL.createObjectURL(e.target.files[0])); } }} />
                  {coverPreview ? <img src={coverPreview} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" /> : <ImageIcon className="text-white/20" size={24} />}
                  <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] z-10">{coverFile || coverPreview ? 'Change Cover' : 'Select Cover'}</p>
                </div>
              </div>
            </div>
            {error && <div className="text-red-500 text-[10px] font-bold uppercase p-3 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle size={14} className="inline mr-2" /> {error}</div>}
            <button type="submit" disabled={isUploading || !audioFile} className="w-full bg-white text-black py-4 rounded-2xl font-bold uppercase text-[10px] tracking-[0.3em] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isUploading ? <Loader2 className="animate-spin" size={16} /> : 'Submit for Approval'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
};