import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/** Operations one account may run in a window through the API (§3.10). */
export const ADMIN_CALLS_MAX = 120;
export const ADMIN_CALLS_WINDOW_S = 60;
/** Wrong administration tokens one address may give (local mode) before it waits. */
export const ADMIN_TOKEN_FAILURES_MAX = 10;
export const ADMIN_TOKEN_WINDOW_S = 15 * 60;

/**
 * Limits on the admin API (§3.10): a steady pace per account, and few wrong
 * `ADMIN_TOKEN`s per address — the token is the local mode's only lock.
 */
@Injectable()
export class AdminRateLimit {
  constructor(private readonly redis: RedisService) {}

  /** Counts a call; refuses past the pace. */
  async call(userId: string): Promise<void> {
    if ((await this.bump(`admin-calls:${userId}`, ADMIN_CALLS_WINDOW_S)) > ADMIN_CALLS_MAX) {
      throw new HttpException({ code: 'admin.too_many_requests' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Refuses an address that gave too many wrong tokens. */
  async tokenAllowed(address: string): Promise<void> {
    const failures = Number((await this.redis.get(`admin-token:${address}`)) ?? 0);
    if (failures >= ADMIN_TOKEN_FAILURES_MAX) {
      throw new HttpException({ code: 'admin.too_many_requests' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async tokenFailed(address: string): Promise<void> {
    await this.bump(`admin-token:${address}`, ADMIN_TOKEN_WINDOW_S);
  }

  /** INCR within a window opened by the first hit (SET … NX with its expiry). */
  private async bump(key: string, windowS: number): Promise<number> {
    const replies = await this.redis.multi().set(key, '0', 'EX', windowS, 'NX').incr(key).exec();
    return Number(replies?.[1]?.[1] ?? 0);
  }
}
