import React from 'react';

interface BackgroundProps {
  color?: string;
  dynamicColor?: string;
}

export const Background: React.FC<BackgroundProps> = ({ color = '#050505' }) => {
  return (
    <div
      className="absolute inset-0 -z-10 transition-colors duration-1000"
      style={{ backgroundColor: color }}
    >
      {/* Textura de grano/ruido sutil */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      {/* Overlay oscuro para legibilidad */}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
};