import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A filter above a list: its caption small, its control at the page's base size
 * (a field under the base size makes iOS zoom on focus). On a phone the filters
 * of a bar share its line, each taking its part; from `sm` they keep their width.
 */
export function FilterField({
  label,
  as: Tag = 'label',
  className,
  children,
}: {
  label: ReactNode;
  /** `div` when the control holds labelled boxes of its own (a multi-select). */
  as?: 'label' | 'div';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'text-muted-foreground flex min-w-0 flex-1 basis-32 flex-col gap-1 sm:flex-none sm:basis-auto',
        className,
      )}
    >
      <span className="text-xs">{label}</span>
      {children}
    </Tag>
  );
}
