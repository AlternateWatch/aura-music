// Movido fuera de PersonalizationOverlay.tsx a su propio archivo pequeño.
// App.tsx necesita THEMES en el render principal (fuera de cualquier
// condición), pero PersonalizationOverlay.tsx en sí es un componente pesado
// que solo hace falta cuando el usuario abre esa pantalla. Si App.tsx
// importara THEMES directamente desde PersonalizationOverlay.tsx, el
// bundler no podría separar ese componente en su propio chunk (al haber
// un import estático del mismo módulo, se queda pegado al bundle
// principal). Con esto, THEMES pesa unos pocos bytes y se carga siempre,
// pero el resto del componente (JSX, lógica de subida de fondo, etc.) se
// carga solo bajo demanda.
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
