import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthPrincipal, AuthProvider } from './auth-provider';

/** Lit une valeur via un chemin pointé (`realm_access.roles`). */
function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Mode `AUTH_MODE=oidc` : valide le JWT Bearer d'un fournisseur **OIDC quelconque**
 * (signature via JWKS, `iss`, `exp`, et `aud` si configuré). Keycloak est l'IdP de
 * référence en dev, mais rien ici ne lui est spécifique : tout est configuré par
 * variables d'environnement.
 *
 * - `OIDC_ISSUER` (requis) : `iss` attendu (ex. `https://idp.example/realms/app`).
 * - `OIDC_JWKS_URI` : endpoint JWKS. **Distinct** de l'issuer en déploiement Docker
 *   (host interne ≠ host vu par le navigateur). Défaut : `${issuer}/protocol/openid-connect/certs`.
 * - `OIDC_AUDIENCE` (optionnel) : `aud` attendu (lâche si absent).
 * - `OIDC_ROLES_CLAIM` : chemin pointé du claim de rôles. Défaut `realm_access.roles`
 *   (compatible Keycloak) ; mettre `roles` pour un IdP au claim plat.
 */
@Injectable()
export class OidcProvider implements AuthProvider {
  private readonly logger = new Logger(OidcProvider.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience?: string;
  private readonly rolesClaim: string;

  constructor() {
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) {
      throw new Error('OIDC_ISSUER est requis quand AUTH_MODE=oidc.');
    }
    this.issuer = issuer.replace(/\/+$/, '');
    const jwksUri = process.env.OIDC_JWKS_URI ?? `${this.issuer}/protocol/openid-connect/certs`;
    this.audience = process.env.OIDC_AUDIENCE || undefined;
    this.rolesClaim = process.env.OIDC_ROLES_CLAIM ?? 'realm_access.roles';
    // createRemoteJWKSet est paresseux : aucune requête réseau ici.
    this.jwks = createRemoteJWKSet(new URL(jwksUri));
  }

  async authenticate(req: Request): Promise<AuthPrincipal | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const { payload } = await jwtVerify<JWTPayload>(token, this.jwks, {
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
      const rolesRaw = getByPath(payload, this.rolesClaim);
      return {
        sub,
        displayName:
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
      this.logger.debug(`JWT rejeté : ${(err as Error).message}`);
      return null;
    }
  }
}
