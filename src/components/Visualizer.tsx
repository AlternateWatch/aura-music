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

      // 2. Ultra-Premium Visuals
      const barCount = 80;
      const gutter = 1;
      const barWidth = (canvas.width - (gutter * (barCount - 1))) / barCount;
      const centerY = canvas.height / 2;

      for (let i = 0; i < barCount; i++) {
        // Sample with a curve to emphasize bass and mid-range
        const sampleIndex = Math.floor(Math.pow(i / barCount, 1.5) * (analyser.frequencyBinCount * 0.4));
        const value = dataArray[sampleIndex];

        // Smooth the height transition
        const barHeight = Math.max(2, (value / 255) * (canvas.height * 0.8));

        const x = i * (barWidth + gutter);

        // Neon-like glow effect using gradients
        const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.5, color);
        gradient.addColorStop(1, color);

        ctx.fillStyle = gradient;

        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, 1);
          ctx.fill();
        } else {
          ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
        }

        // Reset shadow for next bar to prevent bleeding
        ctx.shadowBlur = 0;
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
        pointerEvents: 'none'
      }}
    />
  );
};