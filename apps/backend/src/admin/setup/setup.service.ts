import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { OverridesService } from '../settings/overrides.service';

/** How long a setup token stays valid, unused (§3.10). */
export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60_000;
/** How long the wizard's session lasts once the token was given. */
export const SETUP_SESSION_TTL_S = 2 * 60 * 60;
/** Wrong tokens one address may try before it waits. */
export const SETUP_ATTEMPTS_MAX = 10;
export const SETUP_ATTEMPTS_WINDOW_S = 15 * 60;
/** How long a phone test waits for the phone. */
export const PHONE_TEST_TTL_S = 10 * 60;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PhoneTest {
  address: string;
  reached: { at: string; agent: string } | null;
}

/**
 * The first start of an instance (§3.8): the setup token — generated while the
 * setup is open, shown in the logs and by `qd setup.token`, single use, valid a
 * day —, the wizard's session it opens, the flag that closes the setup for good,
 * and the phone test of the invitation addresses.
 */
@Injectable()
export class SetupService {
  private readonly log = new Logger('Setup');

  constructor(
    private readonly overrides: OverridesService,
    private readonly redis: RedisService,
  ) {}

  async completed(): Promise<boolean> {
    return (await this.overrides.flag('completed')) !== null;
  }

  /** A new token (the previous one no longer works): the hash kept, the token shown once. */
  async newToken(actor: { name: string; userId?: string }): Promise<string> {
    const token = randomBytes(18).toString('base64url');
    const until = Date.now() + SETUP_TOKEN_TTL_MS;
    await this.overrides.setFlag('token', JSON.stringify({ hash: hash(token), until }), actor);
    return token;
  }

  /** At the application's start: while the setup is open, a token in the logs. */
  async announce(): Promise<void> {
    if (await this.completed()) return;
    const token = await this.newToken({ name: 'start' });
    this.log.warn(
      `This instance is not set up yet. Open it in a browser and give the setup token ${token} ` +
        '(valid 24 h, single use; `qd setup.token` gives a new one, `qd setup.complete` skips the wizard).',
    );
  }

  /** Exchanges the token for a wizard session; the token is spent. Attempts limited per address. */
  async open(token: string, address: string): Promise<string | null> {
    const attempts = `setup-attempts:${address}`;
    if (Number((await this.redis.get(attempts)) ?? 0) >= SETUP_ATTEMPTS_MAX) {
      throw new SetupLockedError();
    }
    const stored = await this.overrides.flag('token');
    const { hash: expected, until } = stored
      ? (JSON.parse(stored) as { hash: string; until: number })
      : { hash: '', until: 0 };
    const given = Buffer.from(hash(token));
    const ok =
      !!expected &&
      until > Date.now() &&
      !(await this.completed()) &&
      given.length === expected.length &&
      timingSafeEqual(given, Buffer.from(expected));
    if (!ok) {
      await this.redis
        .multi()
        .set(attempts, '0', 'EX', SETUP_ATTEMPTS_WINDOW_S, 'NX')
        .incr(attempts)
        .exec();
      return null;
    }
    await this.overrides.setFlag('token', null, { name: 'setup' });
    const session = randomBytes(24).toString('base64url');
    await this.redis.set(`setup-session:${session}`, '1', 'EX', SETUP_SESSION_TTL_S);
    return session;
  }

  /** Whether a wizard session is valid (and the setup still open). */
  async session(session: string | undefined): Promise<boolean> {
    if (!session || !/^[\w-]{20,64}$/.test(session)) return false;
    return (await this.redis.get(`setup-session:${session}`)) !== null && !(await this.completed());
  }

  async complete(actor: { name: string; userId?: string }): Promise<void> {
    await this.overrides.setFlag('completed', new Date().toISOString(), actor);
    await this.overrides.setFlag('token', null, actor);
  }

  async reopen(actor: { name: string; userId?: string }): Promise<string> {
    await this.overrides.setFlag('completed', null, actor);
    return this.newToken(actor);
  }

  // ── Phone test (§3.8, step 3) ──────────────────────────────────────────────

  async startPhoneTest(address: string): Promise<{ id: string }> {
    const id = randomBytes(12).toString('base64url');
    await this.redis.set(
      `phone-test:${id}`,
      JSON.stringify({ address, reached: null } satisfies PhoneTest),
      'EX',
      PHONE_TEST_TTL_S,
    );
    return { id };
  }

  async phoneTest(id: string): Promise<PhoneTest | null> {
    if (!/^[\w-]{10,40}$/.test(id)) return null;
    const raw = await this.redis.get(`phone-test:${id}`);
    return raw ? (JSON.parse(raw) as PhoneTest) : null;
  }

  /** A phone reached the test page: noted, and its address remembered as tested. */
  async reached(id: string, agent: string): Promise<boolean> {
    const test = await this.phoneTest(id);
    if (!test) return false;
    test.reached = { at: new Date().toISOString(), agent: agent.slice(0, 200) };
    await this.redis.set(`phone-test:${id}`, JSON.stringify(test), 'EX', PHONE_TEST_TTL_S);
    const tested = new Set(await this.testedAddresses());
    tested.add(test.address);
    await this.overrides.setFlag('tested-addresses', JSON.stringify([...tested].slice(-20)), {
      name: 'phone test',
    });
    return true;
  }

  /** The invitation addresses a phone reached (to offer them first). */
  testedAddresses(): Promise<string[]> {
    return readTestedAddresses(this.overrides);
  }
}

/** The invitation addresses a phone reached, from the instance's flags. */
export async function readTestedAddresses(flags: {
  flag(key: string): Promise<string | null>;
}): Promise<string[]> {
  const raw = await flags.flag('tested-addresses');
  try {
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Too many wrong setup tokens from one address. */
export class SetupLockedError extends Error {
  constructor() {
    super('setup.too_many_attempts');
  }
}
