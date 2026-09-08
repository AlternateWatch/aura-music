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

    const render = () => {
      // 1. Sync internal resolution with display size
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      if (!analyser || !active) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 2. Original Style Logic
      const barCount = 42; 
      const gutter = 3; 
      
      // Calculate bar width to cover EXACTLY the horizontal space
      const barWidth = (canvas.width - (gutter * (barCount - 1))) / barCount;
      
      for (let i = 0; i < barCount; i++) {
        // SAMPLING FIX: 
        // We only sample the first 60% of the buffer (where the music actually happens)
        // This prevents the right side from looking "dead" or empty.
        const sampleIndex = Math.floor((i / barCount) * (bufferLength * 0.6));
        const value = dataArray[sampleIndex];
        
        // Scale the height and ensure a tiny base line is always there
        const barHeight = Math.max(3, (value / 255) * canvas.height);
        
        const x = i * (barWidth + gutter);
        const y = canvas.height - barHeight;

        ctx.fillStyle = color;

        if (ctx.roundRect) {
          ctx.beginPath();
          // Draw vertical bars with rounded tops
          ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barWidth, barHeight);
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
      className="w-full h-full block"
      style={{ 
        filter: `drop-shadow(0 0 12px ${color}55)`
      }}
    />
  );
};