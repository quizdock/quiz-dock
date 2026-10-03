import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { OverridesService } from '../settings/overrides.service';

/** How long a setup token stays valid, unused (§3.10). */
export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60_000;
/** How long the wizard's session lasts once the token was given. */
export const SETUP_SESSION_TTL_S = 2 * 60 * 60;
/**
 * Wrong tokens tried before the wizard waits: the token's 144 bits need no lock,
 * this only stops a flood. Per address first, so a stranger cannot keep the
 * operator out; from every address together far beyond. A new token (`qd
 * setup.token`) lifts both.
 */
export const SETUP_ATTEMPTS_PER_ADDRESS = 20;
export const SETUP_ATTEMPTS_MAX = 1000;
/** Wrong tokens audited per address and window: enough to see, not to fill the disk. */
const AUDITED_PER_ADDRESS = 5;
export const SETUP_ATTEMPTS_WINDOW_S = 15 * 60;
/** How long a phone test waits for the phone. */
export const PHONE_TEST_TTL_S = 10 * 60;

const ATTEMPTS = 'setup-attempts';
const SESSION = 'setup-session:';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PhoneTest {
  address: string;
  /** Started from the wizard: the address is remembered once a phone reached it. */
  remember: boolean;
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
    private readonly prisma: PrismaService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async completed(): Promise<boolean> {
    return (await this.overrides.flag('completed')) !== null;
  }

  /** A new token (the previous one no longer works): the hash kept, the token shown once. */
  async newToken(actor: { name: string; userId?: string }): Promise<string> {
    const token = randomBytes(18).toString('base64url');
    const until = Date.now() + SETUP_TOKEN_TTL_MS;
    await this.overrides.setFlag('token', JSON.stringify({ hash: hash(token), until }), actor);
    // The setup has begun: a restart in the middle of it keeps it open (see announce).
    await this.overrides.setFlag('started', new Date().toISOString(), actor);
    const counted = await this.redis.scanKeys(`${ATTEMPTS}*`);
    if (counted.length) await this.redis.del(...counted);
    return token;
  }

  /**
   * At the application's start: while the setup is open, a token in the logs.
   * An instance already in use (accounts other than the application's own)
   * predates the wizard: it is set up.
   */
  async announce(): Promise<void> {
    if (await this.completed()) return;
    // An instance that never began a setup and has accounts predates the wizard.
    // One that began it keeps it, whatever accounts the wizard itself created.
    const accounts = (await this.overrides.flag('started'))
      ? 0
      : await this.prisma.user.count({
          where: { NOT: { oidcSubject: { startsWith: 'system:' } } },
        });
    if (accounts > 0) {
      await this.complete({ name: 'already in use' });
      this.log.log('Instance already in use: the setup wizard is not offered.');
      return;
    }
    const token = await this.newToken({ name: 'start' });
    this.log.warn(
      `This instance is not set up yet. Open it in a browser and give the setup token ${token} ` +
        '(valid 24 h, single use; `qd setup.token` gives a new one, `qd setup.complete` skips the wizard).',
    );
  }

  /**
   * Exchanges the token for a wizard session; the token is spent — by one
   * request only, however many race for it. A wrong token is audited.
   */
  async open(token: string, address: string): Promise<string | null> {
    const fromHere = `${ATTEMPTS}:${hash(address)}`;
    const [all, here] = await Promise.all([this.redis.get(ATTEMPTS), this.redis.get(fromHere)]);
    if (Number(all ?? 0) >= SETUP_ATTEMPTS_MAX || Number(here ?? 0) >= SETUP_ATTEMPTS_PER_ADDRESS) {
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
      const counts = await this.redis
        .multi()
        .set(ATTEMPTS, '0', 'EX', SETUP_ATTEMPTS_WINDOW_S, 'NX')
        .incr(ATTEMPTS)
        .set(fromHere, '0', 'EX', SETUP_ATTEMPTS_WINDOW_S, 'NX')
        .incr(fromHere)
        .exec();
      const tried = Number(counts?.[3]?.[1] ?? 0);
      if (tried > AUDITED_PER_ADDRESS) return null;
      await this.audit
        .append({
          via: 'api',
          actor: 'setup',
          userId: null,
          address,
          operation: 'setup.session',
          params: {},
          outcome: 'refused',
          code: 'forbidden',
          durationMs: 0,
        })
        .catch((err: Error) => this.log.error(`A wrong setup token not audited: ${err.message}`));
      return null;
    }
    if (!stored || !(await this.overrides.takeFlag('token', stored))) return null;
    const session = randomBytes(24).toString('base64url');
    await this.redis.set(`${SESSION}${session}`, '1', 'EX', SETUP_SESSION_TTL_S);
    return session;
  }

  /** Whether a wizard session is valid (and the setup still open). */
  async session(session: string | undefined): Promise<boolean> {
    if (!session || !/^[\w-]{20,64}$/.test(session)) return false;
    return (await this.redis.get(`${SESSION}${session}`)) !== null && !(await this.completed());
  }

  async complete(actor: { name: string; userId?: string }): Promise<void> {
    await this.overrides.setFlag('completed', new Date().toISOString(), actor);
    await this.overrides.setFlag('token', null, actor);
    await this.endSessions();
  }

  /** Reopened: a new token, and none of the sessions opened before works again. */
  async reopen(actor: { name: string; userId?: string }): Promise<string> {
    await this.endSessions();
    await this.overrides.setFlag('completed', null, actor);
    return this.newToken(actor);
  }

  private async endSessions(): Promise<void> {
    const keys = await this.redis.scanKeys(`${SESSION}*`);
    if (keys.length) await this.redis.del(...keys);
  }

  // ── Phone test (§3.8, step 3) ──────────────────────────────────────────────

  /**
   * `remember`: from the wizard only — an address a phone reached is then offered
   * first. From the administration, a test checks and leaves nothing behind.
   */
  async startPhoneTest(address: string, remember: boolean): Promise<{ id: string }> {
    const id = randomBytes(12).toString('base64url');
    await this.redis.set(
      `phone-test:${id}`,
      JSON.stringify({ address, remember, reached: null } satisfies PhoneTest),
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
    // Its expiry stays: a page reloaded on the phone does not keep a test alive.
    await this.redis.set(`phone-test:${id}`, JSON.stringify(test), 'KEEPTTL');
    if (!test.remember) return true;
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

/** Too many wrong setup tokens, all addresses together. */
export class SetupLockedError extends Error {
  constructor() {
    super('setup.too_many_attempts');
  }
}
