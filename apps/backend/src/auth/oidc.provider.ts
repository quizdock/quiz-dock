import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthPrincipal, AuthProvider } from './auth-provider';

/** Reads a value by dotted path (`resource_access.app.roles`). */
function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

type Jwks = ReturnType<typeof createRemoteJWKSet>;

/**
 * `AUTH_MODE=oidc`: validates the Bearer JWT of **any OpenID Connect provider** —
 * signature against the provider's JWKS, `iss`, `exp`, and `aud` when configured.
 * Nothing here is provider-specific; everything comes from the standard
 * (Discovery 1.0, Core 1.0 claims) plus environment variables:
 *
 * - `OIDC_ISSUER` (required): the `iss` expected in tokens.
 * - `OIDC_JWKS_URI` (optional): JWKS endpoint. Default: resolved lazily from
 *   `${issuer}/.well-known/openid-configuration` (`jwks_uri`). Set it explicitly
 *   when the backend cannot reach the issuer host (e.g. Docker-internal hostname).
 * - `OIDC_AUDIENCE` (optional): expected `aud`; skipped when unset.
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
  private readonly issuer: string;
  private readonly audience?: string;
  private readonly rolesClaim: string;
  private readonly nameClaim?: string;
  private readonly jwksUri?: string;
  private jwks: Promise<Jwks> | null = null;

  constructor() {
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) {
      throw new Error('OIDC_ISSUER is required when AUTH_MODE=oidc.');
    }
    this.issuer = issuer.replace(/\/+$/, '');
    this.jwksUri = process.env.OIDC_JWKS_URI || undefined;
    this.audience = process.env.OIDC_AUDIENCE || undefined;
    this.rolesClaim = process.env.OIDC_ROLES_CLAIM || 'roles';
    this.nameClaim = process.env.OIDC_NAME_CLAIM || undefined;
  }

  /**
   * JWKS key set, resolved once (explicit URI, or OIDC Discovery). A failed
   * discovery is not cached so the next request retries — the IdP may simply
   * not be up yet at boot.
   */
  private getJwks(): Promise<Jwks> {
    if (!this.jwks) {
      this.jwks = this.resolveJwksUri().then((uri) => createRemoteJWKSet(new URL(uri)));
      this.jwks.catch(() => {
        this.jwks = null;
      });
    }
    return this.jwks;
  }

  private async resolveJwksUri(): Promise<string> {
    if (this.jwksUri) return this.jwksUri;
    const url = `${this.issuer}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${url} → HTTP ${res.status}`);
    }
    const doc = (await res.json()) as { issuer?: string; jwks_uri?: string };
    if (typeof doc.jwks_uri !== 'string') {
      throw new Error(`OIDC discovery document at ${url} has no jwks_uri.`);
    }
    if (doc.issuer && doc.issuer.replace(/\/+$/, '') !== this.issuer) {
      this.logger.warn(
        `Discovery issuer "${doc.issuer}" differs from OIDC_ISSUER "${this.issuer}" — tokens must carry the latter.`,
      );
    }
    this.logger.log(`JWKS resolved via discovery: ${doc.jwks_uri}`);
    return doc.jwks_uri;
  }

  async authenticate(req: Request): Promise<AuthPrincipal | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const { payload } = await jwtVerify<JWTPayload>(token, await this.getJwks(), {
        issuer: this.issuer,
        ...(this.audience ? { audience: this.audience } : {}),
      });
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
    } catch (err) {
      this.logger.debug(`JWT rejected: ${(err as Error).message}`);
      return null;
    }
  }
}
