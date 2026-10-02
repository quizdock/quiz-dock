import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { OverridesService } from '../settings/overrides.service';
import { MemoryAuditRepository } from '../audit/audit.repository';
import { fakeRedis, memoryFlags } from '../testing/fake-redis';
import {
  SETUP_ATTEMPTS_MAX,
  SETUP_TOKEN_TTL_MS,
  SetupLockedError,
  SetupService,
} from './setup.service';

function setup(accounts = 0) {
  const flags = memoryFlags();
  const redis = fakeRedis();
  const audit = new MemoryAuditRepository();
  const prisma = { user: { count: () => Promise.resolve(accounts) } };
  const service = new SetupService(
    flags as unknown as OverridesService,
    redis as unknown as RedisService,
    prisma as unknown as PrismaService,
    audit,
  );
  return { service, flags, redis, audit };
}
const actor = { name: 'test' };

describe('SetupService (§3.8)', () => {
  it('a token opens one wizard session, once; only its hash is kept', async () => {
    const { service, flags } = setup();
    const token = await service.newToken(actor);
    expect(flags.flags.get('token')).not.toContain(token);
    const session = await service.open(token, '10.0.0.9');
    expect(session).toMatch(/^[\w-]{20,}$/);
    expect(await service.session(session!)).toBe(true);
    expect(await service.open(token, '10.0.0.9')).toBeNull();
    expect(await service.session('forged-forged-forged-forged')).toBe(false);
  });

  it('a new token replaces the previous one; an old one expires', async () => {
    const { service } = setup();
    const first = await service.newToken(actor);
    await service.newToken(actor);
    expect(await service.open(first, 'a')).toBeNull();
    const now = Date.now;
    const token = await service.newToken(actor);
    Date.now = () => now() + SETUP_TOKEN_TTL_MS + 1;
    try {
      expect(await service.open(token, 'a')).toBeNull();
    } finally {
      Date.now = now;
    }
  });

  it('stops a flood of wrong tokens, whatever addresses it claims; a new token lifts it', async () => {
    const { service, audit } = setup();
    const token = await service.newToken(actor);
    for (let i = 0; i < SETUP_ATTEMPTS_MAX; i++)
      expect(await service.open('wrong', `10.0.0.${i % 250}`)).toBeNull();
    await expect(service.open(token, '10.0.0.250')).rejects.toBeInstanceOf(SetupLockedError);
    // Every wrong token is in the audit.
    expect(await audit.list({ operation: 'setup.session', limit: 200 })).toHaveLength(
      SETUP_ATTEMPTS_MAX,
    );
    const fresh = await service.newToken(actor);
    expect(await service.open(fresh, '10.0.0.250')).not.toBeNull();
  });

  it('a token raced for opens one session only', async () => {
    const { service } = setup();
    const token = await service.newToken(actor);
    const sessions = await Promise.all([service.open(token, 'a'), service.open(token, 'b')]);
    expect(sessions.filter(Boolean)).toHaveLength(1);
  });

  it('closing the setup ends its sessions: reopening does not bring them back', async () => {
    const { service } = setup();
    const session = (await service.open(await service.newToken(actor), 'a'))!;
    await service.complete(actor);
    await service.reopen(actor);
    expect(await service.session(session)).toBe(false);
  });

  it('a restart in the middle of the setup keeps it open, whatever accounts it created', async () => {
    const { service, flags } = setup(1);
    await service.newToken(actor);
    await service.announce();
    expect(await service.completed()).toBe(false);
    expect(flags.flags.get('token')).toBeDefined();
  });

  it('once completed, closed for good: no token works, no session lasts; reopened from a shell', async () => {
    const { service } = setup();
    const token = await service.newToken(actor);
    const session = await service.open(await service.newToken(actor), 'a');
    await service.complete(actor);
    expect(await service.completed()).toBe(true);
    expect(await service.session(session!)).toBe(false);
    expect(await service.open(token, 'a')).toBeNull();
    const again = await service.reopen(actor);
    expect(await service.completed()).toBe(false);
    expect(await service.open(again, 'a')).not.toBeNull();
  });

  it('a phone that reaches the test page marks its address as tested', async () => {
    const { service } = setup();
    const { id } = await service.startPhoneTest('http://192.168.1.10:18080', true);
    expect(await service.phoneTest(id)).toEqual({
      address: 'http://192.168.1.10:18080',
      remember: true,
      reached: null,
    });
    expect(await service.reached(id, 'Mozilla/5.0 (iPhone)')).toBe(true);
    expect((await service.phoneTest(id))?.reached?.agent).toBe('Mozilla/5.0 (iPhone)');
    expect(await service.testedAddresses()).toEqual(['http://192.168.1.10:18080']);
    expect(await service.reached('unknown-unknown', 'x')).toBe(false);
  });

  it('a fresh instance announces a token; one already in use is set up', async () => {
    const fresh = setup(0);
    await fresh.service.announce();
    expect(fresh.flags.flags.has('token')).toBe(true);
    expect(await fresh.service.completed()).toBe(false);
    const used = setup(3);
    await used.service.announce();
    expect(await used.service.completed()).toBe(true);
    expect(used.flags.flags.has('token')).toBe(false);
  });
});
