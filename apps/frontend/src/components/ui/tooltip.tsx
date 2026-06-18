import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Infobulle légère (sans dépendance Radix) : s'affiche au survol **et au focus
 * clavier** du contenu enveloppé (`group-hover`/`group-focus-within`). Pensée pour
 * de courts libellés d'action ; au-delà, le texte passe à la ligne (`max-w`).
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
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'bg-foreground text-background pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[15rem] -translate-x-1/2 rounded-md px-2 py-1 text-center text-xs font-medium shadow-md',
          'group-hover/tt:block group-focus-within/tt:block',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}
