import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Sheet rendered in a portal on `<body>` with its own backdrop and a fixed
 * z-index — not a `<dialog>` top layer, which WebKit paints under composited
 * page content (resizable editors, sticky columns). A bottom sheet, or a
 * right-hand panel on wide screens with `side="right"`. Escape and the
 * backdrop call `onClose`; the caller decides whether that needs confirming.
 */
export function Drawer({
  open,
  title,
  onClose,
  className,
  side = 'bottom',
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  className?: string;
  side?: 'bottom' | 'right';
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, read when Escape is pressed: a caller re-rendering with a
  // new function must not run the effect again (it would take the focus back).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Not an Escape already handled (a menu), nor one meant for a dialog opened
      // over the sheet (a confirmation): that one closes, the sheet stays.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('dialog[open]')) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus lands inside the sheet so keyboard users are not left on the page behind.
    const focusable = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'bg-background text-foreground absolute flex flex-col shadow-2xl',
          side === 'right'
            ? 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[30rem] lg:rounded-none lg:border-t-0 lg:border-l'
            : 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <span
            className={cn(
              'bg-muted-foreground/30 absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full',
              side === 'right' && 'lg:hidden',
            )}
          />
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            aria-label={t('close')}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
