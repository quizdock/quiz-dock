import { NotFoundException } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import { PIN_ATTEMPTS_MAX, PIN_ATTEMPTS_WINDOW_S, PinAttempts, clientIp } from './pin-attempts';

describe('PinAttempts', () => {
  function makeLimiter(failures = 0) {
    const store = new Map<string, number>(failures ? [['pin-attempts:1.2.3.4', failures]] : []);
    const expire = jest.fn();
    const redis = {
      get: jest.fn(async (key: string) => (store.has(key) ? String(store.get(key)) : null)),
      multi: jest.fn(() => {
        const pipe = {
          incr: (key: string) => {
            store.set(key, (store.get(key) ?? 0) + 1);
            return pipe;
          },
          expire: (...args: unknown[]) => {
            expire(...args);
            return pipe;
          },
          exec: async () => [],
        };
        return pipe;
      }),
    } as unknown as RedisService;
    return { limiter: new PinAttempts(redis), store, expire };
  }

  it('lets a right PIN through without counting it', async () => {
    const { limiter, store } = makeLimiter();
    await expect(limiter.guard('1.2.3.4', async () => 'ok')).resolves.toBe('ok');
    expect(store.size).toBe(0);
  });

  it('counts a wrong PIN, in a window that the first failure opens', async () => {
    const { limiter, store, expire } = makeLimiter();
    await expect(
      limiter.guard('1.2.3.4', async () => {
        throw new NotFoundException('session.not_found');
      }),
    ).rejects.toThrow('session.not_found');
    expect(store.get('pin-attempts:1.2.3.4')).toBe(1);
    expect(expire).toHaveBeenCalledWith('pin-attempts:1.2.3.4', PIN_ATTEMPTS_WINDOW_S, 'NX');
  });

  it('does not count other refusals (a game over, a nickname taken)', async () => {
    const { limiter, store } = makeLimiter();
    await expect(
      limiter.guard('1.2.3.4', async () => {
        throw new NotFoundException('session.ended');
      }),
    ).rejects.toThrow();
    expect(store.size).toBe(0);
  });

  it('refuses an address that reached the ceiling, before looking at the PIN', async () => {
    const { limiter } = makeLimiter(PIN_ATTEMPTS_MAX);
    const attempt = jest.fn();
    await expect(limiter.guard('1.2.3.4', attempt)).rejects.toThrow('pin.too_many_attempts');
    expect(attempt).not.toHaveBeenCalled();
  });
});

describe('clientIp', () => {
  it('takes the peer when it connects directly, whatever header it sends', () => {
    expect(clientIp('203.0.113.7', '198.51.100.1')).toBe('203.0.113.7');
  });

  it('believes the header behind a private proxy, read from the right', () => {
    expect(clientIp('::ffff:172.18.0.3', '198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('skips the proxies of the chain', () => {
    expect(clientIp('127.0.0.1', '203.0.113.7, 10.0.0.2')).toBe('203.0.113.7');
  });

  it('keeps the peer when the header is missing or makes no sense', () => {
    expect(clientIp('10.0.0.2', undefined)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', 'garbage')).toBe('10.0.0.2');
  });
});
