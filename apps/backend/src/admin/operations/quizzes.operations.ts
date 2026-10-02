import { Injectable } from '@nestjs/common';
import { type Prisma, QuizStatus, UserRole } from '@prisma/client';
import type { QuizSearchPage } from '@quiz-dock/contracts';
import { livePinOf } from '../../game/game.keys';
import { RedisService } from '../../redis/redis.service';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizzesService } from '../../quizzes/quizzes.service';
import {
  type AdminOperation,
  OperationError,
  defineOperation,
  done,
  nothingToDo,
} from './operation';

const quizId = z.string().trim().min(1).max(64);

/** An owner who can no longer reach their quizzes: an account deleted, or without the host role. */
const ORPHAN_OWNER: Prisma.UserWhereInput = {
  OR: [
    { deletedAt: { not: null } },
    { NOT: [{ roles: { has: UserRole.host } }, { assignedRoles: { has: UserRole.host } }] },
  ],
};

/**
 * The Quizzes domain (§0.1): someone else's quiz, managed administratively —
 * archived, restored, deleted — and the quizzes nobody can reach any more.
 * Through the quizzes' own service: the same rules as their owner's.
 */
@Injectable()
export class QuizzesOperations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quizzes: QuizzesService,
    private readonly redis: RedisService,
  ) {}

  private async quiz(id: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: { owner: { select: { displayName: true, oidcSubject: true } } },
    });
    if (!quiz) throw new OperationError('not_found', `No quiz with id "${id}".`);
    return quiz;
  }

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'quizzes.search',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'read',
        summary:
          'Every quiz of the instance, a page at a time: searched by title, filtered by owner and status, or the ones nobody can reach.',
        params: z.object({
          q: z.string().trim().max(100).optional(),
          owner: z.string().max(64).optional(),
          status: z.enum(['draft', 'ready', 'archived']).optional(),
          orphans: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        }),
        run: async (_ctx, { q, owner, status, orphans, limit, offset }) => {
          const where: Prisma.QuizWhereInput = {
            ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
            ...(owner ? { ownerId: owner } : {}),
            ...(status ? { status } : {}),
            ...(orphans ? { owner: ORPHAN_OWNER } : {}),
          };
          const [total, quizzes, owners] = await Promise.all([
            this.prisma.quiz.count({ where }),
            this.prisma.quiz.findMany({
              where,
              orderBy: { updatedAt: 'desc' },
              skip: offset,
              take: limit,
              include: {
                owner: {
                  select: {
                    id: true,
                    displayName: true,
                    oidcSubject: true,
                    deletedAt: true,
                    roles: true,
                    assignedRoles: true,
                  },
                },
              },
            }),
            this.prisma.user.findMany({
              where: { quizzes: { some: {} } },
              orderBy: { displayName: 'asc' },
              select: {
                id: true,
                displayName: true,
                oidcSubject: true,
                _count: { select: { quizzes: true } },
              },
            }),
          ]);
          const items = await Promise.all(
            quizzes.map(async (quiz) => ({
              id: quiz.id,
              title: quiz.title,
              status: quiz.status,
              questionCount: quiz.questionCount,
              updatedAt: quiz.updatedAt.toISOString(),
              owner: {
                id: quiz.owner.id,
                name: quiz.owner.displayName,
                subject: quiz.owner.oidcSubject,
                // The owner can still reach it: an account not deleted, with the host role.
                reachable:
                  !quiz.owner.deletedAt &&
                  (quiz.owner.roles.includes(UserRole.host) ||
                    quiz.owner.assignedRoles.includes(UserRole.host)),
              },
              // Played right now: not handed over nor deleted until the session ends.
              livePin: await livePinOf(this.redis, quiz.ownerId, quiz.id).catch(() => null),
            })),
          );
          return done<QuizSearchPage>({
            total,
            items,
            owners: owners.map((o) => ({
              id: o.id,
              name: o.displayName,
              subject: o.oidcSubject,
              quizzes: o._count.quizzes,
            })),
          });
        },
      }),
      defineOperation({
        id: 'users.find',
        domain: 'instance',
        category: 'users',
        effect: 'read',
        summary: 'Accounts whose name, subject or e-mail contains a text (to pick one).',
        params: z.object({
          q: z.string().trim().max(100).default(''),
          limit: z.number().int().min(1).max(50).default(20),
        }),
        run: async (_ctx, { q, limit }) => {
          const users = await this.prisma.user.findMany({
            where: {
              deletedAt: null,
              NOT: { oidcSubject: { startsWith: 'system:' } },
              ...(q
                ? {
                    OR: [
                      { displayName: { contains: q, mode: 'insensitive' } },
                      { oidcSubject: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            },
            orderBy: { displayName: 'asc' },
            take: limit,
            select: { displayName: true, oidcSubject: true, email: true, roles: true },
          });
          return done({
            accounts: users.map((u) => ({
              name: u.displayName,
              subject: u.oidcSubject,
              email: u.email,
              roles: u.roles,
            })),
          });
        },
      }),
      defineOperation({
        id: 'quizzes.archive',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'write',
        summary: "Archives someone's quiz: out of their list, kept with its history.",
        params: z.object({ quiz: quizId }),
        run: async (_ctx, { quiz: id }) => {
          const quiz = await this.quiz(id);
          if (quiz.status === QuizStatus.archived)
            return nothingToDo('Already archived.', 'quizzes.unchanged');
          await this.quizzes.transition(quiz.ownerId, id, { status: QuizStatus.archived });
          return { ...done({ quiz: id, title: quiz.title }), memento: { status: quiz.status } };
        },
      }),
      defineOperation({
        id: 'quizzes.restore',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'write',
        summary: 'Brings an archived quiz back to its owner, as a draft.',
        params: z.object({ quiz: quizId }),
        run: async (_ctx, { quiz: id }) => {
          const quiz = await this.quiz(id);
          if (quiz.status !== QuizStatus.archived)
            return nothingToDo('Not archived.', 'quizzes.unchanged');
          await this.quizzes.transition(quiz.ownerId, id, { status: QuizStatus.draft });
          return { ...done({ quiz: id, title: quiz.title }), memento: { status: quiz.status } };
        },
      }),
      defineOperation({
        id: 'quizzes.delete',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'destructive',
        summary:
          "Deletes someone's quiz, its media nothing else uses and its history. Export it first.",
        params: z.object({ quiz: quizId }),
        // Names the quiz and its owner (R11): nobody deletes the wrong one by its id alone.
        describe: async ({ quiz: id }) => {
          const quiz = await this.quiz(id);
          return `Delete "${quiz.title}" of ${quiz.owner.displayName} (${quiz.owner.oidcSubject}), its media nothing else uses and its archived sessions. Export it first: this cannot be undone.`;
        },
        run: async (_ctx, { quiz: id }) => {
          const quiz = await this.quiz(id);
          await this.quizzes.remove(quiz.ownerId, id);
          return {
            ...done({ quiz: id, title: quiz.title }),
            memento: { title: quiz.title, owner: quiz.owner.oidcSubject },
          };
        },
      }),
      defineOperation({
        id: 'quizzes.orphans',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'read',
        summary:
          'Lists the quizzes whose owner can no longer reach them: an account deleted, or without the host role.',
        params: z.object({}),
        run: async () => {
          const quizzes = await this.prisma.quiz.findMany({
            where: { owner: ORPHAN_OWNER },
            orderBy: { updatedAt: 'desc' },
            include: { owner: { select: { oidcSubject: true, deletedAt: true } } },
          });
          return done({
            rows: quizzes.map((q) => ({
              id: q.id,
              title: q.title,
              owner: q.owner.oidcSubject,
              why: q.owner.deletedAt ? 'account deleted' : 'not a host',
              status: q.status,
              updatedAt: q.updatedAt,
            })),
          });
        },
      }),
    ];
  }
}
