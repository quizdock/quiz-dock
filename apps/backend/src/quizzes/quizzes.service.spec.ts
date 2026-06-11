import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type Quiz, QuizStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { QuizzesService } from './quizzes.service';

const OWNER = 'owner-1';

function makeQuiz(over: Partial<Quiz> = {}): Quiz {
  return {
    id: 'q1',
    ownerId: OWNER,
    title: 'T',
    description: null,
    coverMediaId: null,
    status: QuizStatus.draft,
    visibility: 'private',
    language: 'fr',
    questionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    ...over,
  } as Quiz;
}

function makePrisma() {
  return {
    quiz: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('QuizzesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: QuizzesService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new QuizzesService(prisma as unknown as PrismaService);
  });

  describe('isolation par propriétaire', () => {
    it('list filtre sur ownerId', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      await service.list(OWNER);
      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: OWNER } }),
      );
    });

    it('get cherche par id ET ownerId', async () => {
      prisma.quiz.findFirst.mockResolvedValue(makeQuiz());
      await service.get(OWNER, 'q1');
      expect(prisma.quiz.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1', ownerId: OWNER } }),
      );
    });

    it('get renvoie 404 si non possédé', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.get(OWNER, 'q1')).rejects.toThrow(NotFoundException);
    });

    it('update et delete vérifient la possession avant d’agir', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.update(OWNER, 'q1', {})).rejects.toThrow(NotFoundException);
      await expect(service.remove(OWNER, 'q1')).rejects.toThrow(NotFoundException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
    });
  });

  describe('cycle de vie (RG-02)', () => {
    it('refuse draft→ready sans question', async () => {
      prisma.quiz.findFirst.mockResolvedValue(
        makeQuiz({ status: QuizStatus.draft, questionCount: 0 }),
      );
      await expect(service.transition(OWNER, 'q1', { status: 'ready' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('autorise draft→ready avec au moins une question', async () => {
      prisma.quiz.findFirst.mockResolvedValue(
        makeQuiz({ status: QuizStatus.draft, questionCount: 2 }),
      );
      prisma.quiz.update.mockResolvedValue(makeQuiz({ status: QuizStatus.ready }));
      await service.transition(OWNER, 'q1', { status: 'ready' });
      expect(prisma.quiz.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: expect.objectContaining({ status: 'ready' }),
        }),
      );
    });

    it('refuse une transition illégale (ready→archived autorisée, archived→ready non)', async () => {
      prisma.quiz.findFirst.mockResolvedValue(makeQuiz({ status: QuizStatus.archived }));
      await expect(service.transition(OWNER, 'q1', { status: 'ready' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('horodate archivedAt en passant à archived', async () => {
      prisma.quiz.findFirst.mockResolvedValue(makeQuiz({ status: QuizStatus.ready }));
      prisma.quiz.update.mockResolvedValue(makeQuiz());
      await service.transition(OWNER, 'q1', { status: 'archived' });
      const data = prisma.quiz.update.mock.calls[0][0].data;
      expect(data.status).toBe('archived');
      expect(data.archivedAt).toBeInstanceOf(Date);
    });
  });
});
