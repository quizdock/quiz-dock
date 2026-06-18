import { type ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Infobulle légère (sans dépendance Radix), pensée pour de courts libellés d'action.
 * Comportement soigné :
 * - apparition au survol après un court délai (anti-clignotement) ;
 * - apparition au focus **clavier uniquement** (`:focus-visible`), pas au clic ;
 * - disparition au `pointerdown` → ne reste pas « collée » après un clic ;
 * - fondu d'opacité, et masquée de l'arbre d'accessibilité quand fermée.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    timer.current = setTimeout(() => setOpen(true), 300);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onFocusCapture={(e) => {
        // Au focus clavier seulement (un clic ne déclenche pas :focus-visible).
        if ((e.target as HTMLElement).matches?.(':focus-visible')) setOpen(true);
      }}
      onBlurCapture={hide}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!open}
        className={cn(
          'bg-foreground text-background pointer-events-none absolute left-1/2 z-50 w-max max-w-[15rem] -translate-x-1/2 rounded-md px-2 py-1 text-center text-xs font-medium shadow-md transition-opacity duration-150',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          open ? 'opacity-100' : 'invisible opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
