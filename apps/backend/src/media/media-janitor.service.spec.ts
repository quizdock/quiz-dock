import type { RedisService } from '../redis/redis.service';
import {
  MEDIA_SWEEP_LAST,
  MEDIA_SWEEP_LOCK,
  MEDIA_SWEEP_RUNNING,
  MediaJanitor,
} from './media-janitor.service';
import type { MediaService } from './media.service';

describe('MediaJanitor', () => {
  const media = {
    adoptLegacyFiles: jest.fn(async () => ({ adopted: 1, failed: 0 })),
    sweepOrphans: jest.fn(async () => 2),
    sweepUnusedBlobs: jest.fn(async () => 4),
    purgeStrayFiles: jest.fn(async () => 3),
  };
  const redis = {
    set: jest.fn(async () => 'OK' as string | null),
    del: jest.fn(async () => 1),
    get: jest.fn(async () => null as string | null),
  };
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

  it('still sweeps when older files cannot be moved', async () => {
    media.adoptLegacyFiles.mockRejectedValueOnce(new Error('EACCES'));
    await expect(janitor.run()).resolves.toEqual({ adopted: 0, media: 2, blobs: 4, files: 3 });
    expect(media.purgeStrayFiles).toHaveBeenCalled();
  });

  it('runs at once when an administrator asks, records the pass, frees the running lock', async () => {
    await expect(janitor.run(true)).resolves.toEqual({ adopted: 1, media: 2, blobs: 4, files: 3 });
    expect(redis.set).not.toHaveBeenCalledWith(
      MEDIA_SWEEP_LOCK,
      '1',
      'PX',
      expect.any(Number),
      'NX',
    );
    expect(redis.set).toHaveBeenCalledWith(MEDIA_SWEEP_LAST, expect.stringContaining('"media":2'));
    expect(redis.del).toHaveBeenCalledWith(MEDIA_SWEEP_RUNNING);
  });

  it('never runs two passes at once', async () => {
    redis.set.mockResolvedValueOnce(null); // the running lock is taken
    await expect(janitor.run(true)).resolves.toBeNull();
    expect(media.sweepOrphans).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
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
