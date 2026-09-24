import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { MediaService } from './media.service';

/** How often the media directory is cleaned. */
export const MEDIA_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** One run at a time across backend instances sharing the media volume. */
export const MEDIA_SWEEP_LOCK = 'media:sweep-lock';

/**
 * The media housekeeping job: every hour, and once at start-up for whatever an
 * earlier run left behind, it deletes the media nothing uses any more, then the
 * files on disk no media row points to. A save still releases the media it
 * replaced right away (`MediaService.releaseUnused`); this job catches the rest.
 */
@Injectable()
export class MediaJanitor implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MediaJanitor.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly media: MediaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), MEDIA_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass, unless another instance holds the lock. Never throws. */
  async run(): Promise<{ media: number; files: number } | null> {
    try {
      const won = await this.redis.set(
        MEDIA_SWEEP_LOCK,
        '1',
        'PX',
        MEDIA_SWEEP_INTERVAL_MS - 60_000,
        'NX',
      );
      if (!won) return null;
      const media = await this.media.sweepOrphans();
      const files = await this.media.purgeStrayFiles();
      if (media + files > 0) {
        this.log.log(`Media sweep: ${media} unused media, ${files} stray files deleted`);
      }
      return { media, files };
    } catch (err) {
      this.log.warn(`Media sweep skipped: ${(err as Error).message}`);
      return null;
    }
  }
}
