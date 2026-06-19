import { type ReactNode, useEffect, useRef } from 'react';
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
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive,
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
  /** Contenu additionnel (ex. case à cocher) inséré entre le texte et les actions. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

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
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault(); // Échap → on passe par onCancel (pas de fermeture brutale)
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel(); // clic sur le backdrop
      }}
      className="bg-background text-foreground w-[90vw] max-w-md rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
