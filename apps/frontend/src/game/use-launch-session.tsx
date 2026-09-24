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
 * participants get in — fixed for the whole game — in a dialog, unless they asked
 * it to remember their choice (account preferences, changed in the profile): the
 * game then starts at once with it, as it does when open access is not offered.
 * Render `dialog` wherever the hook is used.
 */
export function useLaunchSession() {
  const { t } = useTranslation('live');
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ quizId: string; options: SessionOptions } | null>(null);

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
      // Unreadable preferences only cost the shortcut: the dialog asks.
      const remembered = await meControllerGetPreferences()
        .then((res) => res.data.participantAccess)
        .catch(() => undefined);
      if (remembered) {
        await start(quizId, { ...options, participantAccess: remembered });
        return;
      }
      setPending({ quizId, options });
    },
    [start],
  );

  const onConfirm = (access: ParticipantAccess, remember: boolean) => {
    if (!pending) return;
    setPending(null);
    if (remember) {
      // Used without asking from now on, wherever the host signs in; a failure
      // only means being asked again next time.
      void meControllerUpdatePreferences({ participantAccess: access }).catch(() => undefined);
    }
    void start(pending.quizId, { ...pending.options, participantAccess: access });
  };

  const dialog = (
    <LaunchAccessDialog
      open={pending !== null}
      onConfirm={onConfirm}
      onCancel={() => setPending(null)}
    />
  );

  return { launch, isLaunching, error, dialog };
}
