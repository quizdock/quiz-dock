import type { RedisService } from '../redis/redis.service';
import { MEDIA_SWEEP_LOCK, MediaJanitor } from './media-janitor.service';
import type { MediaService } from './media.service';

describe('MediaJanitor', () => {
  const media = {
    sweepOrphans: jest.fn(async () => 2),
    purgeStrayFiles: jest.fn(async () => 3),
  };
  const redis = { set: jest.fn(async () => 'OK' as string | null) };
  const janitor = new MediaJanitor(
    media as unknown as MediaService,
    redis as unknown as RedisService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('sweeps unused media, then stray files, under the lock', async () => {
    await expect(janitor.run()).resolves.toEqual({ media: 2, files: 3 });
    expect(redis.set).toHaveBeenCalledWith(MEDIA_SWEEP_LOCK, '1', 'PX', expect.any(Number), 'NX');
    expect(media.sweepOrphans).toHaveBeenCalled();
    expect(media.purgeStrayFiles).toHaveBeenCalled();
  });

  it('leaves the pass to the instance holding the lock', async () => {
    redis.set.mockResolvedValueOnce(null);
    await expect(janitor.run()).resolves.toBeNull();
    expect(media.sweepOrphans).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    media.sweepOrphans.mockRejectedValueOnce(new Error('db down'));
    await expect(janitor.run()).resolves.toBeNull();
  });
});
