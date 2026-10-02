import { createHash, randomBytes } from 'node:crypto';

/**
 * The confirmation tokens of the runner (§3.3, step 4): the first call of a
 * destructive operation gets a token bound to exactly that call — operation,
 * parameters, caller — and only the same call, sent again with it within five
 * minutes, runs. Single use.
 */
export interface ConfirmationStore {
  issue(fingerprint: string): Promise<string>;
  /** Whether the token was issued for this fingerprint; spends it either way. */
  redeem(token: string, fingerprint: string): Promise<boolean>;
}

export const CONFIRMATION_TTL_S = 5 * 60;

const digest = (fingerprint: string) => createHash('sha256').update(fingerprint).digest('hex');

interface RedisLike {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

/** Shared by every backend replica. */
export class RedisConfirmationStore implements ConfirmationStore {
  constructor(private readonly redis: RedisLike) {}

  async issue(fingerprint: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(`admin:confirm:${token}`, digest(fingerprint), 'EX', CONFIRMATION_TTL_S);
    return token;
  }

  async redeem(token: string, fingerprint: string): Promise<boolean> {
    if (!/^[\w-]{20,64}$/.test(token)) return false;
    const stored = await this.redis.getdel(`admin:confirm:${token}`);
    return stored === digest(fingerprint);
  }
}

/** For the tests. */
export class MemoryConfirmationStore implements ConfirmationStore {
  private readonly tokens = new Map<string, { digest: string; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async issue(fingerprint: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, {
      digest: digest(fingerprint),
      until: this.now() + CONFIRMATION_TTL_S * 1000,
    });
    return Promise.resolve(token);
  }

  async redeem(token: string, fingerprint: string): Promise<boolean> {
    const entry = this.tokens.get(token);
    this.tokens.delete(token);
    return Promise.resolve(
      !!entry && entry.until > this.now() && entry.digest === digest(fingerprint),
    );
  }
}
