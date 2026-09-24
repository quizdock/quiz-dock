import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DEMO_USER, isDemoMode } from '../demo/demo.config';
import { type AuthPrincipal, type AuthProvider, LOCAL_SUB_PREFIX } from './auth-provider';

/** Slug déterministe (minuscule, sans accent, alphanumérique + tirets). */
export function localSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
}

/**
 * Mode `AUTH_MODE=none` : pas de JWT. L'hôte s'identifie par un simple nom local
 * via l'en-tête `X-Local-User` (SPECIFICATIONS §1) ; deux requêtes avec le même
 * nom → même `sub` ; sans en-tête → non authentifié (401). Le rôle n'est PAS porté par le principal : il est attribué au
 * provisionnement par le **siège d'hôte** (`HostSeatService`) — premier arrivé
 * dans l'espace hôte = `host`, les autres = `player`.
 *
 * Sur une démo publique (`DEMO_MODE`), tout nom devient `DEMO_USER` : un seul
 * compte hôte, partagé par tous les visiteurs.
 */
@Injectable()
export class NoAuthProvider implements AuthProvider {
  async authenticate(req: Request): Promise<AuthPrincipal | null> {
    const header = req.headers['x-local-user'];
    const displayName = (Array.isArray(header) ? header[0] : header)?.trim();
    // Sans nom, pas d'identité : une requête anonyme ne doit jamais provisionner
    // (ni, a fortiori, prendre le siège d'hôte) par effet de bord.
    if (!displayName) {
      return null;
    }
    return localPrincipal(isDemoMode() ? DEMO_USER : displayName);
  }
}

/** Le principal d'un nom local : même nom → même `sub`. */
export function localPrincipal(displayName: string): AuthPrincipal {
  return {
    sub: `${LOCAL_SUB_PREFIX}${localSlug(displayName)}`,
    displayName,
    email: null,
    roles: [],
  };
}
