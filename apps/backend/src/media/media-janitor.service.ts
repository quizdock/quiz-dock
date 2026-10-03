import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { MediaService } from './media.service';

/** How often the media directory is cleaned. */
export const MEDIA_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** One scheduled pass an hour across backend instances sharing the media volume. */
export const MEDIA_SWEEP_LOCK = 'media:sweep-lock';
/** Held while a pass runs, scheduled or asked for: never two at once. */
export const MEDIA_SWEEP_RUNNING = 'media:sweep-running';
/** The last pass, for the administration page. */
export const MEDIA_SWEEP_LAST = 'media:sweep-last';
const RUNNING_TTL_MS = 30 * 60 * 1000;

export interface SweepResult {
  adopted: number;
  media: number;
  blobs: number;
  files: number;
}

export interface LastSweep extends SweepResult {
  /** ISO time the pass ended. */
  at: string;
}

/**
 * The media housekeeping job: every hour, and once at start-up for whatever an
 * earlier run left behind, it moves the files of older media under their blob
 * name, deletes the media nothing uses any more, then the blobs no media holds
 * and the files on disk nothing points to. A save still releases the media it
 * replaced right away (`MediaService.releaseUnused`); this job catches the rest.
 */
@Injectable()
export class MediaJanitor implements OnModuleDestroy {
  private readonly log = new Logger(MediaJanitor.name);
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<unknown> | null = null;

  constructor(
    private readonly media: MediaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Started by the server only (`main.ts`): a `qd` command, which loads this
   * module too, must not take the hour's pass and then cut it short.
   */
  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), MEDIA_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  /** At shutdown, a pass under way is given a few seconds to end and free its lock. */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.current) {
      await Promise.race([this.current, new Promise((r) => setTimeout(r, 5_000).unref())]);
    }
  }

  /** Moving older files is a step of its own: it never keeps the sweeps from running. */
  private async adoptLegacyFiles(): Promise<number> {
    try {
      const { adopted, failed } = await this.media.adoptLegacyFiles();
      if (failed > 0) this.log.warn(`Media sweep: ${failed} older files could not be moved yet`);
      return adopted;
    } catch (err) {
      this.log.warn(`Moving older media files skipped: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * One pass, unless another instance had this hour's or one is running. Asked
   * for by an administrator (`now`), it skips the hourly turn but still waits
   * for no other pass to run. Never throws.
   */
  async run(now = false): Promise<SweepResult | null> {
    const pass = this.pass(now);
    this.current = pass;
    try {
      return await pass;
    } finally {
      if (this.current === pass) this.current = null;
    }
  }

  private async pass(now: boolean): Promise<SweepResult | null> {
    let running = false;
    try {
      if (!now) {
        const turn = await this.redis.set(
          MEDIA_SWEEP_LOCK,
          '1',
          'PX',
          MEDIA_SWEEP_INTERVAL_MS - 60_000,
          'NX',
        );
        if (!turn) return null;
      }
      running =
        (await this.redis.set(MEDIA_SWEEP_RUNNING, '1', 'PX', RUNNING_TTL_MS, 'NX')) !== null;
      if (!running) return null;
      const adopted = await this.adoptLegacyFiles();
      await this.media
        .fillDimensions()
        .catch((err: Error) => this.log.warn(`Reading media sizes skipped: ${err.message}`));
      const media = await this.media.sweepOrphans();
      const blobs = await this.media.sweepUnusedBlobs();
      const files = await this.media.purgeStrayFiles();
      if (adopted > 0) this.log.log(`Media sweep: ${adopted} older files moved to shared storage`);
      if (media + blobs + files > 0) {
        this.log.log(
          `Media sweep: ${media} unused media, ${blobs} unused files, ${files} stray files deleted`,
        );
      }
      const result = { adopted, media, blobs, files };
      const last: LastSweep = { ...result, at: new Date().toISOString() };
      await this.redis.set(MEDIA_SWEEP_LAST, JSON.stringify(last));
      return result;
    } catch (err) {
      this.log.warn(`Media sweep skipped: ${(err as Error).message}`);
      return null;
    } finally {
      if (running) await this.redis.del(MEDIA_SWEEP_RUNNING).catch(() => undefined);
    }
  }

  /** The last pass that ran, if any. */
  async last(): Promise<LastSweep | null> {
    const raw = await this.redis.get(MEDIA_SWEEP_LAST).catch(() => null);
    return raw ? (JSON.parse(raw) as LastSweep) : null;
  }
}
