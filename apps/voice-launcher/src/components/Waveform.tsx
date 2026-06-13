import { useEffect, useRef } from "react";

interface WaveformProps {
  analyser: AnalyserNode | null;
  active: boolean;
}

export function Waveform({ analyser, active }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = new Uint8Array(analyser?.frequencyBinCount ?? 64);
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (analyser) analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#07111f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const barCount = data.length;
      const width = canvas.width / barCount;
      for (let i = 0; i < barCount; i += 1) {
        const value = active ? data[i] / 255 : 0.16 + Math.sin((Date.now() / 240) + i) * 0.04;
        const height = Math.max(3, value * canvas.height * 0.82);
        const x = i * width;
        const y = (canvas.height - height) / 2;
        const gradient = ctx.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0, "#8b5cf6");
        gradient.addColorStop(0.45, "#2dd4bf");
        gradient.addColorStop(1, "#38bdf8");
        ctx.fillStyle = gradient;
        roundRect(ctx, x + 2, y, Math.max(2, width - 4), height, 4);
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [active, analyser]);

  return <canvas ref={canvasRef} className="waveform" width={420} height={70} aria-label="Microphone waveform" />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
