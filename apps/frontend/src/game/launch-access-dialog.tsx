import type { ParticipantAccess } from '@quiz-dock/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const CHOICES: ParticipantAccess[] = ['account', 'open'];

/**
 * How participants get into the game about to start (#57): with their account,
 * or with the PIN and a nickname alone. Fixed for the whole game, so the room
 * never mixes the two rules. "Remember" stops the question for the next launches
 * (the profile page changes it back).
 */
export function LaunchAccessDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: (access: ParticipantAccess, remember: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('live');
  const [access, setAccess] = useState<ParticipantAccess>('account');
  const [remember, setRemember] = useState(false);
  // Each opening starts over: accounts required, nothing remembered.
  useEffect(() => {
    if (!open) return;
    setAccess('account');
    setRemember(false);
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      title={t('launchAccess.title')}
      description={t('launchAccess.description')}
      confirmLabel={t('launchAccess.confirm')}
      onConfirm={() => onConfirm(access, remember)}
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
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary mt-1"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>
          {t('launchAccess.remember')}
          <span className="text-muted-foreground block text-xs">
            {t('launchAccess.rememberHint')}
          </span>
        </span>
      </label>
    </ConfirmDialog>
  );
}
