import { UserManager } from 'oidc-client-ts';

/**
 * Gestionnaire OIDC (Authorization Code + PKCE pour SPA publique). Initialisé
 * au démarrage depuis la config renvoyée par le backend (`GET /auth/config`).
 */
let manager: UserManager | null = null;

export function initOidc(authority: string, clientId: string): UserManager {
  manager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: window.location.origin,
    scope: 'openid profile email',
  });
  return manager;
}

export function getOidc(): UserManager {
  if (!manager) {
    throw new Error('OIDC non initialisé (mode non-oidc ?).');
  }
  return manager;
}
