/**
 * Vérifie la VRAIE logique de validation jose (signature RS256, iss, exp, aud)
 * avec un keypair réel — seul `createRemoteJWKSet` est remplacé par un JWKS local
 * (pas de réseau). Ce n'est donc pas un mock qui contourne la crypto.
 */
jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return { __esModule: true, ...actual, createRemoteJWKSet: jest.fn() };
});

import type { Request } from 'express';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from 'jose';

const ISSUER = 'http://localhost:8080/realms/quiz-dock';
const KID = 'test-key';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK;

const bearer = (token: string): Request =>
  ({ headers: { authorization: `Bearer ${token}` } }) as unknown as Request;

interface TokenOpts {
  issuer?: string;
  audience?: string;
  expSeconds?: number;
  sub?: string;
  username?: string;
  email?: string;
  roles?: string[];
  nickname?: string;
}

async function makeToken(opts: TokenOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    preferred_username: opts.username ?? 'marc',
    email: opts.email,
    nickname: opts.nickname,
    profile: { nickname: opts.nickname },
    // Flat `roles` claim (default OIDC_ROLES_CLAIM); nested paths are tested separately.
    roles: opts.roles ?? ['host'],
    realm_access: { roles: ['nested-host'] },
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'account')
    .setSubject(opts.sub ?? 'kc-sub-123')
    .setIssuedAt(now)
    .setExpirationTime(opts.expSeconds ?? now + 3600)
    .sign(privateKey);
}

/** Construit le provider après avoir armé le JWKS local et l'env. */
async function buildProvider(audience?: string, rolesClaim?: string, nameClaim?: string) {
  const localSet = createLocalJWKSet({ keys: [publicJwk] });
  (createRemoteJWKSet as jest.Mock).mockReturnValue(localSet);
  if (audience) process.env.OIDC_AUDIENCE = audience;
  else delete process.env.OIDC_AUDIENCE;
  if (rolesClaim) process.env.OIDC_ROLES_CLAIM = rolesClaim;
  else delete process.env.OIDC_ROLES_CLAIM;
  if (nameClaim) process.env.OIDC_NAME_CLAIM = nameClaim;
  else delete process.env.OIDC_NAME_CLAIM;
  process.env.OIDC_ISSUER = ISSUER;
  // Explicit JWKS URI: no discovery round-trip in unit tests.
  process.env.OIDC_JWKS_URI = `${ISSUER}/jwks`;
  return newProvider();
}

/** A session store that knows one browser: `sid-ok` → `sessionToken`. */
let sessionToken: string | null = null;
const sessions = {
  accessToken: jest.fn(async (sid: string) => (sid === 'sid-ok' ? sessionToken : null)),
};

async function newProvider() {
  const { OidcProvider } = await import('./oidc.provider');
  const { OidcClient, oidcSettings } = await import('./oidc/oidc-client');
  return new OidcProvider(new OidcClient(oidcSettings()), sessions as never);
}

const withCookie = (cookie: string): Request => ({ headers: { cookie } }) as unknown as Request;

/** A discovery document as a provider serves it, on the given origin. */
const discoveryDoc = (origin: string, issuer = ISSUER) => ({
  issuer,
  authorization_endpoint: `${origin}/realms/quiz-dock/protocol/openid-connect/auth`,
  token_endpoint: `${origin}/realms/quiz-dock/protocol/openid-connect/token`,
  end_session_endpoint: `${origin}/realms/quiz-dock/protocol/openid-connect/logout`,
  jwks_uri: `${origin}/realms/quiz-dock/protocol/openid-connect/certs`,
});

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
});

