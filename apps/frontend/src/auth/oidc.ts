import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * OIDC user manager (Authorization Code + PKCE, public SPA client). Initialised
 * at boot from the backend config (`GET /auth/config`), which only carries the
 * standard pieces: the issuer (`authority`, discovered through
 * `.well-known/openid-configuration`) and the public `client_id`.
 */
let manager: UserManager | null = null;

export type SessionScope = 'browser' | 'tab';

export function initOidc(
  authority: string,
  clientId: string,
  sessionScope: SessionScope = 'browser',
): UserManager {
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
    // `browser` (default): the session lives in localStorage, shared by the tabs —
    // a preview or a console opened in a new tab stays signed in. `tab`: in
    // sessionStorage, each tab signing in on its own (shared computers).
    userStore: new WebStorageStateStore({
      store: sessionScope === 'tab' ? window.sessionStorage : window.localStorage,
    }),
  });
  return manager;
}

export function getOidc(): UserManager {
  if (!manager) {
    throw new Error('OIDC non initialisé (mode non-oidc ?).');
  }
  return manager;
}
