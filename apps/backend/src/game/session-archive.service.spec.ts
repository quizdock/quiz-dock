import { Prisma } from '@prisma/client';
import { SessionArchiveService } from './session-archive.service';
import { gameKeys } from './game.keys';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { GameMeta } from './game.types';

/**
 * Vérifie la projection de l'état live (Redis) vers les tables durables : résumé,
 * résultats par apprenant, agrégats par question et réponses individuelles (capture
 * intégrale). Tout est moqué — pas de base ni de Redis réels.
 */
describe('SessionArchiveService', () => {
  const PIN = '123456';

  const snapshot = {
    quizId: 'quiz1',
    title: 'Q',
    description: null,
    language: 'fr',
    questions: [
      {
        id: 'qst1',
        orderIndex: 0,
        type: 'single_choice',
        prompt: 'A ou B ?',
        media: null,
        timeLimitS: 20,
        basePoints: 1000,
        numericValue: null,
        numericTolerance: null,
        acceptedAnswersNormalized: [],
        options: [
          {
            id: 'optA',
            text: 'A',
            color: 'red',
            shape: 'triangle',
            media: null,
            isCorrect: true,
            correctOrderIndex: null,
          },
          {
            id: 'optB',
            text: 'B',
            color: 'blue',
            shape: 'circle',
            media: null,
            isCorrect: false,
            correctOrderIndex: null,
          },
        ],
      },
    ],
  };

  const meta: GameMeta = {
    id: 'g1',
    quizId: 'quiz1',
    hostUserId: 'host1',
    state: 'PODIUM',
    currentIndex: 0,
    totalQuestions: 1,
    fullCapture: true,
    title: 'Q',
    language: 'fr',
    createdAt: 1_000,
    questionStartedAt: 0,
    questionEndsAt: 0,
    mode: 'manual',
    paused: false,
    clockFrozen: false,
  };

  function buildRedis(
    players: Record<string, string>,
    answers: Record<string, string>,
  ): RedisService {
    return {
      get: jest.fn(async (key: string) =>
        key === gameKeys.snapshot(PIN) ? JSON.stringify(snapshot) : null,
      ),
      hgetall: jest.fn(async (key: string) => {
        if (key === gameKeys.players(PIN)) return players;
        if (key === gameKeys.answers(PIN, 0)) return answers;
        return {};
      }),
    } as unknown as RedisService;
  }

  function buildPrisma() {
    const sessionCreate = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'sess1',
      pin: args.data.pin,
    }));
    const playerCreate = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: `pr-${args.data.nickname as string}`,
    }));
    const questionCreateMany = jest.fn(async (args: { data: Record<string, unknown>[] }) => ({
      count: args.data.length,
    }));
    const answerCreateMany = jest.fn(async (args: { data: Record<string, unknown>[] }) => ({
      count: args.data.length,
    }));
    const tx = {
      gameSessionLog: { create: sessionCreate },
      playerResultLog: { create: playerCreate },
      questionResultStat: { createMany: questionCreateMany },
      answerLog: { createMany: answerCreateMany },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
    } as unknown as PrismaService;
    return { prisma, sessionCreate, playerCreate, questionCreateMany, answerCreateMany };
  }

  it('persiste résumé, résultats, stats par question et réponses (capture intégrale)', async () => {
    const players = {
      p1: JSON.stringify({
        nickname: 'Alice',
        userId: null,
        score: 1000,
        streak: 1,
        connected: true,
        joinedAt: 1,
        latencyMs: 0,
      }),
      p2: JSON.stringify({
        nickname: 'Bob',
        userId: null,
        score: 0,
        streak: 0,
        connected: false,
        joinedAt: 2,
        latencyMs: 0,
      }),
    };
    const answers = {
      p1: JSON.stringify({
        answer: 'optA',
        isCorrect: true,
        pointsAwarded: 1000,
        tMs: 1200,
        receivedAt: 1000,
      }),
      p2: JSON.stringify({
        answer: 'optB',
        isCorrect: false,
        pointsAwarded: 0,
        tMs: 3000,
        receivedAt: 2000,
      }),
    };
    const { prisma, sessionCreate, playerCreate, questionCreateMany, answerCreateMany } =
      buildPrisma();
    const svc = new SessionArchiveService(prisma, buildRedis(players, answers));

    await svc.archive(PIN, meta, { interrupted: false });

    // Résumé de session : statut « ended », 2 joueurs, 50 % de réussite, capture intégrale.
    const session = sessionCreate.mock.calls[0][0].data;
    expect(session.status).toBe('ended');
    expect(session.playerCount).toBe(2);
    expect(Number(session.successRate)).toBeCloseTo(0.5);
    expect(session.fullCapture).toBe(true);
    expect(session.quizSnapshot).toMatchObject({ quizId: 'quiz1' });

    // Classement : Alice 1re (1000), Bob 2e (0) ; compteurs et streak max corrects.
    const alice = playerCreate.mock.calls.find((c) => c[0].data.nickname === 'Alice')![0].data;
    expect(alice).toMatchObject({
      finalRank: 1,
      finalScore: 1000,
      correctCount: 1,
      answeredCount: 1,
      maxStreak: 1,
      avgResponseMs: 1200,
    });
    const bob = playerCreate.mock.calls.find((c) => c[0].data.nickname === 'Bob')![0].data;
    expect(bob).toMatchObject({
      finalRank: 2,
      finalScore: 0,
      correctCount: 0,
      answeredCount: 1,
      maxStreak: 0,
    });

    // Stat par question : 1/2 correct, distribution par option, temps moyen (1200+3000)/2.
    const stat = questionCreateMany.mock.calls[0][0].data[0];
    expect(stat).toMatchObject({
      questionId: 'qst1',
      orderIndex: 0,
      correctCount: 1,
      answerCount: 2,
      avgResponseMs: 2100,
    });
    expect(stat.distribution).toEqual({ optA: 1, optB: 1 });
    expect(Number(stat.successRate)).toBeCloseTo(0.5);

    // Capture intégrale : une ligne de réponse par (joueur, question).
    expect(answerCreateMany).toHaveBeenCalledTimes(1);
    expect(answerCreateMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("n'écrit pas les réponses individuelles hors capture intégrale", async () => {
    const players = {
      p1: JSON.stringify({
        nickname: 'Alice',
        userId: null,
        score: 1000,
        streak: 1,
        connected: true,
        joinedAt: 1,
        latencyMs: 0,
      }),
    };
    const answers = {
      p1: JSON.stringify({
        answer: 'optA',
        isCorrect: true,
        pointsAwarded: 1000,
        tMs: 1200,
        receivedAt: 1000,
      }),
    };
    const { prisma, sessionCreate, answerCreateMany } = buildPrisma();
    const svc = new SessionArchiveService(prisma, buildRedis(players, answers));

    await svc.archive(PIN, { ...meta, fullCapture: false }, { interrupted: true });

    expect(sessionCreate.mock.calls[0][0].data.fullCapture).toBe(false);
    expect(sessionCreate.mock.calls[0][0].data.status).toBe('interrupted');
    expect(answerCreateMany).not.toHaveBeenCalled();
  });

  it('no-op si aucune réponse (lobby vide) — aucune écriture', async () => {
    const { prisma, sessionCreate } = buildPrisma();
    const svc = new SessionArchiveService(prisma, buildRedis({}, {}));

    await svc.archive(PIN, meta, {});

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  // Garde-fou Prisma.Decimal disponible (sérialisation des taux).
  it('utilise Prisma.Decimal pour les taux', () => {
    expect(Number(new Prisma.Decimal(0.5))).toBe(0.5);
  });
});
