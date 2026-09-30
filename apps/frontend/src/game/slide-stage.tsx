import type { SlideShowPayload } from '@quiz-dock/contracts';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { SlideView, TYPE_BASE } from './live-components';

const STAGE_W = 1280;
const STAGE_H = 720;

/**
 * A 16:9 box that lays its content out on a 1280×720 canvas, exactly as on the
 * big screen, then scales it to the box width — whatever is drawn keeps the
 * projection's proportions at any size.
 */
export function ScaledStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / STAGE_W);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('bg-background relative aspect-video w-full overflow-hidden', className)}
    >
      <div
        className={cn('absolute top-0 left-0 flex origin-top-left', TYPE_BASE.stage)}
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The stage as large as it fits in the space it is given, in both directions: a
 * phone in landscape is short, a phone in portrait is narrow. Fills its parent.
 */
export function FittedStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The height it is given, but never more than what the window shows below it.
    const measure = () => {
      const visible = window.innerHeight - el.getBoundingClientRect().top;
      const height = Math.max(0, Math.min(el.clientHeight, visible));
      setWidth(Math.min(el.clientWidth, (height * STAGE_W) / STAGE_H));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="flex min-h-0 w-full flex-1 items-center justify-center">
      <div style={{ width: width ?? '100%' }}>
        <ScaledStage className={className}>{children}</ScaledStage>
      </div>
    </div>
  );
}

/** A faithful miniature of the projected slide. */
export function SlideStage({ slide, className }: { slide: SlideShowPayload; className?: string }) {
  return (
    <ScaledStage className={className}>
      <SlideView slide={slide} />
    </ScaledStage>
  );
}
