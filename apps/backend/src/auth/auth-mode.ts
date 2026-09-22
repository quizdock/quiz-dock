/** The two authentication modes (`AUTH_MODE`), read wherever the behaviour differs. */
export type AuthMode = 'none' | 'oidc';

export function authMode(): AuthMode {
  return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'none';
}

/**
 * `AUTH_MODE=oidc`: everyone authenticates, participants included (RG-15) — the
 * token opens the application, the PIN opens one session. In local mode the PIN
 * stays the only barrier, which is the point of that mode.
 */
export function isOidcMode(): boolean {
  return authMode() === 'oidc';
}
