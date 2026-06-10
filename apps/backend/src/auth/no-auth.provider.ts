import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal, AuthProvider } from './auth-provider';

/** Slug déterministe (minuscule, sans accent, alphanumérique + tirets). */
export function localSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
}

/**
 * Mode `AUTH_MODE=none` : pas de JWT. L'hôte s'identifie par un simple nom local
 * via l'en-tête `X-Local-User` (SPECIFICATIONS §1). Toujours authentifié (rôle
 * `host`) ; deux requêtes avec le même nom → même `sub` (isolation testable).
 */
@Injectable()
export class NoAuthProvider implements AuthProvider {
  async authenticate(req: Request): Promise<AuthPrincipal> {
    const header = req.headers['x-local-user'];
    const raw = (Array.isArray(header) ? header[0] : header)?.trim();
    const displayName = raw && raw.length > 0 ? raw : 'Formateur local';
    return {
      sub: `local:${localSlug(displayName)}`,
      displayName,
      email: null,
      roles: ['host'],
    };
  }
}
