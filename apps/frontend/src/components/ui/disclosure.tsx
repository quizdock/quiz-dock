import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A secondary group of settings, folded behind its title. The summary line says
 * what the group is set to, so folding never hides a choice that differs from
 * the norm. Fields stay mounted while folded (native `<details>`).
 */
export function Disclosure({
  title,
  value,
  defaultOpen = false,
  flush = false,
  className,
  children,
}: {
  title: ReactNode;
  /** The current setting, read at a glance on the folded line. Text only: nothing clickable. */
  value?: ReactNode;
  /** Read once, on mount: a panel does not close under the cursor when its content empties. */
  defaultOpen?: boolean;
  /** Inside a card that already draws the frame: no border, no side padding. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [initialOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDetailsElement>(null);
  // A field that refuses the submit must be seen: the browser cannot focus it
  // in a closed panel and would drop the submit without a word.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const open = () => {
      el.open = true;
    };
    el.addEventListener('invalid', open, true);
    return () => el.removeEventListener('invalid', open, true);
  }, []);
  return (
    <details
      ref={ref}
      open={initialOpen}
      className={cn('group', !flush && 'rounded-lg border', className)}
    >
      <summary
        className={cn(
          'flex cursor-pointer items-center gap-2 text-sm font-medium select-none',
          flush ? 'py-1' : 'px-3 py-2',
        )}
      >
        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
        {title}
        {value ? (
          <span className="text-muted-foreground ml-auto flex min-w-0 items-center gap-2 truncate text-xs font-normal">
            {value}
          </span>
        ) : null}
      </summary>
      <div className={cn('flex flex-col gap-3 border-t py-3', !flush && 'px-3')}>{children}</div>
    </details>
  );
}
