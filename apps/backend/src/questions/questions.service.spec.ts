import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { QuestionContent } from './dto/question-content.schema';
import { QuestionsService } from './questions.service';

const OWNER = 'owner-1';

const content = (over: Partial<QuestionContent> = {}): QuestionContent =>
  ({
    type: 'single_choice',
    prompt: 'Q ?',
    timeLimitS: 20,
    pointsMode: 'standard',
    options: [
      { color: 'red', shape: 'triangle', isCorrect: true },
      { color: 'blue', shape: 'circle', isCorrect: false },
    ],
    acceptedAnswers: [],
    ...over,
  }) as QuestionContent;

function makePrisma() {
  return {
    quiz: { findFirst: jest.fn(), update: jest.fn() },
    question: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('QuestionsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: QuestionsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new QuestionsService(prisma as unknown as PrismaService);
  });

  describe('isolation par propriétaire', () => {
    it('add : 404 si le quiz n’appartient pas au formateur', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.add(OWNER, 'quiz-x', content())).rejects.toThrow(NotFoundException);
      expect(prisma.question.create).not.toHaveBeenCalled();
    });

    it('update/delete : isolation via le quiz (where quiz.ownerId)', async () => {
      prisma.question.findFirst.mockResolvedValue(null);
      await expect(service.update(OWNER, 'q1', content())).rejects.toThrow(NotFoundException);
      await expect(service.remove(OWNER, 'q1')).rejects.toThrow(NotFoundException);
      expect(prisma.question.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1', quiz: { ownerId: OWNER } },
        }),
      );
    });
  });

  describe('add', () => {
    it('calcule orderIndex et incrémente questionCount atomiquement', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      prisma.question.aggregate.mockResolvedValue({ _max: { orderIndex: 2 } });
      prisma.question.create.mockResolvedValue({ id: 'new' });
      prisma.quiz.update.mockResolvedValue({});
      await service.add(OWNER, 'quiz-1', content());
      expect(prisma.question.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quizId: 'quiz-1', orderIndex: 3 }),
        }),
      );
      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { questionCount: { increment: 1 } },
      });
    });

    it('force pointsMode=none pour un sondage', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      prisma.question.aggregate.mockResolvedValue({ _max: { orderIndex: null } });
      prisma.question.create.mockResolvedValue({ id: 'new' });
      prisma.quiz.update.mockResolvedValue({});
      await service.add(OWNER, 'quiz-1', content({ type: 'poll', pointsMode: 'standard' }));
      const data = prisma.question.create.mock.calls[0][0].data;
      expect(data.pointsMode).toBe('none');
      expect(data.orderIndex).toBe(0);
    });
  });

  describe('reorder', () => {
    const ownedTwo = () =>
      prisma.question.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);

    it('rejette une question hors du quiz', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      ownedTwo();
      await expect(
        service.reorder(OWNER, 'quiz-1', {
          items: [
            { questionId: 'a', orderIndex: 0 },
            { questionId: 'zzz', orderIndex: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette si toutes les questions ne sont pas listées', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      ownedTwo();
      await expect(
        service.reorder(OWNER, 'quiz-1', {
          items: [{ questionId: 'a', orderIndex: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette des positions non permutées', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      ownedTwo();
      await expect(
        service.reorder(OWNER, 'quiz-1', {
          items: [
            { questionId: 'a', orderIndex: 0 },
            { questionId: 'b', orderIndex: 5 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('applique en deux phases (décalage puis position finale)', async () => {
      prisma.quiz.findFirst.mockResolvedValue({ id: 'quiz-1' });
      prisma.question.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
        .mockResolvedValueOnce([]);
      prisma.question.update.mockResolvedValue({});
      await service.reorder(OWNER, 'quiz-1', {
        items: [
          { questionId: 'a', orderIndex: 1 },
          { questionId: 'b', orderIndex: 0 },
        ],
      });
      // 2 updates de décalage + 2 updates finaux
      expect(prisma.question.update).toHaveBeenCalledTimes(4);
      const offsets = prisma.question.update.mock.calls
        .slice(0, 2)
        .map((c) => c[0].data.orderIndex);
      expect(offsets).toEqual([1001, 1000]);
    });
  });
});
