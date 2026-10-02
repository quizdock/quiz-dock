import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** Room kept between the panel and the window's edges. */
const MARGIN = 8;

/**
 * A panel that opens under its trigger (above it when there is no room below)
 * and closes on a click outside, Escape, a scroll or a resize. The trigger is
 * rendered by the caller (any button), given `open` and `toggle`; the content
 * may take `close` (a list whose items lead somewhere).
 *
 * The panel lives in a portal, fixed to the window: a container that scrolls
 * or clips (a table's horizontal scroll) never cuts it.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      !!target &&
      (root.current?.contains(target as Node) || panel.current?.contains(target as Node));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Fixed to the window: a scroll or a resize would leave it behind its trigger.
    const onMove = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Under the trigger, or above it when the window has no room below.
  useLayoutEffect(() => {
    if (!open || !root.current) {
      setPlace(null);
      return;
    }
    const at = root.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    const below = at.bottom + 4;
    const top =
      below + height > window.innerHeight - MARGIN && at.top - 4 - height > MARGIN
        ? at.top - 4 - height
        : below;
    setPlace(
      align === 'end'
        ? { top, right: Math.max(MARGIN, window.innerWidth - at.right) }
        : { top, left: Math.max(MARGIN, at.left) },
    );
  }, [open, align]);

  return (
    <div ref={root} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panel}
              style={place ?? { visibility: 'hidden', top: 0, left: 0 }}
              className={cn(
                'bg-background fixed z-50 max-w-[calc(100vw-1rem)] rounded-lg border p-3 shadow-lg',
                className,
              )}
            >
              {typeof children === 'function' ? children(() => setOpen(false)) : children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
