import type { MediaService } from '../media/media.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { HostSeatService } from '../users/host-seat.service';
import { DEMO_RESET_MAX_DEFER_MS } from './demo.config';
import { DemoResetService } from './demo-reset.service';

/** Redis with a few game hashes: `games` maps key → state. */
function makeService(games: Record<string, string>) {
  const deleteMany = jest.fn().mockReturnValue('op');
  const prisma = {
    $transaction: jest.fn().mockResolvedValue([]),
    gameSessionLog: { deleteMany },
    quiz: { deleteMany },
    mediaAsset: { deleteMany },
    mediaBlob: { deleteMany },
    hostSeat: { deleteMany },
    user: { deleteMany },
  } as unknown as PrismaService;
  const redis = {
    scan: jest.fn().mockResolvedValue(['0', Object.keys(games)]),
    hget: jest.fn(async (key: string) => games[key] ?? null),
    flushdb: jest.fn().mockResolvedValue('OK'),
  } as unknown as RedisService;
  const media = {
    removeAllFiles: jest.fn().mockResolvedValue(undefined),
  } as unknown as MediaService;
  const demoUser = { id: 'u1', displayName: 'demo_user' };
  const seat = {
    provision: jest.fn().mockResolvedValue(demoUser),
    claim: jest.fn().mockResolvedValue({}),
  } as unknown as HostSeatService;
  return {
    service: new DemoResetService(prisma, redis, media, seat),
    prisma,
    redis,
    media,
    seat,
    demoUser,
    deleteMany,
  };
}

describe('DemoResetService', () => {
  it('reset: every table, the media files, the live state, then the shared host', async () => {
    const { service, prisma, redis, media, seat, demoUser, deleteMany } = makeService({});
    await service.reset();
    expect(deleteMany).toHaveBeenCalledTimes(6);
    expect(prisma.$transaction).toHaveBeenCalledWith(new Array(6).fill('op'));
    expect(media.removeAllFiles).toHaveBeenCalled();
    expect(redis.flushdb).toHaveBeenCalled();
    expect(seat.provision).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'local:demo-user', displayName: 'demo_user' }),
    );
    expect(seat.claim).toHaveBeenCalledWith(demoUser, null);
  });

  it('hasLiveGames: only game hashes count, and ended ones do not', async () => {
    const { service } = makeService({
      'game:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': 'ENDED',
      'game:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:scores': 'x',
      'game:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:snapshot': 'lobby',
      'room:123456': 'lobby',
    });
    expect(await service.hasLiveGames()).toBe(false);
    expect(
      await makeService({
        'game:cccccccccccccccccccccccccccccccc': 'question',
      }).service.hasLiveGames(),
    ).toBe(true);
  });

  it('tick: defers while a game is live, resets otherwise', async () => {
    const live = makeService({ 'game:cccccccccccccccccccccccccccccccc': 'lobby' });
    expect(await live.service.tick()).toBe(false);
    expect(live.redis.flushdb).not.toHaveBeenCalled();
    const idle = makeService({});
    expect(await idle.service.tick()).toBe(true);
    expect(idle.redis.flushdb).toHaveBeenCalled();
  });

  it('tick: resets regardless once the deferral cap is past', async () => {
    const { service, redis } = makeService({ 'game:cccccccccccccccccccccccccccccccc': 'lobby' });
    expect(await service.tick(Date.now() + DEMO_RESET_MAX_DEFER_MS + 1)).toBe(true);
    expect(redis.flushdb).toHaveBeenCalled();
  });

  it('tick: a failure is logged, not thrown', async () => {
    const { service, redis } = makeService({});
    (redis.flushdb as jest.Mock).mockRejectedValue(new Error('down'));
    await expect(service.tick()).resolves.toBe(false);
  });
});
