// Constantes y definiciones del motor de personalización de AURA
export interface Theme {
  id: string;
  name: string;
  preview: string;
  color: string;
  className: string;
}

export const THEMES: Theme[] = [
  { id: 'dark', name: 'Void Black', preview: 'bg-black', color: '#F27D26', className: 'bg-[#050505] text-white' },
  { id: 'midnight', name: 'Midnight', preview: 'bg-gradient-to-br from-slate-900 via-blue-950 to-black', color: '#38bdf8', className: 'bg-[#040814] text-white' },
  { id: 'nebula', name: 'Nebula', preview: 'bg-gradient-to-br from-indigo-950 via-purple-950 to-black', color: '#c084fc', className: 'bg-[#0a001a] text-white' },
  { id: 'sunset', name: 'Sunset Aura', preview: 'bg-gradient-to-br from-amber-700 via-orange-900 to-black', color: '#F27D26', className: 'bg-[#140601] text-white' },
  { id: 'emerald', name: 'Emerald', preview: 'bg-gradient-to-br from-emerald-950 via-teal-950 to-black', color: '#10b981', className: 'bg-[#00140a] text-white' },
  { id: 'amethyst', name: 'Amethyst', preview: 'bg-gradient-to-br from-fuchsia-950 via-pink-950 to-black', color: '#f43f5e', className: 'bg-[#150210] text-white' },
  { id: 'light', name: 'Pure White', preview: 'bg-gray-100', color: '#000000', className: 'bg-white text-black' },
  { id: 'custom', name: 'Custom Wallpaper', preview: 'bg-zinc-800', color: '#F27D26', className: 'bg-black text-white' },
];

export type MobilePlayerStyle = 'floating' | 'classic' | 'minimal' | 'card';
export type MobileColumns = 1 | 2 | 3;

export interface MobilePlayerOption {
  id: MobilePlayerStyle;
  name: string;
  badge?: string;
  description: string;
  iconName: string;
}

export const MOBILE_PLAYER_OPTIONS: MobilePlayerOption[] = [
  {
    id: 'floating',
    name: 'Isla Flotante',
    badge: 'Recomendado',
    description: 'Píldora flotante con micro-barra de progreso capilar, controles táctiles circulares y gestos swipe.',
    iconName: 'Sparkles',
  },
  {
    id: 'classic',
    name: 'Dock Clásico',
    badge: 'Original',
    description: 'Barra fija ancha acoplada al fondo con barra de tiempo completa (seek interactivo), minutos y botones clásicos.',
    iconName: 'Sliders',
  },
  {
    id: 'minimal',
    name: 'Minimal Glass',
    badge: 'Nuevo',
    description: 'Diseño ultra-compacto y ligero con carátula circular, tipografía en una sola línea y controles esenciales.',
    iconName: 'Minimize2',
  },
  {
    id: 'card',
    name: 'Tarjeta Moderna',
    badge: 'Nuevo',
    description: 'Tarjeta flotante expandida con carátula destacada, botón rápido de Favoritos y botones de reproducción.',
    iconName: 'CreditCard',
  },
];

export interface AccentColorOption {
  id: string;
  name: string;
  hex: string;
}

export const ACCENT_COLORS: AccentColorOption[] = [
  { id: 'aura', name: 'Aura Naranja', hex: '#F27D26' },
  { id: 'indigo', name: 'Azul Índigo', hex: '#6366f1' },
  { id: 'amber', name: 'Ámbar Solar', hex: '#f59e0b' },
  { id: 'emerald', name: 'Esmeralda', hex: '#10b981' },
  { id: 'cyan', name: 'Cian Neón', hex: '#06b6d4' },
  { id: 'purple', name: 'Púrpura', hex: '#a855f7' },
  { id: 'rose', name: 'Rosa Fucsia', hex: '#ec4899' },
  { id: 'white', name: 'Blanco Puro', hex: '#ffffff' },
];

export interface GlowColorOption {
  id: string;
  name: string;
  hex: string;
}

export const FULLPLAYER_GLOW_COLORS: GlowColorOption[] = [
  { id: 'indigo', name: 'Azul Índigo (Original)', hex: '#6366f1' },
  { id: 'aura', name: 'Naranja Aura', hex: '#F27D26' },
  { id: 'purple', name: 'Violeta Neón', hex: '#a855f7' },
  { id: 'cyan', name: 'Cian Cósmico', hex: '#06b6d4' },
  { id: 'emerald', name: 'Esmeralda', hex: '#10b981' },
  { id: 'rose', name: 'Rosa Neón', hex: '#ec4899' },
  { id: 'amber', name: 'Ámbar Cálido', hex: '#f59e0b' },
];
