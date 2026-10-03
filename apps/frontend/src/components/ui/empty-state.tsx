import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * An empty zone said plainly: an icon in its disc, what is missing, and what
 * to do about it when there is something to do. Dashed, so it reads as a
 * place for content, not as content. `large` when the empty zone is the page's
 * main content (a page, a pane); the default inside a list or a panel.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  size = 'default',
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  /** What is missing; the text below says why or what next. */
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  size?: 'default' | 'large';
  className?: string;
}) {
  const large = size === 'large';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center border border-dashed px-6 text-center',
        large ? 'gap-4 rounded-2xl py-10' : 'gap-3 rounded-lg py-8',
        className,
      )}
    >
      <span
        className={cn(
          'bg-muted text-muted-foreground flex items-center justify-center rounded-full',
          large ? 'size-16' : 'size-12',
        )}
        aria-hidden
      >
        <Icon className={large ? 'size-8' : 'size-6'} />
      </span>
      {title || children ? (
        <div className="flex flex-col gap-1">
          {title ? <p className={large ? 'font-semibold' : 'font-medium'}>{title}</p> : null}
          {children ? (
            <div className="text-muted-foreground max-w-sm text-sm">{children}</div>
          ) : null}
        </div>
      ) : null}
      {action}
    </div>
  );
}
