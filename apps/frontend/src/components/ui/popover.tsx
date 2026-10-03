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
  const focusTrigger = () =>
    root.current
      ?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
      ?.focus();

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      !!target &&
      (root.current?.contains(target as Node) || panel.current?.contains(target as Node));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    // Escape is the menu's first (capture): it closes the menu only, not the drawer or
    // the dialog under it, and gives the focus back to what opened it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      focusTrigger();
    };
    // The focus left the menu (Tab past its last item): it closes.
    const onFocusOut = (e: FocusEvent) => {
      if (!inside(e.relatedTarget)) setOpen(false);
    };
    // Fixed to the window: a scroll or a resize would leave it behind its trigger.
    const onMove = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    const box = panel.current;
    box?.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      box?.removeEventListener('focusout', onFocusOut);
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

  // Open: the focus goes into the menu, at the end of the page (a portal) where Tab
  // would never reach it in time.
  const placed = place !== null;
  useEffect(() => {
    if (!open || !placed) return;
    panel.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
  }, [open, placed]);

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
