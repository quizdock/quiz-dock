import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * An empty zone said plainly: an icon in its disc, what is missing, and what
 * to do about it when there is something to do. Dashed, so it reads as a
 * place for content, not as content.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  /** What is missing; the text below says why or what next. */
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center',
        className,
      )}
    >
      <span
        className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full"
        aria-hidden
      >
        <Icon className="size-6" />
      </span>
      {title || children ? (
        <div className="flex flex-col gap-1">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? (
            <div className="text-muted-foreground max-w-sm text-sm">{children}</div>
          ) : null}
        </div>
      ) : null}
      {action}
    </div>
  );
}
