import { NotFoundException } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import { PIN_ATTEMPTS_MAX, PIN_ATTEMPTS_WINDOW_S, PinAttempts } from './pin-attempts';

describe('PinAttempts', () => {
  function makeLimiter(failures = 0) {
    const store = new Map<string, number>(failures ? [['pin-attempts:1.2.3.4', failures]] : []);
    // SET … NX: only the first failure of a window writes (and opens it).
    const set = jest.fn<void, unknown[]>((key, value) => {
      if (!store.has(key as string)) store.set(key as string, Number(value));
    });
    const redis = {
      get: jest.fn(async (key: string) => (store.has(key) ? String(store.get(key)) : null)),
      multi: jest.fn(() => {
        const pipe = {
          incr: (key: string) => {
            store.set(key, (store.get(key) ?? 0) + 1);
            return pipe;
          },
          set: (key: string, value: string, ...options: unknown[]) => {
            set(key, value, ...options);
            return pipe;
          },
          exec: async () => [],
        };
        return pipe;
      }),
    } as unknown as RedisService;
    return { limiter: new PinAttempts(redis), store, set };
  }

  it('lets a right PIN through without counting it', async () => {
    const { limiter, store } = makeLimiter();
    await expect(limiter.guard('1.2.3.4', async () => 'ok')).resolves.toBe('ok');
    expect(store.size).toBe(0);
  });

  it('counts a wrong PIN, in a window that the first failure opens', async () => {
    const { limiter, store, set } = makeLimiter();
    await expect(
      limiter.guard('1.2.3.4', async () => {
        throw new NotFoundException('session.not_found');
      }),
    ).rejects.toThrow('session.not_found');
    expect(store.get('pin-attempts:1.2.3.4')).toBe(1);
    expect(set).toHaveBeenCalledWith(
      'pin-attempts:1.2.3.4',
      '0',
      'EX',
      PIN_ATTEMPTS_WINDOW_S,
      'NX',
    );
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
