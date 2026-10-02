import type { RedisService } from '../../redis/redis.service';
import type { OverridesService } from '../settings/overrides.service';
import { fakeRedis, memoryFlags } from '../testing/fake-redis';
import {
  SETUP_ATTEMPTS_MAX,
  SETUP_TOKEN_TTL_MS,
  SetupLockedError,
  SetupService,
} from './setup.service';

function setup() {
  const flags = memoryFlags();
  const redis = fakeRedis();
  const service = new SetupService(
    flags as unknown as OverridesService,
    redis as unknown as RedisService,
  );
  return { service, flags, redis };
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

  it('stops guessing after a few wrong tokens from one address', async () => {
    const { service } = setup();
    const token = await service.newToken(actor);
    for (let i = 0; i < SETUP_ATTEMPTS_MAX; i++)
      expect(await service.open('wrong', '10.0.0.9')).toBeNull();
    await expect(service.open(token, '10.0.0.9')).rejects.toBeInstanceOf(SetupLockedError);
    expect(await service.open(token, '10.0.0.10')).not.toBeNull();
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
    const { id } = await service.startPhoneTest('http://192.168.1.10:18080');
    expect(await service.phoneTest(id)).toEqual({
      address: 'http://192.168.1.10:18080',
      reached: null,
    });
    expect(await service.reached(id, 'Mozilla/5.0 (iPhone)')).toBe(true);
    expect((await service.phoneTest(id))?.reached?.agent).toBe('Mozilla/5.0 (iPhone)');
    expect(await service.testedAddresses()).toEqual(['http://192.168.1.10:18080']);
    expect(await service.reached('unknown-unknown', 'x')).toBe(false);
  });
});
