import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/auth-context';

/** Retour de redirection OIDC : finalise la connexion puis va au tableau de bord. */
export function CallbackPage() {
  const { completeOidcLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeOidcLogin()
      .then(() => navigate({ to: '/dashboard' }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Connexion échouée.'));
  }, [completeOidcLogin, navigate]);

  return (
    <p className={error ? 'text-destructive' : 'text-muted-foreground'}>
      {error ? `Échec de la connexion : ${error}` : 'Connexion…'}
    </p>
  );
}
