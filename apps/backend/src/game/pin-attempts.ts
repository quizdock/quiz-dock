import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { toErrorResponse } from '../common/error-response';
import { RedisService } from '../redis/redis.service';

/**
 * Wrong PINs one address may try in a window before it has to wait. Generous on
 * purpose: a whole room plays from one public address (a school, a company), and
 * a few typos must never lock it out. An enumeration of the million PINs, at
 * that pace, takes weeks.
 */
export const PIN_ATTEMPTS_MAX = 30;
export const PIN_ATTEMPTS_WINDOW_S = 60;

const key = (ip: string) => `pin-attempts:${ip}`;

/**
 * Limits the wrong PINs an address may try (#57): every event that takes a PIN
 * without authentication (`player:peek`, `player:join`, `spectator:join`) would
 * otherwise tell whether a game exists. Only failures count; a blocked address
 * waits for the end of the window, right PIN or not.
 */
@Injectable()
export class PinAttempts {
  constructor(private readonly redis: RedisService) {}

  async guard<T>(ip: string, attempt: () => Promise<T>): Promise<T> {
    const failures = Number((await this.redis.get(key(ip))) ?? 0);
    if (failures >= PIN_ATTEMPTS_MAX) {
      throw new HttpException('pin.too_many_attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      return await attempt();
    } catch (err) {
      if (toErrorResponse(err).body.code === 'session.not_found') {
        // The first failure opens the window (SET … NX with its expiry, any Redis
        // version); INCR keeps that expiry, so a key never outlives its window.
        await this.redis
          .multi()
          .set(key(ip), '0', 'EX', PIN_ATTEMPTS_WINDOW_S, 'NX')
          .incr(key(ip))
          .exec();
      }
      throw err;
    }
  }
}
