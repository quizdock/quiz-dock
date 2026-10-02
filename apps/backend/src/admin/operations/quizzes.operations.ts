import { Injectable } from '@nestjs/common';
import { QuizStatus, UserRole } from '@prisma/client';
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
            where: {
              OR: [
                { owner: { deletedAt: { not: null } } },
                {
                  owner: {
                    NOT: [
                      { roles: { has: UserRole.host } },
                      { assignedRoles: { has: UserRole.host } },
                    ],
                  },
                },
              ],
            },
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
