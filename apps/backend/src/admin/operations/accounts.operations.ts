import { Injectable } from '@nestjs/common';
import { SETTINGS } from '@quiz-dock/contracts';
import { type Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { HostSeatService } from '../../users/host-seat.service';
import { settings } from '../settings/settings.service';
import { type AdminOperation, defineOperation, done } from './operation';

/** An account, as the accounts page lists it. */
export interface AccountItem {
  id: string;
  name: string;
  subject: string;
  email: string | null;
  /** What it holds now: the identity provider's claims, the seat, and what was granted. */
  roles: UserRole[];
  /** What an administrator granted (`users.set-role`): kept whatever the provider says. */
  granted: UserRole[];
  quizzes: number;
  /** Games it hosted that the history still holds. */
  games: number;
  createdAt: string;
}

export interface AccountsPage {
  total: number;
  items: AccountItem[];
  /** Local mode only (`AUTH_MODE=none`): who holds the host seat; null elsewhere or when free. */
  seat: { holder: string; subject: string; since: string; expiresAt: string | null } | null;
  localMode: boolean;
}

const hasRole = (role: UserRole): Prisma.UserWhereInput => ({
  OR: [{ roles: { has: role } }, { assignedRoles: { has: role } }],
});

/** The accounts of the instance, a page at a time (§0.1, Instance domain). */
@Injectable()
export class AccountsOperations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seat: HostSeatService,
  ) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'users.search',
        domain: 'instance',
        category: 'users',
        effect: 'read',
        summary:
          'Every account, a page at a time: searched by name, subject or e-mail, filtered by role; and who holds the host seat in local mode.',
        params: z.object({
          q: z.string().trim().max(100).optional(),
          role: z.enum(['admin', 'host', 'player']).optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        }),
        run: async (_ctx, { q, role, limit, offset }) => {
          const where: Prisma.UserWhereInput = {
            AND: [
              { deletedAt: null },
              ...(q
                ? [
                    {
                      OR: [
                        { displayName: { contains: q, mode: 'insensitive' as const } },
                        { oidcSubject: { contains: q, mode: 'insensitive' as const } },
                        { email: { contains: q, mode: 'insensitive' as const } },
                      ],
                    },
                  ]
                : []),
              ...(role === 'player'
                ? [{ NOT: [hasRole(UserRole.host), hasRole(UserRole.admin)] }]
                : role
                  ? [hasRole(role)]
                  : []),
            ],
          };
          const localMode = settings.get(SETTINGS.AUTH_MODE) === 'none';
          const [total, users, seat] = await Promise.all([
            this.prisma.user.count({ where }),
            this.prisma.user.findMany({
              where,
              orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
              skip: offset,
              take: limit,
              include: { _count: { select: { quizzes: true, hostedSessions: true } } },
            }),
            localMode ? this.seat.details() : Promise.resolve(null),
          ]);
          return done<AccountsPage>({
            total,
            items: users.map((u) => ({
              id: u.id,
              name: u.displayName,
              subject: u.oidcSubject,
              email: u.email,
              roles: [...new Set([...u.roles, ...u.assignedRoles])],
              granted: u.assignedRoles,
              quizzes: u._count.quizzes,
              games: u._count.hostedSessions,
              createdAt: u.createdAt.toISOString(),
            })),
            seat: seat
              ? {
                  holder: seat.user.displayName,
                  subject: seat.user.oidcSubject,
                  since: seat.claimedAt.toISOString(),
                  expiresAt: seat.expiresAt?.toISOString() ?? null,
                }
              : null,
            localMode,
          });
        },
      }),
    ];
  }
}
