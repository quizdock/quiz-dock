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
    quizFeedback: {
      findMany: jest.fn(),
    },
    gameSessionLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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

    it('feedback renvoie 404 pour un non-propriétaire (et ne lit aucun avis)', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.feedback('someone-else', 'q1')).rejects.toThrow(NotFoundException);
      expect(prisma.quizFeedback.findMany).not.toHaveBeenCalled();
    });

    it('feedback agrège moyenne + nombre pour le propriétaire', async () => {
      prisma.quiz.findFirst.mockResolvedValue(makeQuiz());
      prisma.quizFeedback.findMany.mockResolvedValue([
        { id: 'f1', rating: 5, comment: 'top', nickname: 'A', createdAt: new Date() },
        { id: 'f2', rating: 2, comment: null, nickname: 'B', createdAt: new Date() },
      ]);
      const res = await service.feedback(OWNER, 'q1');
      expect(prisma.quizFeedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { quizId: 'q1' } }),
      );
      expect(res.count).toBe(2);
      expect(res.average).toBe(3.5);
    });
  });

  describe('historique des sessions (§2.7-2.9)', () => {
    it('sessions renvoie 404 pour un non-propriétaire (et ne lit aucune session)', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.sessions('someone-else', 'q1')).rejects.toThrow(NotFoundException);
      expect(prisma.gameSessionLog.findMany).not.toHaveBeenCalled();
    });

    it('sessions projette Decimal→number et Date→ISO (récentes d’abord)', async () => {
      prisma.quiz.findFirst.mockResolvedValue(makeQuiz());
      const started = new Date('2026-06-19T10:00:00.000Z');
      const ended = new Date('2026-06-19T10:20:00.000Z');
      prisma.gameSessionLog.findMany.mockResolvedValue([
        {
          id: 's1',
          pin: '123456',
          status: 'ended',
          playerCount: 3,
          successRate: { toString: () => '0.5' }, // simule un Prisma.Decimal
          fullCapture: true,
          startedAt: started,
          endedAt: ended,
        },
      ]);
      const res = await service.sessions(OWNER, 'q1');
      expect(prisma.gameSessionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { quizId: 'q1' }, orderBy: { startedAt: 'desc' } }),
      );
      expect(res.sessions[0]).toMatchObject({
        id: 's1',
        successRate: 0.5,
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
      });
    });

    it('sessionDetail renvoie 404 si la session n’appartient pas à un quiz possédé', async () => {
      prisma.gameSessionLog.findFirst.mockResolvedValue(null);
      await expect(service.sessionDetail(OWNER, 'q1', 's1')).rejects.toThrow(NotFoundException);
      expect(prisma.gameSessionLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', quizId: 'q1', quiz: { ownerId: OWNER } } }),
      );
    });

    it('sessionDetail joint les énoncés du snapshot aux agrégats par question', async () => {
      prisma.gameSessionLog.findFirst.mockResolvedValue({
        id: 's1',
        pin: '123456',
        status: 'interrupted',
        language: 'fr',
        playerCount: 1,
        successRate: { toString: () => '1' },
        fullCapture: false,
        startedAt: new Date('2026-06-19T10:00:00.000Z'),
        endedAt: new Date('2026-06-19T10:05:00.000Z'),
        quizSnapshot: {
          title: 'Mon quiz',
          questions: [{ orderIndex: 0, prompt: 'Capitale ?', type: 'single_choice' }],
        },
        questionStats: [
          {
            orderIndex: 0,
            answerCount: 1,
            correctCount: 1,
            successRate: { toString: () => '1' },
            avgResponseMs: 1200,
          },
        ],
        playerResults: [
          {
            id: 'pr1',
            nickname: 'Zoe',
            finalRank: 1,
            finalScore: 1000,
            correctCount: 1,
            answeredCount: 1,
            avgResponseMs: 1200,
            maxStreak: 1,
          },
        ],
      });
      const res = await service.sessionDetail(OWNER, 'q1', 's1');
      expect(res.quizTitle).toBe('Mon quiz');
      expect(res.status).toBe('interrupted');
      expect(res.questions[0]).toMatchObject({
        prompt: 'Capitale ?',
        successRate: 1,
        answerCount: 1,
      });
      expect(res.players[0]).toMatchObject({ nickname: 'Zoe', finalRank: 1, finalScore: 1000 });
    });

    it('sessionPlayerDetail renvoie 404 si le participant n’existe pas (session vide)', async () => {
      prisma.gameSessionLog.findFirst.mockResolvedValue({
        fullCapture: true,
        quizSnapshot: {},
        playerResults: [],
        answerLogs: [],
      });
      await expect(service.sessionPlayerDetail(OWNER, 'q1', 's1', 'pr1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sessionPlayerDetail rend les réponses lisibles depuis le snapshot (option → texte)', async () => {
      prisma.gameSessionLog.findFirst.mockResolvedValue({
        fullCapture: true,
        quizSnapshot: {
          questions: [
            {
              orderIndex: 0,
              prompt: 'Capitale ?',
              type: 'single_choice',
              options: [
                { id: 'optA', text: 'Paris' },
                { id: 'optB', text: 'Lyon' },
              ],
            },
            { orderIndex: 1, prompt: 'Combien ?', type: 'numeric', options: [] },
            {
              orderIndex: 2,
              prompt: 'Lesquels ?',
              type: 'multiple_choice',
              options: [
                { id: 'optC', text: 'Bleu' },
                { id: 'optD', text: 'Vert' },
              ],
            },
            {
              orderIndex: 3,
              prompt: 'Dans l’ordre ?',
              type: 'ordering',
              options: [
                { id: 'o1', text: 'Un' },
                { id: 'o2', text: 'Deux' },
              ],
            },
          ],
        },
        playerResults: [
          {
            id: 'pr1',
            nickname: 'Zoe',
            finalRank: 1,
            finalScore: 1000,
            correctCount: 1,
            answeredCount: 2,
            avgResponseMs: 1200,
            maxStreak: 1,
          },
        ],
        answerLogs: [
          {
            orderIndex: 0,
            answerValue: 'optA',
            isCorrect: true,
            pointsAwarded: 1000,
            responseMs: 1200,
          },
          { orderIndex: 1, answerValue: 42, isCorrect: false, pointsAwarded: 0, responseMs: 3000 },
          {
            orderIndex: 2,
            answerValue: ['optC', 'optD'],
            isCorrect: true,
            pointsAwarded: 500,
            responseMs: 2000,
          },
          {
            orderIndex: 3,
            answerValue: ['o2', 'o1'],
            isCorrect: false,
            pointsAwarded: 0,
            responseMs: 2500,
          },
        ],
      });
      const res = await service.sessionPlayerDetail(OWNER, 'q1', 's1', 'pr1');
      expect(res.fullCapture).toBe(true);
      expect(res.answers[2].answer).toBe('Bleu, Vert'); // multi-choix : jointure « , »
      expect(res.answers[3].answer).toBe('Deux → Un'); // ordre : jointure « → »
      expect(res.answers[0]).toMatchObject({
        prompt: 'Capitale ?',
        answer: 'Paris',
        isCorrect: true,
      });
      expect(res.answers[1]).toMatchObject({ answer: '42', isCorrect: false }); // valeur libre brute
    });

    it('sessionPlayerDetail expose fullCapture=false avec une liste de réponses vide', async () => {
      prisma.gameSessionLog.findFirst.mockResolvedValue({
        fullCapture: false,
        quizSnapshot: { questions: [] },
        playerResults: [
          {
            id: 'pr1',
            nickname: 'Bob',
            finalRank: 2,
            finalScore: 0,
            correctCount: 0,
            answeredCount: 0,
            avgResponseMs: null,
            maxStreak: 0,
          },
        ],
        answerLogs: [],
      });
      const res = await service.sessionPlayerDetail(OWNER, 'q1', 's1', 'pr1');
      expect(res.fullCapture).toBe(false);
      expect(res.answers).toEqual([]);
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

  describe('duplicate', () => {
    it('renvoie 404 si non possédé', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.duplicate(OWNER, 'q1')).rejects.toThrow(NotFoundException);
      expect(prisma.quiz.create).not.toHaveBeenCalled();
    });

    it('copie en draft avec questions/options et questionCount', async () => {
      prisma.quiz.findFirst.mockResolvedValue(
        makeQuiz({
          title: 'Orig',
          questions: [
            {
              orderIndex: 0,
              type: QuizStatus.draft, // valeur quelconque, non vérifiée par le mock
              prompt: 'Q',
              mediaId: null,
              timeLimitS: 20,
              pointsMode: 'standard',
              numericValue: null,
              numericTolerance: null,
              options: [
                {
                  orderIndex: 0,
                  text: 'a',
                  mediaId: null,
                  color: 'red',
                  shape: 'triangle',
                  isCorrect: true,
                  correctOrderIndex: null,
                },
              ],
              acceptedAnswers: [],
            },
          ],
        } as unknown as Quiz),
      );
      prisma.quiz.create.mockResolvedValue(makeQuiz());
      await service.duplicate(OWNER, 'q1');
      const data = prisma.quiz.create.mock.calls[0][0].data;
      expect(data.ownerId).toBe(OWNER);
      expect(data.title).toBe('Orig (copie)');
      expect(data.questionCount).toBe(1);
      expect(data.questions.create).toHaveLength(1);
      expect(data.questions.create[0].options.create).toHaveLength(1);
    });
  });
});
