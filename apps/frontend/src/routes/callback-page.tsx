import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { takeAfterLogin, useAuth } from '../auth/auth-context';
import { getOidc } from '../auth/oidc';

/**
 * Retour de redirection OIDC : finalise la connexion puis va au tableau de bord —
 * ou à la page d'où venait la connexion (un participant renvoyé vers `/login`
 * depuis `/join/...`, RG-15). Chargée dans l'iframe du renouvellement silencieux,
 * elle ne fait que relayer la réponse au gestionnaire de la fenêtre parente.
 */
export function CallbackPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { completeOidcLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const silent = window.self !== window.top;

  useEffect(() => {
    if (silent) {
      void getOidc().signinSilentCallback();
      return;
    }
    completeOidcLogin()
      .then(() => navigate({ to: (takeAfterLogin() ?? '/quizzes') as '/quizzes' }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('callback.failed')));
  }, [completeOidcLogin, navigate, silent, t]);

  if (silent) return null;

  return (
    <p className={error ? 'text-destructive' : 'text-muted-foreground'}>
      {error ? t('callback.error', { message: error }) : t('callback.loading')}
    </p>
  );
}
