import { WAVEFORM_SIZE_DEFAULT, type WaveformSize } from '@quiz-dock/contracts';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** The thickness the author picked, relative to the screen's type size. */
const HEIGHT: Record<WaveformSize, string> = { S: 'h-[1em]', M: 'h-[2.5em]', L: 'h-[5em]' };

/**
 * A sound drawn from its stored peaks, SoundCloud-style: one bar per value,
 * the part already played filled, the rest faint, a playhead where it is. Nothing is decoded — the
 * peaks were measured once in the editor.
 */
export function Waveform({
  peaks,
  progress,
  className,
  label,
  size = WAVEFORM_SIZE_DEFAULT,
}: {
  peaks: number[];
  /** 0–1: how much has played. */
  progress: number;
  className?: string;
  label?: string;
  size?: WaveformSize;
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
    // The playhead: where the sound is now, the same on every screen.
    if (progress > 0) {
      const x = Math.min(width - ratio, progress * width);
      ctx.fillRect(x - ratio, 0, 2 * ratio, height);
    }
  }, [peaks, progress, size]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={cn('text-primary block w-full', HEIGHT[size], className)}
    />
  );
}
