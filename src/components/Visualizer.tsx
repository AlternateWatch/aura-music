import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  active: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, active, color = '#6366f1' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reutilizamos el mismo buffer entre frames en vez de reservar uno nuevo
    // cada vez (evita presión de GC durante la reproducción).
    let dataArray = new Uint8Array(0);

    if (!analyser || !active) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const render = () => {
      if (!analyser) return;
      // 1. Sync internal resolution with display size
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      if (dataArray.length !== analyser.frequencyBinCount) {
        dataArray = new Uint8Array(analyser.frequencyBinCount);
      }

      try {
        analyser.getByteFrequencyData(dataArray);
      } catch (e) {
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 2. Enhanced Visuals
      const barCount = 60;
      const gutter = 2;
      const barWidth = (canvas.width - (gutter * (barCount - 1))) / barCount;

      // Mirror effect setup
      const centerY = canvas.height / 2;

      for (let i = 0; i < barCount; i++) {
        // Sample from the first 50% of the spectrum for a more active feel
        const sampleIndex = Math.floor((i / barCount) * (analyser.frequencyBinCount * 0.5));
        const value = dataArray[sampleIndex];

        // Dynamic height based on value, but capped to not overflow the container
        const barHeight = Math.max(2, (value / 255) * (canvas.height * 0.8));

        const x = i * (barWidth + gutter);

        // Create a gradient for each bar
        const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, color);

        ctx.fillStyle = gradient;

        if (ctx.roundRect) {
          ctx.beginPath();
          // Draw bars growing from the center outwards (Symmetric)
          ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, active, color]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block"
      style={{
        filter: `drop-shadow(0 0 12px ${color}55)`,
        pointerEvents: 'none'
      }}
    />
  );
};