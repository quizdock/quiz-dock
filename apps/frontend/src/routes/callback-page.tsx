import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';

/** Retour de redirection OIDC : finalise la connexion puis va au tableau de bord. */
export function CallbackPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { completeOidcLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeOidcLogin()
      .then(() => navigate({ to: '/dashboard' }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('callback.failed')));
  }, [completeOidcLogin, navigate, t]);

  return (
    <p className={error ? 'text-destructive' : 'text-muted-foreground'}>
      {error ? t('callback.error', { message: error }) : t('callback.loading')}
    </p>
  );
}
