import type { ParticipantAccess } from '@quiz-dock/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const CHOICES: ParticipantAccess[] = ['account', 'open'];

/**
 * How participants get into the game about to start (#57): with their account,
 * or with the PIN and a nickname alone. Fixed for the whole game, so the room
 * never mixes the two rules.
 */
export function LaunchAccessDialog({
  open,
  initial,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  initial: ParticipantAccess;
  onConfirm: (access: ParticipantAccess) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('live');
  const [access, setAccess] = useState<ParticipantAccess>(initial);
  // Each opening starts from the remembered choice.
  useEffect(() => {
    if (open) setAccess(initial);
  }, [open, initial]);

  return (
    <ConfirmDialog
      open={open}
      title={t('launchAccess.title')}
      description={t('launchAccess.description')}
      confirmLabel={t('launchAccess.confirm')}
      onConfirm={() => onConfirm(access)}
      onCancel={onCancel}
    >
      <div role="radiogroup" aria-label={t('launchAccess.title')} className="flex flex-col gap-2">
        {CHOICES.map((choice) => (
          <label
            key={choice}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
              access === choice && 'border-primary bg-primary/5',
            )}
          >
            <input
              type="radio"
              name="participant-access"
              className="accent-primary mt-1"
              checked={access === choice}
              onChange={() => setAccess(choice)}
            />
            <span>
              <span className="font-medium">{t(`launchAccess.${choice}.label`)}</span>
              <span className="text-muted-foreground block">
                {t(`launchAccess.${choice}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
