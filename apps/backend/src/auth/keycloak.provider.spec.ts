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

const ISSUER = 'http://localhost:8080/realms/roux-quizz';
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
}

async function makeToken(opts: TokenOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    preferred_username: opts.username ?? 'marc',
    email: opts.email,
    realm_access: { roles: opts.roles ?? ['host'] },
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
async function buildProvider(audience?: string) {
  const localSet = createLocalJWKSet({ keys: [publicJwk] });
  (createRemoteJWKSet as jest.Mock).mockReturnValue(localSet);
  if (audience) process.env.KEYCLOAK_AUDIENCE = audience;
  else delete process.env.KEYCLOAK_AUDIENCE;
  process.env.KEYCLOAK_ISSUER = ISSUER;
  const { KeycloakProvider } = await import('./keycloak.provider');
  return new KeycloakProvider();
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
});

describe('KeycloakProvider', () => {
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

  it('renvoie null sans en-tête Bearer', async () => {
    const provider = await buildProvider();
    expect(await provider.authenticate({ headers: {} } as unknown as Request)).toBeNull();
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
    const provider = await buildProvider('roux-quizz-api');
    const ok = await provider.authenticate(bearer(await makeToken({ audience: 'roux-quizz-api' })));
    expect(ok?.sub).toBe('kc-sub-123');
    const ko = await provider.authenticate(bearer(await makeToken({ audience: 'account' })));
    expect(ko).toBeNull();
  });
});
