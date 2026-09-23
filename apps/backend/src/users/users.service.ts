import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-provider';
import { effectiveRoles, parseRoles } from '../auth/roles';
import { PrismaService } from '../prisma/prisma.service';
import { HostSeatService } from './host-seat.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seat: HostSeatService,
  ) {}

  /**
   * Provisionne (ou met à jour) l'utilisateur à partir du principal authentifié.
   * Idempotent : clé sur `oidcSubject`. Les identités locales (`local:<slug>`,
   * mode none) passent par le siège d'hôte, qui décide du rôle.
   */
  async upsertFromPrincipal(principal: AuthPrincipal): Promise<User> {
    if (HostSeatService.isLocal(principal.sub)) {
      return this.seat.provision(principal);
    }
    // Les claims sont déjà une liste : on les garde toutes (`host` ET `admin`)
    // au lieu de n'en retenir qu'une. L'octroi d'un opérateur s'y ajoute.
    const claimed = parseRoles(principal.roles);
    const existing = await this.prisma.user.findUnique({
      where: { oidcSubject: principal.sub },
      select: { assignedRoles: true },
    });
    const roles = effectiveRoles(existing?.assignedRoles ?? [], claimed);
    return this.prisma.user.upsert({
      where: { oidcSubject: principal.sub },
      create: {
        oidcSubject: principal.sub,
        displayName: principal.displayName,
        email: principal.email,
        roles,
      },
      update: {
        displayName: principal.displayName,
        email: principal.email,
        roles,
      },
    });
  }
}
