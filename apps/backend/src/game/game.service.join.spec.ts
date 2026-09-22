import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { gameKeys } from './game.keys';
import { GameService } from './game.service';

/**
 * RG-15 — le nom affiché d'un participant : celui de son compte tant que l'hôte
 * n'ouvre pas le choix, celui qu'il saisit sinon. Les homonymes sont distingués,
 * pas refusés (deux comptes peuvent porter le même nom).
 */
describe('GameService.joinSession (nom affiché)', () => {
  const PIN = '123456';
  const meta = (pickOwnName: boolean): Record<string, string> => ({
    id: 'g1',
    quizId: 'q1',
    hostUserId: 'h1',
    state: 'LOBBY',
    currentIndex: '-1',
    totalQuestions: '1',
    fullCapture: '0',
    personalTracking: '1',
    pickOwnName: pickOwnName ? '1' : '0',
    title: 'Q',
    language: 'fr',
    createdAt: '1000',
    questionStartedAt: '0',
    questionEndsAt: '0',
    mode: 'manual',
    paused: '0',
    clockFrozen: '0',
  });

  function makeService(pickOwnName: boolean, taken: string[] = []) {
    const claimed = new Set(taken);
    const redis = {
      hgetall: jest.fn(async (key: string) =>
        key === gameKeys.game(PIN) ? meta(pickOwnName) : {},
      ),
      exists: jest.fn().mockResolvedValue(0),
      sadd: jest.fn(async (_key: string, member: string) => {
        if (claimed.has(member)) return 0;
        claimed.add(member);
        return 1;
      }),
      multi: jest.fn(() => {
        const pipe = {
          hset: () => pipe,
          zadd: () => pipe,
          set: () => pipe,
          expire: () => pipe,
          exec: async () => [],
        };
        return pipe;
      }),
    } as unknown as RedisService;
    return new GameService({} as PrismaService, redis);
  }

  const user = { id: 'u1', displayName: 'Alice Account' };

  it('takes the account name when the host did not open the choice', async () => {
    const res = await makeService(false).joinSession(PIN, 'Whatever', user);
    expect(res.nickname).toBe('Alice Account');
  });

  it('keeps the typed nickname when participants pick their own name', async () => {
    const res = await makeService(true).joinSession(PIN, 'Whatever', user);
    expect(res.nickname).toBe('Whatever');
  });

  it('keeps the typed nickname for a guest, whatever the option', async () => {
    const res = await makeService(false).joinSession(PIN, 'Whatever', null);
    expect(res.nickname).toBe('Whatever');
  });

  it('discriminates homonyms instead of refusing them', async () => {
    const res = await makeService(false, ['alice account']).joinSession(PIN, 'Whatever', user);
    expect(res.nickname).toBe('Alice Account (2)');
  });

  it('still refuses a typed nickname already taken', async () => {
    await expect(
      makeService(true, ['whatever']).joinSession(PIN, 'Whatever', user),
    ).rejects.toThrow(ConflictException);
  });
});
