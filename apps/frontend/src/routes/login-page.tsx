import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/auth-context';

/**
 * Connexion formateur. Mode local (`AUTH_MODE=none`) : un simple nom suffit.
 * (Le flux OIDC sera branché quand `AUTH_MODE=oidc`.)
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    login(name);
    void navigate({ to: '/dashboard' });
  };

  return (
    <section className="login">
      <h1>Espace formateur</h1>
      <form onSubmit={submit}>
        <label htmlFor="name">Votre nom</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex. Marie Formatrice"
          autoFocus
        />
        <button type="submit" disabled={!name.trim()}>
          Continuer
        </button>
      </form>
      <small>Mode local (démo). Aucune donnée n’est envoyée à un tiers.</small>
    </section>
  );
}
