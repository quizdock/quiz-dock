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

/**
 * `ALLOW_ANONYMOUS_PARTICIPANTS=true` under `AUTH_MODE=oidc`: hosts may open a
 * game to participants without an account, the PIN and a nickname alone (#57).
 * Off by default — a deployment keeps requiring accounts until an admin opts in.
 * Meaningless in local mode, where the PIN is the only barrier anyway.
 */
export function allowsAnonymousParticipants(): boolean {
  return isOidcMode() && process.env.ALLOW_ANONYMOUS_PARTICIPANTS === 'true';
}
