import { m, stagger, useAnimate, useReducedMotion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { gradientCss } from '../surface';
import { type Backdrop, sameBackdrop } from './step';
import { EASE_OUT, MOTION } from './tokens';

/**
 * Over a live screen, when the step changes: the previous background, alone,
 * fading out over the new step. Whatever the two are (gradient, picture, a
 * video's veil, the page), nothing is played twice: the old step is gone, only
 * its colours linger for half a second. Put it last in the screen's positioned root.
 */
export function BackdropFade({ stepKey, backdrop }: { stepKey: string; backdrop: Backdrop }) {
  const last = useRef({ stepKey, backdrop });
  const [ghost, setGhost] = useState<{ id: string; backdrop: Backdrop } | null>(null);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { stepKey, backdrop };
    if (before.stepKey !== stepKey && !sameBackdrop(before.backdrop, backdrop)) {
      setGhost({ id: `${before.stepKey}>${stepKey}`, backdrop: before.backdrop });
    }
  }, [stepKey, backdrop]);
  if (!ghost) return null;
  const b = ghost.backdrop;
  const veil = b && b.textTone === 'dark' ? 'bg-white/55' : 'bg-black/40';
  return (
    <m.div
      key={ghost.id}
      aria-hidden
      data-motion="backdrop-fade"
      className={cn('pointer-events-none absolute inset-0 z-50', !b && 'bg-background')}
      style={
        b && 'background' in b
          ? 'gradient' in b.background
            ? { backgroundImage: gradientCss(b.background.gradient) }
            : {
                backgroundImage: `url("${b.background.url}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
          : undefined
      }
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: MOTION.fade, ease: 'easeInOut' }}
      onAnimationComplete={() => setGhost(null)}
    >
      {b ? <div className={cn('absolute inset-0', veil)} /> : null}
    </m.div>
  );
}

/**
 * A step's content: when the step changes, its top-level elements come in one
 * after the other. Nothing to declare in the components — a wrapper with a
 * single child is looked through, down to where the step's parts are side by side.
 */
export function StepEnter({
  stepKey,
  className,
  children,
}: {
  stepKey: string;
  className?: string;
  children: ReactNode;
}) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduced = useReducedMotion();
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const first = shown.current === null;
    shown.current = stepKey;
    // The screen opening on a step shows it as it is; only a change moves.
    if (first || !scope.current) return;
    const parts = partsOf(scope.current);
    if (parts.length === 0) return;
    void animate(parts, reduced ? { opacity: [0, 1] } : { opacity: [0, 1], y: [16, 0] }, {
      duration: MOTION.enter,
      delay: stagger(MOTION.stagger, { startDelay: MOTION.enterDelay }),
      ease: EASE_OUT,
    });
  }, [stepKey, animate, reduced, scope]);
  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

/**
 * The step's parts: the children of the first element that has more than one. An
 * element that moves its own children (`data-motion="own"`: the standings, a
 * reveal, the podium) is one part, never looked into.
 */
function partsOf(root: Element): Element[] {
  let node = root;
  for (let depth = 0; depth < 4 && node.children.length === 1; depth++) {
    const only = node.children[0];
    if (only instanceof HTMLElement && only.dataset.motion === 'own') break;
    node = only;
  }
  return Array.from(node.children);
}
