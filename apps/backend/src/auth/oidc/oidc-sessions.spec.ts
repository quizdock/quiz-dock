import type { RedisService } from '../../redis/redis.service';
import { OidcGrantError, type OidcClient, type TokenSet } from './oidc-client';
import { OidcSessions, SESSION_IDLE_S } from './oidc-sessions';

/** Just enough of Redis for the sessions: strings with NX, deletion, a get-and-delete pipeline. */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    expire: jest.fn(async () => 1),
    multi: jest.fn(() => {
      const ops: (() => unknown)[] = [];
      const pipe = {
        get: (key: string) => (ops.push(() => store.get(key) ?? null), pipe),
        del: (key: string) => (ops.push(() => (store.delete(key) ? 1 : 0)), pipe),
        exec: async () => ops.map((op) => [null, op()]),
      };
      return pipe;
    }),
  };
  return redis;
}

const tokens = (over: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  idToken: 'id-1',
  expiresAt: Date.now() + 300_000,
  ...over,
});

function setup(refresh: jest.Mock = jest.fn()) {
  const redis = fakeRedis();
  const client = { refresh } as unknown as OidcClient;
  return { redis, refresh, sessions: new OidcSessions(redis as unknown as RedisService, client) };
}

describe('OidcSessions', () => {
  it('opens a session under a random id, and stores only its hash', async () => {
    const { redis, sessions } = setup();
    const a = await sessions.create('sub-1', tokens());
    const b = await sessions.create('sub-1', tokens());
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    for (const key of redis.store.keys()) expect(key).not.toContain(a);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:session:/),
      expect.any(String),
      'EX',
      SESSION_IDLE_S,
    );
  });

  it('serves the access token and restarts the idle timer', async () => {
    const { redis, sessions } = setup();
    const sid = await sessions.create('sub-1', tokens());
    expect(await sessions.accessToken(sid)).toBe('at-1');
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), SESSION_IDLE_S);
    expect(await sessions.accessToken('unknown')).toBeNull();
  });

  it('renews a token about to expire, keeping the ID token when none comes back', async () => {
    const refresh = jest.fn(async () =>
      tokens({ accessToken: 'at-2', refreshToken: 'rt-2', idToken: null }),
    );
    const { sessions } = setup(refresh);
    const sid = await sessions.create('sub-1', tokens({ expiresAt: Date.now() + 5_000 }));
    expect(await sessions.accessToken(sid)).toBe('at-2');
    expect(refresh).toHaveBeenCalledWith('rt-1');
    // Now fresh: no second renewal.
    expect(await sessions.accessToken(sid)).toBe('at-2');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await sessions.destroy(sid))?.idToken).toBe('id-1');
  });

  it('renews once when two requests of the same session need it together', async () => {
    let release!: () => void;
    const refresh = jest.fn(
      () =>
        new Promise<TokenSet>((resolve) => {
          release = () => resolve(tokens({ accessToken: 'at-2' }));
        }),
    );
    const { sessions } = setup(refresh);
    const sid = await sessions.create('sub-1', tokens({ expiresAt: Date.now() + 5_000 }));
    const first = sessions.accessToken(sid);
    const second = sessions.accessToken(sid);
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect(await Promise.all([first, second])).toEqual(['at-2', 'at-2']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the provider refuses to renew', async () => {
    const refresh = jest.fn(async () => {
      throw new OidcGrantError('invalid_grant');
    });
    const { sessions } = setup(refresh);
    const sid = await sessions.create('sub-1', tokens({ expiresAt: Date.now() + 5_000 }));
    expect(await sessions.accessToken(sid)).toBeNull();
    expect(await sessions.accessToken(sid)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps serving a still-valid token while the provider is out of reach', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { sessions } = setup(refresh);
    const sid = await sessions.create('sub-1', tokens({ expiresAt: Date.now() + 5_000 }));
    expect(await sessions.accessToken(sid)).toBe('at-1');
    const gone = await sessions.create('sub-1', tokens({ expiresAt: Date.now() - 1 }));
    expect(await sessions.accessToken(gone)).toBeNull();
  });

  it('ends a session without refresh token once its access token expires', async () => {
    const { sessions } = setup();
    const sid = await sessions.create(
      'sub-1',
      tokens({ refreshToken: null, expiresAt: Date.now() }),
    );
    expect(await sessions.accessToken(sid)).toBeNull();
  });

  it('gives a pending sign-in back once, for one callback', async () => {
    const { sessions } = setup();
    const login = { codeVerifier: 'v', nonce: 'n', redirectUri: 'http://app/auth/callback' };
    await sessions.savePendingLogin('state-1', login);
    expect(await sessions.takePendingLogin('state-1')).toEqual(login);
    expect(await sessions.takePendingLogin('state-1')).toBeNull();
  });
});
