import type { Request } from 'express';

/** Jeton d'injection NestJS pour l'implémentation d'`AuthProvider` choisie. */
export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

/** Identité authentifiée, indépendante du mode d'auth (none/keycloak). */
export interface AuthPrincipal {
  /** Sujet stable : `sub` OIDC en mode keycloak, `local:<slug>` en mode none. */
  sub: string;
  displayName: string;
  email: string | null;
  /** Rôles realm (`host`, `player`, `admin`). */
  roles: string[];
}

/**
 * Abstraction d'authentification (SPECIFICATIONS §1) : le reste du code ne dépend
 * que de cette interface, jamais d'une implémentation concrète. Sélection par
 * `AUTH_MODE` (cf. AuthModule).
 */
export interface AuthProvider {
  /**
   * Résout le principal depuis la requête HTTP.
   * @returns le principal authentifié, ou `null` si non authentifié (→ 401).
   */
  authenticate(req: Request): Promise<AuthPrincipal | null>;
}
