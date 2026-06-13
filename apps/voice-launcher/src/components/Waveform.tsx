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
      renderWhiteWaveform(ctx, canvas, data, active);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  }, [active, analyser]);

  return <canvas ref={canvasRef} className="waveform" width={320} height={76} aria-hidden="true" />;
}

function renderWhiteWaveform(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  data: Uint8Array,
  active: boolean
) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barCount = 39;
  const gap = 4;
  const barWidth = 3;
  const totalWidth = (barCount * barWidth) + ((barCount - 1) * gap);
  const startX = (canvas.width - totalWidth) / 2;
  const now = Date.now();

  for (let i = 0; i < barCount; i += 1) {
    const sampleIndex = Math.floor((i / barCount) * data.length);
    const audioLevel = active ? data[sampleIndex] / 255 : 0;
    const idlePulse = 0.16 + (Math.sin(now / 180 + i * 0.72) * 0.08);
    const centerWeight = 1 - Math.abs(i - Math.floor(barCount / 2)) / Math.floor(barCount / 2);
    const level = active ? Math.max(audioLevel, idlePulse * 0.9) : idlePulse;
    const height = Math.max(8, Math.min(canvas.height - 8, (level * 52) + centerWeight * 12));
    const x = startX + i * (barWidth + gap);
    const y = (canvas.height - height) / 2;

    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = active ? 0.96 : 0.74;
    roundRect(ctx, x, y, barWidth, height, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
