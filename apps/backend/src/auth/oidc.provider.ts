import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import type { AuthPrincipal, AuthProvider } from './auth-provider';
import type { OidcClient } from './oidc/oidc-client';
import type { OidcSessions } from './oidc/oidc-sessions';
import { readCookie, SESSION_COOKIE } from './oidc/session-cookie';

/** Reads a value by dotted path (`resource_access.app.roles`). */
function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * `AUTH_MODE=oidc`: resolves the identity from the tokens of **any OpenID Connect
 * provider** — signature against the provider's JWKS, `iss`, `exp`, and `aud`
 * when configured. Nothing here is provider-specific; everything comes from the
 * standard (Discovery 1.0, Core 1.0 claims) plus environment variables (see
 * `oidcSettings`, and `OIDC_ROLES_CLAIM` / `OIDC_NAME_CLAIM` below).
 *
 * Two ways in:
 * - the browser's **session cookie** (Backend for Frontend): the tokens stay
 *   server-side, in `OidcSessions`, and are renewed there;
 * - a `Bearer` access token, for a client that is not a browser.
 *
 * - `OIDC_ROLES_CLAIM` (optional): dotted path of the roles array claim. Default
 *   `roles`; adapt to your provider (`realm_access.roles`, `groups`, …).
 * - `OIDC_NAME_CLAIM` (optional): dotted path of the display-name claim, symmetric
 *   with the roles one. Unset, the standard fallback chain below applies.
 *
 * Standard claims used: `sub` (identity), `preferred_username` / `name` / `email`
 * (display), and the roles claim above.
 */
@Injectable()
export class OidcProvider implements AuthProvider {
  private readonly logger = new Logger(OidcProvider.name);
  private readonly rolesClaim: string;
  private readonly nameClaim?: string;

  constructor(
    private readonly client: OidcClient,
    private readonly sessions: OidcSessions,
  ) {
    this.rolesClaim = process.env.OIDC_ROLES_CLAIM || 'roles';
    this.nameClaim = process.env.OIDC_NAME_CLAIM || undefined;
  }

  async authenticate(req: Request): Promise<AuthPrincipal | null> {
    const header = req.headers.authorization;
    let token: string | null = null;
    if (header?.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length).trim();
    } else {
      const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (sid) token = await this.sessions.accessToken(sid);
    }
    if (!token) return null;
    try {
      return this.principalOf(await this.client.verifyAccessToken(token));
    } catch (err) {
      this.logger.debug(`JWT rejected: ${(err as Error).message}`);
      return null;
    }
  }

  /** The identity carried by a validated token's claims. */
  principalOf(payload: JWTPayload): AuthPrincipal | null {
    const sub = payload.sub;
    if (!sub) {
      return null;
    }
    const username = payload['preferred_username'];
    const name = payload['name'];
    const email = payload['email'];
    // The configured claim wins when it carries a name; otherwise the standard
    // chain applies, so a deployment may point at `nickname` and still work for
    // the accounts that have none.
    const configured = this.nameClaim ? getByPath(payload, this.nameClaim) : undefined;
    const rolesRaw = getByPath(payload, this.rolesClaim);
    return {
      sub,
      displayName:
        (typeof configured === 'string' && configured) ||
        (typeof username === 'string' && username) ||
        (typeof name === 'string' && name) ||
        (typeof email === 'string' && email) ||
        sub,
      email: typeof email === 'string' ? email : null,
      roles: Array.isArray(rolesRaw)
        ? rolesRaw.filter((r): r is string => typeof r === 'string')
        : [],
    };
  }
}
