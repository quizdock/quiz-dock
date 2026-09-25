import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorText } from '../api/http';
import { takeAfterLogin, useAuth } from '../auth/auth-context';

/** One exchange per return from the provider: its code and state are good once. */
let pending: { search: string; done: Promise<void> } | null = null;

/**
 * Retour du fournisseur OIDC : le backend échange le code et ouvre la session
 * (cookie), puis on va au tableau de bord — ou à la page d'où venait la
 * connexion (un participant renvoyé vers `/login` depuis `/join/...`, RG-15).
 */
export function CallbackPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { completeOidcLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const search = window.location.search;
    // StrictMode runs effects twice: the second run waits for the first exchange.
    if (pending?.search !== search) {
      pending = { search, done: completeOidcLogin(new URLSearchParams(search)) };
    }
    pending.done
      .then(() => navigate({ to: (takeAfterLogin() ?? '/quizzes') as '/quizzes', replace: true }))
      .catch((e: unknown) => setError(apiErrorText(e, t('callback.failed'))));
  }, [completeOidcLogin, navigate, t]);

  return (
    <p className={error ? 'text-destructive' : 'text-muted-foreground'}>
      {error ? t('callback.error', { message: error }) : t('callback.loading')}
    </p>
  );
}
