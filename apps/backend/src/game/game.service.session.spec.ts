import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { gameKeys } from './game.keys';
import { GameService } from './game.service';

/**
 * A new room and its first game, then the next game it plays, as Redis holds
 * them: every field, encoded as the engine and the screens read it back. The
 * encoding is shared since audit G5; these hashes must not change with it.
 */
describe('GameService: the hashes of a new session (integration)', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let game: GameService;
  let ownerId: string;
  let quizId: string;
  const pins: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test') || !process.env.REDIS_URL?.endsWith('/1')) {
      throw new Error('Test database and Redis only (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    redis = new RedisService();
    game = new GameService(prisma, redis);
    ownerId = (
      await prisma.user.create({
        data: {
          oidcSubject: `local:session-hash-${Date.now()}`,
          displayName: 'Ada',
          roles: ['host'],
        },
      })
    ).id;
    quizId = (
      await prisma.quiz.create({
        data: {
          ownerId,
          title: 'Harbours',
          language: 'en',
          status: 'ready',
          questionCount: 1,
          questions: {
            create: {
              orderIndex: 0,
              type: 'single_choice',
              prompt: 'Which?',
              options: {
                create: [
                  { orderIndex: 0, color: 'red', shape: 'triangle', text: 'A', isCorrect: true },
                  { orderIndex: 1, color: 'blue', shape: 'circle', text: 'B' },
                ],
              },
            },
          },
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const pin of pins) {
      const keys = await redis.scanKeys(`*${pin}*`);
      if (keys.length) await redis.del(...keys);
    }
    await redis.del(gameKeys.hostGames(ownerId));
    await prisma.quiz.deleteMany({ where: { ownerId } });
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('writes the room and its game in the lobby, field by field', async () => {
    const { pin } = await game.createSession(ownerId, { quizId, fullCapture: true });
    pins.push(pin);
    const room = await redis.hgetall(gameKeys.room(pin));
    expect(room).toEqual({
      roomId: expect.stringMatching(/^[0-9a-f]{32}$/),
      hostUserId: ownerId,
      gameId: expect.stringMatching(/^[0-9a-f]{32}$/),
      fullCapture: '1',
      personalTracking: '1',
      pickOwnName: '1',
      participantAccess: 'account',
      joinLocked: '0',
      motion: '1',
      joinBaseUrl: '',
      openedAt: expect.stringMatching(/^\d{13}$/),
      name: '',
      hostName: 'Ada',
      sounds: expect.stringMatching(/^\{.*\}$/),
    });
    expect(await redis.hgetall(gameKeys.game(room.gameId as never))).toEqual({
      quizId,
      state: 'LOBBY',
      currentIndex: '-1',
      totalQuestions: '1',
      audioTarget: '',
      mediaWaitUntil: '0',
      mediaLeadMs: '',
      title: 'Harbours',
      language: 'en',
      createdAt: expect.stringMatching(/^\d{13}$/),
      questionStartedAt: '0',
      questionEndsAt: '0',
      mode: 'manual',
      paused: '0',
      clockFrozen: '0',
      autoNextAt: '0',
      autoNextMs: '0',
      slideIndex: '-1',
      slideMediaStartAt: '0',
      slidePausedAt: '0',
    });
  });

  it('opens a room with its game sounds off: the host turns on the ones they want', async () => {
    const { pin } = await game.createSession(ownerId, { quizId });
    pins.push(pin);
    const sounds = JSON.parse((await redis.hget(gameKeys.room(pin), 'sounds'))!) as Record<
      string,
      unknown
    >;
    expect(sounds).toMatchObject({ tick: false, ding: false, countdown: false, gong: false });
    expect(sounds.musicUrl).toBeNull();
  });

  it('tells a player what joining asks, in one read of the room and its game', async () => {
    await expect(game.peek('000000')).rejects.toThrow('session.not_found');
    const { pin } = await game.createSession(ownerId, { quizId });
    pins.push(pin);
    const reads = jest.spyOn(redis, 'hgetall');
    expect(await game.peek(pin)).toMatchObject({
      hasSound: false,
      participantAccess: 'account',
      joinLocked: false,
    });
    expect(reads).toHaveBeenCalledTimes(2);
    reads.mockRestore();
    const gameId = (await redis.hget(gameKeys.room(pin), 'gameId')) as never;
    await redis.hset(gameKeys.game(gameId), { state: 'ENDED' });
    await expect(game.peek(pin)).rejects.toThrow('session.ended');
  });

  it('reads a game’s snapshot from Redis once, and sees its form refreshed (roadmap 3.1)', async () => {
    const { pin } = await game.createSession(ownerId, { quizId });
    pins.push(pin);
    const gameId = (await redis.hget(gameKeys.room(pin), 'gameId')) as never;
    const reads = jest.spyOn(redis, 'get');
    const first = await game.getSnapshot(gameId);
    const again = await game.getSnapshot(gameId);
    expect(again).toBe(first);
    expect(reads.mock.calls.filter(([key]) => key === gameKeys.snapshot(gameId))).toHaveLength(1);
    reads.mockRestore();
    // The host edits the explanation while the quiz is played: the next step shows it.
    const question = await prisma.question.findFirstOrThrow({ where: { quizId } });
    await prisma.question.update({
      where: { id: question.id },
      data: { answerExplanation: 'Because.' },
    });
    await game.refreshSnapshot(gameId);
    expect((await game.getSnapshot(gameId))?.questions[0].answerExplanation).toBe('Because.');
    // Another GameService (a restart) reads the same from Redis.
    const restarted = new GameService(prisma, redis);
    expect((await restarted.getSnapshot(gameId))?.questions[0].answerExplanation).toBe('Because.');
  });

  it("opens the next game with the room's pace and audio target", async () => {
    const { pin } = await game.createSession(ownerId, { quizId });
    pins.push(pin);
    const first = (await redis.hget(gameKeys.room(pin), 'gameId')) as never;
    await redis.hset(gameKeys.game(first), { mode: 'auto', audioTarget: 'everyone' });
    const next = await game.openGame(pin, quizId);
    expect(await redis.hgetall(gameKeys.game(next))).toMatchObject({
      state: 'LOBBY',
      currentIndex: '-1',
      mode: 'auto',
      audioTarget: 'everyone',
      paused: '0',
      slideIndex: '-1',
    });
    expect(await redis.hget(gameKeys.room(pin), 'gameId')).toBe(next);
  });
});
