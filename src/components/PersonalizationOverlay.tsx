import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Palette, Check, Image as ImageIcon, Loader2, Sparkles, 
  Smartphone, Eye, Sliders, SlidersHorizontal, Activity,
  Heart, Play, SkipBack, SkipForward, Vibrate, Sun, Moon,
  Trash2, Link as LinkIcon, Shuffle, Repeat
} from 'lucide-react';
import { 
  THEMES, 
  MOBILE_PLAYER_OPTIONS, 
  ACCENT_COLORS,
  type Theme, 
  type MobilePlayerStyle 
} from '../constants/themes';
import { API_BASE } from '../utils/api';
import { hapticImpact } from '../utils/haptics';

export { THEMES, type Theme };

interface PersonalizationOverlayProps {
  onClose: () => void;
  activeTheme: string;
  onThemeSelect: (id: string) => void;
  token: string | null;
  customBg: string | null;
  onBackgroundUpload: (url: string) => void;
  onRemoveBackground?: () => void;

  // IA
  isAiEnabled: boolean;
  onToggleAi: (enabled: boolean) => void;

  // Visualizer
  isVisualizerEnabled: boolean;
  onToggleVisualizer: (enabled: boolean) => void;

  // Mobile Player Bar
  mobilePlayerStyle: MobilePlayerStyle;
  onSelectMobilePlayerStyle: (style: MobilePlayerStyle) => void;

  // Opacidad de fondo
  bgOpacity: number;
  onChangeBgOpacity: (opacity: number) => void;

  // Ambient glow
  ambientGlow: 'off' | 'soft' | 'vibrant';
  onChangeAmbientGlow: (glow: 'off' | 'soft' | 'vibrant') => void;

  // Accent color
  accentColor: string;
  onChangeAccentColor: (hex: string) => void;

  // Hápticos
  hapticsEnabled: boolean;
  onToggleHaptics: (enabled: boolean) => void;
}