describe('OidcProvider', () => {
  it('accepte un token valide et en extrait le principal', async () => {
    const provider = await buildProvider();
    const principal = await provider.authenticate(
      bearer(await makeToken({ username: 'marc', email: 'marc@ex.fr' })),
    );
    expect(principal).toEqual({
      sub: 'kc-sub-123',
      displayName: 'marc',
      email: 'marc@ex.fr',
      roles: ['host'],
    });
  });

  it('renvoie null sans en-tête Bearer ni cookie de session', async () => {
    const provider = await buildProvider();
    expect(await provider.authenticate({ headers: {} } as unknown as Request)).toBeNull();
  });

  it('reads the session cookie: the tokens stay server-side', async () => {
    const provider = await buildProvider();
    sessionToken = await makeToken({ username: 'marc' });
    const principal = await provider.authenticate(withCookie('theme=dark; qd_session=sid-ok'));
    expect(principal?.displayName).toBe('marc');
    expect(sessions.accessToken).toHaveBeenLastCalledWith('sid-ok');
  });

  it('turns away an unknown or ended session', async () => {
    const provider = await buildProvider();
    expect(await provider.authenticate(withCookie('qd_session=sid-gone'))).toBeNull();
  });

  it('rejette un token expiré', async () => {
    const provider = await buildProvider();
    const now = Math.floor(Date.now() / 1000);
    const principal = await provider.authenticate(
      bearer(await makeToken({ expSeconds: now - 60 })),
    );
    expect(principal).toBeNull();
  });

  it('rejette un mauvais émetteur (iss)', async () => {
    const provider = await buildProvider();
    const principal = await provider.authenticate(
      bearer(await makeToken({ issuer: 'http://evil/realms/x' })),
    );
    expect(principal).toBeNull();
  });

  it('rejette une signature altérée', async () => {
    const provider = await buildProvider();
    const token = await makeToken();
    const tampered = `${token.slice(0, -3)}abc`;
    expect(await provider.authenticate(bearer(tampered))).toBeNull();
  });

  it('vérifie l’audience quand elle est configurée', async () => {
    const provider = await buildProvider('quiz-dock-api');
    const ok = await provider.authenticate(bearer(await makeToken({ audience: 'quiz-dock-api' })));
    expect(ok?.sub).toBe('kc-sub-123');
    const ko = await provider.authenticate(bearer(await makeToken({ audience: 'account' })));
    expect(ko).toBeNull();
  });

  it('lit les rôles à un chemin pointé quand OIDC_ROLES_CLAIM est configuré', async () => {
    const provider = await buildProvider(undefined, 'realm_access.roles');
    const principal = await provider.authenticate(bearer(await makeToken()));
    expect(principal?.roles).toEqual(['nested-host']);
  });

  it('takes the display name from OIDC_NAME_CLAIM, standard chain as a fallback', async () => {
    const provider = await buildProvider(undefined, undefined, 'nickname');
    const named = await provider.authenticate(bearer(await makeToken({ nickname: 'Marco' })));
    expect(named?.displayName).toBe('Marco');
    // No such claim on that account: `preferred_username` still answers.
    const plain = await provider.authenticate(bearer(await makeToken()));
    expect(plain?.displayName).toBe('marc');
    const nested = await buildProvider(undefined, undefined, 'profile.nickname');
    const deep = await nested.authenticate(bearer(await makeToken({ nickname: 'Marco' })));
    expect(deep?.displayName).toBe('Marco');
  });

  it('résout le JWKS via OIDC Discovery quand OIDC_JWKS_URI est absent', async () => {
    await buildProvider();
    delete process.env.OIDC_JWKS_URI;
    const discovered = await newProvider();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => discoveryDoc('http://localhost:8080'),
    });
    const realFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const principal = await discovered.authenticate(bearer(await makeToken()));
      expect(principal?.sub).toBe('kc-sub-123');
      // Second call: discovery document is cached.
      await discovered.authenticate(bearer(await makeToken()));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`);
      expect(createRemoteJWKSet).toHaveBeenLastCalledWith(
        new URL(`${ISSUER}/protocol/openid-connect/certs`),
      );
    } finally {
      global.fetch = realFetch;
    }
  });

  it('retente la discovery au prochain appel si elle a échoué', async () => {
    await buildProvider();
    delete process.env.OIDC_JWKS_URI;
    const discovered = await newProvider();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: async () => discoveryDoc('http://localhost:8080') });
    const realFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(await discovered.authenticate(bearer(await makeToken()))).toBeNull();
      expect((await discovered.authenticate(bearer(await makeToken())))?.sub).toBe('kc-sub-123');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = realFetch;
    }
  });
});
