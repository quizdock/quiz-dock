import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';

/**
 * Modal de confirmation custom basée sur l'élément natif `<dialog>` (pas `confirm()`).
 * Contrôlée par `open` : ouvre/ferme en modal (focus trap + backdrop natifs). Repli
 * sur l'attribut `open` si `showModal` n'est pas implémenté (jsdom en test).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  confirmDisabled,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** The confirm button waits until what the dialog asks for is right. */
  confirmDisabled?: boolean;
  /** Contenu additionnel (ex. case à cocher) inséré entre le texte et les actions. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      try {
        if (!d.open) d.showModal();
      } catch {
        d.setAttribute('open', ''); // jsdom : showModal non implémenté
      }
    } else if (d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open'); // jsdom: close non implémenté
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Échap → on passe par onCancel (pas de fermeture brutale)
        // React bubbles it through the component tree: a dialog opened from another must not close that one too.
        e.stopPropagation();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel(); // clic sur le backdrop
      }}
      className="bg-background text-foreground m-auto w-[90vw] max-w-md rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
