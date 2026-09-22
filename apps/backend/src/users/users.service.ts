import { Injectable } from '@nestjs/common';
import { type User, UserRole } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-provider';
import { effectiveRole } from '../auth/roles';
import { PrismaService } from '../prisma/prisma.service';
import { HostSeatService } from './host-seat.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seat: HostSeatService,
  ) {}

  /** Mappe les rôles OIDC sur le rôle interne (le plus élevé l'emporte). */
  private resolveRole(roles: string[]): UserRole {
    if (roles.includes('admin')) return UserRole.admin;
    if (roles.includes('host')) return UserRole.host;
    return UserRole.player;
  }

  /**
   * Provisionne (ou met à jour) l'utilisateur à partir du principal authentifié.
   * Idempotent : clé sur `oidcSubject`. Les identités locales (`local:<slug>`,
   * mode none) passent par le siège d'hôte, qui décide du rôle.
   */
  async upsertFromPrincipal(principal: AuthPrincipal): Promise<User> {
    if (HostSeatService.isLocal(principal.sub)) {
      return this.seat.provision(principal);
    }
    const claimed = this.resolveRole(principal.roles);
    // An operator grant (CLI) is sticky: the claims derive a role, never lower it.
    const existing = await this.prisma.user.findUnique({
      where: { oidcSubject: principal.sub },
      select: { assignedRole: true },
    });
    const role = effectiveRole(existing?.assignedRole ?? null, claimed);
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
