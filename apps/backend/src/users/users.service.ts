import { Injectable } from '@nestjs/common';
import { type User, UserRole } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-provider';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mappe les rôles OIDC sur le rôle interne (le plus élevé l'emporte). */
  private resolveRole(roles: string[]): UserRole {
    if (roles.includes('admin')) return UserRole.Admin;
    if (roles.includes('host')) return UserRole.Host;
    return UserRole.Player;
  }

  /**
   * Provisionne (ou met à jour) l'utilisateur à partir du principal authentifié.
   * Idempotent : clé sur `oidcSubject` (inclut le sentinel `local:<slug>`).
   */
  async upsertFromPrincipal(principal: AuthPrincipal): Promise<User> {
    const role = this.resolveRole(principal.roles);
    return this.prisma.user.upsert({
      where: { oidcSubject: principal.sub },
      create: {
        oidcSubject: principal.sub,
        displayName: principal.displayName,
        email: principal.email,
        role,
      },
      update: {
        displayName: principal.displayName,
        email: principal.email,
        role,
      },
    });
  }
}
