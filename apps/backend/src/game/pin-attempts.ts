import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
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

/** Loopback, private and link-local ranges: where a reverse proxy of ours sits. */
function isPrivate(address: string): boolean {
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

/**
 * The address a request comes from. `X-Forwarded-For` is believed only when the
 * peer is a private address — a reverse proxy in front of the backend — and read
 * from the right, skipping the proxies of the chain: a client connecting from
 * the internet cannot make up one.
 */
export function clientIp(peer: string, forwardedFor: string | string[] | undefined): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  if (!header || !isPrivate(peer)) return peer;
  const chain = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isIP(part.startsWith('::ffff:') ? part.slice(7) : part) !== 0);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isPrivate(chain[i])) return chain[i];
  }
  return chain[0] ?? peer;
}
