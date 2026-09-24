import type { RedisService } from '../redis/redis.service';
import { MEDIA_SWEEP_LOCK, MediaJanitor } from './media-janitor.service';
import type { MediaService } from './media.service';

describe('MediaJanitor', () => {
  const media = {
    adoptLegacyFiles: jest.fn(async () => 1),
    sweepOrphans: jest.fn(async () => 2),
    sweepUnusedBlobs: jest.fn(async () => 4),
    purgeStrayFiles: jest.fn(async () => 3),
  };
  const redis = { set: jest.fn(async () => 'OK' as string | null) };
  const janitor = new MediaJanitor(
    media as unknown as MediaService,
    redis as unknown as RedisService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('adopts older files, sweeps unused media, blobs and stray files, under the lock', async () => {
    await expect(janitor.run()).resolves.toEqual({ adopted: 1, media: 2, blobs: 4, files: 3 });
    expect(redis.set).toHaveBeenCalledWith(MEDIA_SWEEP_LOCK, '1', 'PX', expect.any(Number), 'NX');
    expect(media.sweepOrphans).toHaveBeenCalled();
    expect(media.sweepUnusedBlobs).toHaveBeenCalled();
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