export const PersonalizationOverlay: React.FC<PersonalizationOverlayProps> = ({ 
  onClose, 
  activeTheme, 
  onThemeSelect, 
  token,
  customBg,
  onBackgroundUpload,
  onRemoveBackground,
  isAiEnabled,
  onToggleAi,
  isVisualizerEnabled,
  onToggleVisualizer,
  mobilePlayerStyle,
  onSelectMobilePlayerStyle,
  bgOpacity,
  onChangeBgOpacity,
  ambientGlow,
  onChangeAmbientGlow,
  accentColor,
  onChangeAccentColor,
  hapticsEnabled,
  onToggleHaptics,
}) => {
  const [activeTab, setActiveTab] = useState<'themes' | 'mobile' | 'visuals' | 'system'>('themes');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('custom_bg', file);
    try {
      const res = await fetch(`${API_BASE}/api/users/custom-bg`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.custom_bg_path) {
        onBackgroundUpload(data.custom_bg_path);
        onThemeSelect('custom');
        hapticImpact('medium');
      }
    } catch (e) { 
      console.error("BG Upload error", e); 
    }
    setIsUploading(false);
  };

  const handleApplyCustomUrl = () => {
    if (!customUrlInput.trim()) return;
    onBackgroundUpload(customUrlInput.trim());
    onThemeSelect('custom');
    setCustomUrlInput('');
    setShowUrlInput(false);
    hapticImpact('medium');
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-2xl px-3 sm:px-6 py-6 font-sans select-none overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: "spring", damping: 26, stiffness: 220 }}
        className="bg-[#121214] border border-white/10 rounded-[32px] sm:rounded-[40px] p-5 sm:p-8 w-full max-w-3xl shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden my-auto"
      >
        {/* BOTÓN CERRAR */}
        <button 
          onClick={() => { hapticImpact('light'); onClose(); }} 
          className="absolute top-6 right-6 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none z-20"
          title="Cerrar"
        >
          <X size={22} />
        </button>

        {/* CABECERA */}
        <div className="flex items-center gap-4 mb-6 shrink-0 pr-12">
          <div className="p-3 bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-brand-primary/30 rounded-2xl text-brand-primary shrink-0">
            <Palette size={26} />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-tight text-white font-serif italic">
              Personalización
            </h2>
            <p className="text-[11px] font-semibold text-white/40 tracking-wider">
              Ajusta el diseño, la barra móvil, temas y funciones visuales
            </p>
          </div>
        </div>

        {/* NAVEGACIÓN POR PESTAÑAS */}
        <div className="flex items-center gap-1.5 p-1 bg-white/[0.03] border border-white/5 rounded-2xl mb-6 overflow-x-auto no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => { hapticImpact('light'); setActiveTab('themes'); }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'themes'
                ? 'bg-white text-black shadow-md'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sun size={14} />
            <span>Fondo y Temas</span>
          </button>

          <button
            type="button"
            onClick={() => { hapticImpact('light'); setActiveTab('mobile'); }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'mobile'
                ? 'bg-white text-black shadow-md'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Smartphone size={14} />
            <span>Player Móvil</span>
          </button>

          <button
            type="button"
            onClick={() => { hapticImpact('light'); setActiveTab('visuals'); }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'visuals'
                ? 'bg-white text-black shadow-md'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Activity size={14} />
            <span>Visuales & Glow</span>
          </button>

          <button
            type="button"
            onClick={() => { hapticImpact('light'); setActiveTab('system'); }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'system'
                ? 'bg-white text-black shadow-md'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles size={14} />
            <span>IA & Hápticos</span>
          </button>
        </div>

        {/* CONTENIDO SCROLLEABLE */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-6">

          {/* ========================================================================= */}
          {/* TAB 1: FONDO Y TEMAS                                                      */}
          {/* ========================================================================= */}
          {activeTab === 'themes' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* SELECTOR DE TEMAS */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
                    Temas de Color
                  </h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white transition-all cursor-pointer"
                    >
                      {isUploading ? <Loader2 className="animate-spin text-brand-primary" size={13} /> : <ImageIcon size={13} />}
                      <span>Subir fondo</span>
                    </button>
                    <button 
                      onClick={() => setShowUrlInput(!showUrlInput)}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white transition-all cursor-pointer"
                    >
                      <LinkIcon size={13} />
                      <span>URL</span>
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleUpload} />
                  </div>
                </div>

                {/* Input de URL directa de fondo */}
                {showUrlInput && (
                  <div className="flex items-center gap-2 p-2 mb-3 bg-white/5 border border-white/10 rounded-2xl animate-in fade-in duration-150">
                    <input 
                      type="url"
                      placeholder="https://ejemplo.com/fondo.jpg"
                      value={customUrlInput}
                      onChange={(e) => setCustomUrlInput(e.target.value)}
                      className="flex-1 bg-transparent px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomUrl}
                      className="px-3.5 py-1.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-white/90 cursor-pointer"
                    >
                      Aplicar
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {THEMES.map((theme) => {
                    const isSelected = activeTheme === theme.id;
                    return (
                      <div 
                        key={theme.id} 
                        onClick={() => { hapticImpact('light'); onThemeSelect(theme.id); }} 
                        className={`group cursor-pointer relative rounded-2xl p-3 border-2 transition-all duration-300 ${
                          isSelected 
                            ? 'border-brand-primary bg-white/5 shadow-[0_4px_20px_rgba(242,125,38,0.2)]' 
                            : 'border-white/5 bg-white/[0.02] hover:border-white/20'
                        }`}
                      >
                        <div className={`w-full aspect-video rounded-xl mb-2.5 shadow-inner overflow-hidden relative ${theme.preview}`}>
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Check className="text-white drop-shadow" size={20} />
                            </div>
                          )}
                        </div>
                        <p className={`text-[11px] font-bold uppercase tracking-wider text-center truncate ${isSelected ? 'text-brand-primary' : 'text-white/60'}`}>
                          {theme.name}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* OPACIDAD / OSCURECIMIENTO DE FONDO (SI HAY WALLPAPER) */}
              {(activeTheme === 'custom' || customBg) && (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-white">Opacidad del Fondo Personalizado</span>
                    <span className="text-brand-primary font-mono">{bgOpacity}%</span>
                  </div>
                  <p className="text-[11px] text-white/40">
                    Controla el contraste para que las canciones y textos sigan siendo fáciles de leer.
                  </p>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="5"
                    value={bgOpacity}
                    onChange={(e) => onChangeBgOpacity(parseInt(e.target.value, 10))}
                    className="w-full accent-brand-primary cursor-pointer"
                  />
                  {onRemoveBackground && (
                    <button
                      type="button"
                      onClick={() => { hapticImpact('medium'); onRemoveBackground(); }}
                      className="mt-2 text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1.5 font-bold cursor-pointer"
                    >
                      <Trash2 size={12} />
                      <span>Quitar imagen de fondo</span>
                    </button>
                  )}
                </div>
              )}

              {/* COLOR DE ACENTO */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">
                  Color de Acento de la App
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  {ACCENT_COLORS.map((accent) => {
                    const isSelected = accentColor.toLowerCase() === accent.hex.toLowerCase();
                    return (
                      <button
                        key={accent.id}
                        type="button"
                        onClick={() => { hapticImpact('light'); onChangeAccentColor(accent.hex); }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-white/40 bg-white/10 shadow-lg scale-105'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/5 text-white/60'
                        }`}
                        title={accent.name}
                      >
                        <div 
                          className="w-4 h-4 rounded-full shadow-sm ring-1 ring-white/20" 
                          style={{ backgroundColor: accent.hex }} 
                        />
                        <span className="text-xs font-semibold text-white">{accent.name}</span>
                        {isSelected && <Check size={14} className="text-white ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: PLAYER MÓVIL                                                       */}
          {/* ========================================================================= */}
          {activeTab === 'mobile' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-1">
                  Estilo del Reproductor Pequeño en Móvil
                </h3>
                <p className="text-[11px] text-white/40">
                  Elige la apariencia que mejor se adapte a tu forma de escuchar música en el teléfono.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {MOBILE_PLAYER_OPTIONS.map((opt) => {
                  const isSelected = mobilePlayerStyle === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => { hapticImpact('medium'); onSelectMobilePlayerStyle(opt.id); }}
                      className={`relative p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-brand-primary bg-white/5 shadow-[0_6px_24px_rgba(242,125,38,0.2)]'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{opt.name}</h4>
                          {opt.badge && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-brand-primary/20 text-brand-primary border border-brand-primary/30">
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected ? 'bg-brand-primary border-brand-primary text-black' : 'border-white/20 text-transparent'
                        }`}>
                          <Check size={12} strokeWidth={3} />
                        </div>
                      </div>

                      <p className="text-xs text-white/50 leading-relaxed mb-4">
                        {opt.description}
                      </p>

                      {/* VISTA PREVIA ESQUEMÁTICA EN MINIATURA */}
                      <div className="w-full p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between pointer-events-none">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-7 h-7 bg-white/10 shrink-0 ${opt.id === 'minimal' ? 'rounded-full' : 'rounded-lg'}`} />
                          <div className="space-y-1 min-w-0">
                            <div className="w-16 h-1.5 bg-white/60 rounded" />
                            <div className="w-10 h-1 bg-white/30 rounded" />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {opt.id === 'card' && <Heart size={10} className="text-white/40" />}
                          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                            <Play size={8} fill="white" className="ml-0.5 text-white" />
                          </div>
                          <SkipForward size={10} className="text-white/40" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: VISUALES & GLOW                                                    */}
          {/* ========================================================================= */}
          {activeTab === 'visuals' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* TOGGLE DEL VISUALIZADOR */}
              <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                <div className="flex items-center gap-3.5 pr-4">
                  <div className="p-2.5 bg-brand-primary/10 rounded-xl text-brand-primary shrink-0">
                    <Activity size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white leading-tight">Visualizador Reactivo de Audio</h4>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Muestra ondas y frecuencias dinámicas en tiempo real en la pantalla y en las sesiones colaborativas.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { hapticImpact('light'); onToggleVisualizer(!isVisualizerEnabled); }}
                  className={`w-12 h-7 rounded-full transition-colors relative cursor-pointer outline-none shrink-0 ${
                    isVisualizerEnabled ? 'bg-brand-primary' : 'bg-white/10'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${
                    isVisualizerEnabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {/* RESPLANDOR AMBIENTAL EN FULL PLAYER */}
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                <div>
                  <h4 className="text-sm font-bold text-white leading-tight">Resplandor Ambiental (Full Player)</h4>
                  <p className="text-xs text-white/40 mt-1">
                    Efecto de halo luminoso que proyecta la carátula en el reproductor a pantalla completa.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  {[
                    { id: 'off', label: 'Apagado', desc: 'Negro OLED puro' },
                    { id: 'soft', label: 'Suave', desc: 'Aura tenue elegante' },
                    { id: 'vibrant', label: 'Intenso', desc: 'Inmersión máxima' },
                  ].map((glowOpt) => {
                    const isSelected = ambientGlow === glowOpt.id;
                    return (
                      <button
                        key={glowOpt.id}
                        type="button"
                        onClick={() => { hapticImpact('light'); onChangeAmbientGlow(glowOpt.id as any); }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-brand-primary bg-white/10 text-white shadow-md'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/5 text-white/60'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-white">{glowOpt.label}</span>
                          {isSelected && <Check size={14} className="text-brand-primary" />}
                        </div>
                        <p className="text-[10px] text-white/40">{glowOpt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: IA & HÁPTICOS                                                      */}
          {/* ========================================================================= */}
          {activeTab === 'system' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* TOGGLE FUNCIONES DE IA */}
              <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                <div className="flex items-center gap-3.5 pr-4">
                  <div className="p-2.5 bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-brand-primary/30 rounded-xl text-brand-primary shrink-0">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white leading-tight">Funciones de Inteligencia Artificial</h4>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-brand-primary/20 text-brand-primary border border-brand-primary/30 font-bold">
                        Aura DJ
                      </span>
                    </div>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Muestra los accesos a Aura DJ y recomendaciones impulsadas por Gemini. Si lo desactivas, la aplicación funcionará de manera 100% tradicional y libre de IA.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { hapticImpact('light'); onToggleAi(!isAiEnabled); }}
                  className={`w-12 h-7 rounded-full transition-colors relative cursor-pointer outline-none shrink-0 ${
                    isAiEnabled ? 'bg-brand-primary' : 'bg-white/10'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${
                    isAiEnabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {/* TOGGLE VIBRACIÓN HÁPTICA */}
              <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                <div className="flex items-center gap-3.5 pr-4">
                  <div className="p-2.5 bg-white/5 rounded-xl text-white/70 shrink-0">
                    <Vibrate size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white leading-tight">Vibración Háptica (Móvil)</h4>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Micro-vibración al pulsar botones principales, cambiar canción, dar me gusta o deslizar la barra de tiempo.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { hapticImpact('light'); onToggleHaptics(!hapticsEnabled); }}
                  className={`w-12 h-7 rounded-full transition-colors relative cursor-pointer outline-none shrink-0 ${
                    hapticsEnabled ? 'bg-brand-primary' : 'bg-white/10'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${
                    hapticsEnabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

            </div>
          )}

        </div>

        {/* PIE DE PÁGINA */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-white/30 font-mono">
            AURA · Configuración guardada localmente
          </p>
          <button
            type="button"
            onClick={() => { hapticImpact('light'); onClose(); }}
            className="px-5 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 active:scale-95 transition-all cursor-pointer shadow-lg"
          >
            Aceptar
          </button>
        </div>

      </motion.div>
    </div>
  );
};
