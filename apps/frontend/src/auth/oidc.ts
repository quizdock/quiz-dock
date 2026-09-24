import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * OIDC user manager (Authorization Code + PKCE, public SPA client). Initialised
 * at boot from the backend config (`GET /auth/config`), which only carries the
 * standard pieces: the issuer (`authority`, discovered through
 * `.well-known/openid-configuration`) and the public `client_id`.
 */
let manager: UserManager | null = null;

export function initOidc(authority: string, clientId: string): UserManager {
  manager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: window.location.origin,
    scope: 'openid profile email',
    // Renew the access token before it expires (refresh token when the provider
    // issues one, silent iframe otherwise); consumers listen to `userLoaded`.
    automaticSilentRenew: true,
    silent_redirect_uri: `${window.location.origin}/auth/callback`,
    // The session lives in localStorage, not the default sessionStorage: that one
    // is per tab, so a preview or a console opened in a new tab came up signed out.
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
  return manager;
}

export function getOidc(): UserManager {
  if (!manager) {
    throw new Error('OIDC non initialisé (mode non-oidc ?).');
  }
  return manager;
}
