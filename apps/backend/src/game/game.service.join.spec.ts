import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { type GameId, gameKeys } from './game.keys';
import { GameService } from './game.service';

/**
 * RG-15 — le nom affiché d'un participant : celui de son compte tant que l'hôte
 * n'ouvre pas le choix, celui qu'il saisit sinon. Les homonymes sont distingués,
 * pas refusés (deux comptes peuvent porter le même nom).
 */
describe('GameService.joinSession (nom affiché)', () => {
  const PIN = '123456';
  const meta = (
    pickOwnName: boolean,
    extra: Record<string, string> = {},
  ): Record<string, string> => ({
    roomId: 'r1',
    gameId: 'g1',
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
    ...extra,
  });

  function makeService(
    pickOwnName: boolean,
    taken: string[] = [],
    extra: Record<string, string> = {},
  ) {
    const claimed = new Set(taken);
    const redis = {
      hgetall: jest.fn(async (key: string) =>
        // The room and its game, from one flat record (each reads its own fields).
        key === gameKeys.room(PIN) || key === gameKeys.game('g1' as GameId)
          ? meta(pickOwnName, extra)
          : {},
      ),
      exists: jest.fn().mockResolvedValue(0),
      sadd: jest.fn(async (_key: string, member: string) => {
        if (claimed.has(member)) return 0;
        claimed.add(member);
        return 1;
      }),
      // The join itself (player, token, score) runs as one script.
      eval: jest.fn().mockResolvedValue(1),
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

  describe('participant access (RG-15, #57)', () => {
    const authMode = process.env.AUTH_MODE;
    beforeEach(() => {
      process.env.AUTH_MODE = 'oidc';
    });
    afterEach(() => {
      if (authMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = authMode;
    });

    it('refuses a guest under oidc when the game requires accounts', async () => {
      await expect(makeService(false).joinSession(PIN, 'Guest', null)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lets a guest in with the PIN and a nickname in open access', async () => {
      const res = await makeService(true, [], { participantAccess: 'open' }).joinSession(
        PIN,
        'Guest',
        null,
      );
      expect(res.nickname).toBe('Guest');
    });

    it('treats a signed-in participant as a guest in open access', async () => {
      // Even with the name choice closed, no account name is taken: they are all guests.
      const res = await makeService(false, [], { participantAccess: 'open' }).joinSession(
        PIN,
        'Typed',
        user,
      );
      expect(res.nickname).toBe('Typed');
    });

    it('keeps the PIN as the only barrier in local mode', async () => {
      process.env.AUTH_MODE = 'none';
      const res = await makeService(false).joinSession(PIN, 'Guest', null);
      expect(res.nickname).toBe('Guest');
    });

    it('refuses newcomers once the host closed the game', async () => {
      await expect(
        makeService(true, [], { participantAccess: 'open', joinLocked: '1' }).joinSession(
          PIN,
          'Late',
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
