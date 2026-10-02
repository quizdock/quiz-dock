import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

/**
 * Client Redis (ioredis) exposé en injection NestJS — état live des parties
 * (SPECIFICATIONS-DONNEES §4). Connexion runtime via `REDIS_URL`.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);

  constructor() {
    super(settings.get(SETTINGS.REDIS_URL), {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.on('error', (err) => this.log.error(`Redis: ${err.message}`));
  }

  /**
   * Every key matching `pattern`, read a batch at a time (SCAN): unlike KEYS, it
   * never holds Redis — and every game's commands — while it walks a large base.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const found = new Set<string>(); // SCAN may return a key twice
    let cursor = '0';
    do {
      const [next, keys] = await this.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      for (const key of keys) found.add(key);
      cursor = next;
    } while (cursor !== '0');
    return [...found];
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
