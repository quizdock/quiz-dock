import type { SlideBackground, SlideGradient, SlideTextTone } from '@quiz-dock/contracts';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** CSS for a generated gradient background. */
export function gradientCss(g: SlideGradient): string {
  return `linear-gradient(${g.angle}deg, ${g.colors.join(', ')})`;
}

/*
 * The author picks any background, so what sits on it follows two layers: text
 * laid on the background keeps the halo; every UI element (tile, list, field,
 * button, avatar) is opaque, has no halo and a two-tone edge — a light and a
 * dark hairline, one of the two always stands out. The classes below only take
 * effect inside a surface that has a background (`on-backdrop:`, index.css).
 */

/** Two-tone edge of a UI element laid on a background. */
export const BACKDROP_EDGE =
  'on-backdrop:ring-1 on-backdrop:ring-black/70 on-backdrop:ring-offset-1 on-backdrop:ring-offset-white/70';

/** The support UI sits on over a background: the local palette's panel, edged, no halo. */
export const BACKDROP_PANEL = `[text-shadow:none] on-backdrop:rounded-[0.75em] on-backdrop:bg-card on-backdrop:p-[0.75em] on-backdrop:text-card-foreground on-backdrop:shadow-lg on-backdrop:backdrop-blur-md ${BACKDROP_EDGE}`;

/** A picked answer, readable on any background: a white ring, then a black one. */
export const PICKED_RING = 'ring-2 ring-black ring-offset-3 ring-offset-white';

/**
 * Full-cover background for a slide or a question: an uploaded image (darkened
 * or lightened to match the text tone) or a generated gradient. The text tone
 * sets the local palette of the subtree (`data-scheme`, index.css): light text
 * means a dark palette, and the other way round. Without a background the
 * surface is transparent and everything keeps the page colours.
 */
export function Surface({
  background,
  textTone,
  // The subtitle-like halo is the design default: only an explicit `false` removes it.
  textOutline = true,
  className,
  backdrop,
  overlay,
  children,
}: {
  background: SlideBackground | null | undefined;
  textTone?: SlideTextTone;
  textOutline?: boolean;
  className?: string;
  /** A layer drawn behind the content in place of an image — a slide's video (#125). */
  backdrop?: ReactNode;
  /** Drawn over everything, content included: the motion layer's fading background. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const light = textTone !== 'dark';
  const has = Boolean(background) || Boolean(backdrop);
  return (
    <div
      data-scheme={has ? (light ? 'dark' : 'light') : undefined}
      className={cn(
        // `clip`, not `hidden`: no scroll container, so a sticky bar inside still sticks.
        'relative flex flex-col overflow-clip',
        has && 'text-foreground',
        has && textOutline && '[text-shadow:var(--qd-halo)]',
        className,
      )}
      style={
        background && 'gradient' in background
          ? { backgroundImage: gradientCss(background.gradient) }
          : undefined
      }
    >
      {background && 'url' in background ? (
        <>
          <img
            src={background.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className={cn('absolute inset-0', light ? 'bg-black/40' : 'bg-white/55')} />
        </>
      ) : backdrop ? (
        <>
          {backdrop}
          <div className={cn('absolute inset-0', light ? 'bg-black/40' : 'bg-white/55')} />
        </>
      ) : null}
      <div className="relative z-10 flex w-full flex-1 flex-col">{children}</div>
      {overlay}
    </div>
  );
}
