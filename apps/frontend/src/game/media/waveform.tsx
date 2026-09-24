import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * A sound drawn from its stored peaks, SoundCloud-style: one bar per value,
 * the part already played filled, the rest faint. Nothing is decoded — the
 * peaks were measured once in the editor.
 */
export function Waveform({
  peaks,
  progress,
  className,
  label,
}: {
  peaks: number[];
  /** 0–1: how much has played. */
  progress: number;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || peaks.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    // The theme's colours, read from the element (`text-primary` on the canvas).
    ctx.fillStyle = getComputedStyle(canvas).color;
    const step = width / peaks.length;
    const bar = Math.max(1, step * 0.6);
    const played = progress * peaks.length;
    peaks.forEach((peak, i) => {
      // A floor keeps silence visible as a line, not a gap.
      const h = Math.max(ratio * 2, peak * height);
      ctx.globalAlpha = i < played ? 1 : 0.3;
      ctx.fillRect(i * step + (step - bar) / 2, (height - h) / 2, bar, h);
    });
    ctx.globalAlpha = 1;
  }, [peaks, progress]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={cn('text-primary block h-[4em] w-full', className)}
    />
  );
}
