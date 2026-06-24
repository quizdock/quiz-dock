import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSession } from './game-client';

/**
 * Lance une partie pour un quiz `ready` puis route vers la salle d'attente hôte.
 * La création se fait dans le **handler de clic** (pas un effet de montage) pour
 * éviter le double-déclenchement (StrictMode) → deux PIN orphelins.
 */
export function useLaunchSession() {
  const { t } = useTranslation('live');
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    async (quizId: string) => {
      setError(null);
      setIsLaunching(true);
      try {
        const { pin } = await createSession(quizId);
        await navigate({ to: '/present/$pin/control', params: { pin } });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('errors.launchFailed'));
      } finally {
        setIsLaunching(false);
      }
    },
    [navigate, t],
  );

  return { launch, isLaunching, error };
}
