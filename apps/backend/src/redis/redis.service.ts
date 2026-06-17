import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Client Redis (ioredis) exposé en injection NestJS — état live des parties
 * (SPECIFICATIONS-DONNEES §4). Connexion runtime via `REDIS_URL`.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);

  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:16379', {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.on('error', (err) => this.log.error(`Redis: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
