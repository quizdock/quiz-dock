import { fakeRedis } from '../testing/fake-redis';
import { RedisConfirmationStore } from './confirmations';

describe('RedisConfirmationStore (§3.3, step 4)', () => {
  const store = () => new RedisConfirmationStore(fakeRedis() as never);

  it('a token runs the call it was issued for, once', async () => {
    const s = store();
    const token = await s.issue('settings.set|{"key":"A"}|api|u1');
    expect(await s.redeem(token, 'settings.set|{"key":"A"}|api|u1')).toBe(true);
    expect(await s.redeem(token, 'settings.set|{"key":"A"}|api|u1')).toBe(false);
  });

  it('another call, or a forged token, is refused — and spends the token', async () => {
    const s = store();
    const token = await s.issue('quizzes.delete|{"quiz":"q1"}|api|u1');
    expect(await s.redeem(token, 'quizzes.delete|{"quiz":"q2"}|api|u1')).toBe(false);
    expect(await s.redeem(token, 'quizzes.delete|{"quiz":"q1"}|api|u1')).toBe(false);
    expect(await s.redeem('not a token', 'anything')).toBe(false);
  });

  it('keeps no fingerprint in clear', async () => {
    const redis = fakeRedis();
    const s = new RedisConfirmationStore(redis as never);
    await s.issue('secret-ish fingerprint');
    expect([...redis.values.values()].join()).not.toContain('secret-ish');
  });
});
