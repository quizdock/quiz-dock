import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthPrincipal, AuthProvider } from './auth-provider';

interface KeycloakClaims extends JWTPayload {
  preferred_username?: string;
  name?: string;
  email?: string;
  realm_access?: { roles?: string[] };
}

/**
 * Mode `AUTH_MODE=keycloak` : valide le JWT Bearer (signature via JWKS, `iss`,
 * `exp`, et `aud` si configuré) puis en extrait le principal.
 *
 * Important (déploiement Docker) : l'URL JWKS (réseau interne, `keycloak:8080`)
 * et l'`iss` attendu (host vu par la SPA, ex. `localhost:8080`) sont
 * **deux valeurs distinctes** — d'où des variables séparées. L'`aud` est lâche
 * par défaut (les tokens Keycloak portent `aud=account` sans mapper dédié).
 */
@Injectable()
export class KeycloakProvider implements AuthProvider {
  private readonly logger = new Logger(KeycloakProvider.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience?: string;

  constructor() {
    const base = (process.env.KEYCLOAK_URL ?? 'http://keycloak:8080').replace(/\/+$/, '');
    const realm = process.env.KEYCLOAK_REALM ?? 'roux-quizz';
    const jwksUrl =
      process.env.KEYCLOAK_JWKS_URL ?? `${base}/realms/${realm}/protocol/openid-connect/certs`;
    this.issuer = process.env.KEYCLOAK_ISSUER ?? `${base}/realms/${realm}`;
    this.audience = process.env.KEYCLOAK_AUDIENCE || undefined;
    // createRemoteJWKSet est paresseux : aucune requête réseau ici.
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async authenticate(req: Request): Promise<AuthPrincipal | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const { payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        issuer: this.issuer,
        ...(this.audience ? { audience: this.audience } : {}),
      });
      const sub = payload.sub;
      if (!sub) {
        return null;
      }
      return {
        sub,
        displayName: payload.preferred_username ?? payload.name ?? sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        roles: payload.realm_access?.roles ?? [],
      };
    } catch (err) {
      this.logger.debug(`JWT rejeté : ${(err as Error).message}`);
      return null;
    }
  }
}
