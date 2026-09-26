import React from 'react';

interface BackgroundProps {
  color?: string;
  dynamicColor?: string;
}

export const Background: React.FC<BackgroundProps> = ({ color = '#050505', dynamicColor }) => {
  return (
    <div 
      className="absolute inset-0 -z-10 transition-colors duration-1000" 
      style={{ backgroundColor: color }}
    >
      {/* Capa de Aura Dinámica */}
      <div 
        className="absolute inset-0 opacity-40 transition-all duration-1000"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${dynamicColor || '#6366f1'} 0%, transparent 60%),
                       radial-gradient(circle at 0% 100%, ${dynamicColor || '#6366f1'} 0%, transparent 40%),
                       radial-gradient(circle at 100% 100%, ${dynamicColor || '#6366f1'} 0%, transparent 40%)`
        }}
      />
      
      {/* Textura de grano/ruido sutil */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      
      {/* Overlay oscuro para legibilidad */}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
};