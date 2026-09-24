import type { ParticipantAccess } from '@quiz-dock/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { meControllerGetPreferences, meControllerUpdatePreferences } from '../api/generated/me/me';
import { getAuthMode } from '../auth/auth-context';
import { allowsAnonymousParticipants } from '../config';
import { type SessionOptions, createSession } from './game-client';
import { LaunchAccessDialog } from './launch-access-dialog';

/**
 * Lance une partie pour un quiz `ready` puis route vers la console hôte. La création
 * se fait dans le **handler de clic** (pas un effet de montage) pour éviter le
 * double-déclenchement (StrictMode) → deux PIN orphelins.
 *
 * When the server lets hosts open a game to all (#57), the host first picks how
 * participants get in — fixed for the whole game — in a dialog preselected with
 * their last choice (account preferences). Otherwise the game starts at once, as
 * before. Render `dialog` wherever the hook is used.
 */
export function useLaunchSession() {
  const { t } = useTranslation('live');
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    quizId: string;
    options: SessionOptions;
    access: ParticipantAccess;
  } | null>(null);

  const start = useCallback(
    async (quizId: string, options: SessionOptions) => {
      setError(null);
      setIsLaunching(true);
      try {
        const { pin } = await createSession(quizId, options);
        await navigate({ to: '/session/$pin/console', params: { pin } });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('errors.launchFailed'));
      } finally {
        setIsLaunching(false);
      }
    },
    [navigate, t],
  );

  const launch = useCallback(
    async (quizId: string, options: SessionOptions = {}) => {
      if (getAuthMode() !== 'oidc' || !allowsAnonymousParticipants()) {
        await start(quizId, options);
        return;
      }
      setError(null);
      // The last choice, or accounts required the first time (and when unreadable).
      const remembered = await meControllerGetPreferences()
        .then((res) => res.data.participantAccess)
        .catch(() => undefined);
      setPending({ quizId, options, access: remembered ?? 'account' });
    },
    [start],
  );

  const onConfirm = (access: ParticipantAccess) => {
    if (!pending) return;
    setPending(null);
    if (access !== pending.access) {
      // Remembered for the next launch, wherever the host signs in; a failure
      // only costs the preselection.
      void meControllerUpdatePreferences({ participantAccess: access }).catch(() => undefined);
    }
    void start(pending.quizId, { ...pending.options, participantAccess: access });
  };

  const dialog = (
    <LaunchAccessDialog
      open={pending !== null}
      initial={pending?.access ?? 'account'}
      onConfirm={onConfirm}
      onCancel={() => setPending(null)}
    />
  );

  return { launch, isLaunching, error, dialog };
}
