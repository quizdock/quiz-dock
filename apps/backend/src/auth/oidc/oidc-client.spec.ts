import {
  discoveryUrl,
  issuerMismatch,
  OidcClient,
  OidcGrantError,
  oidcSettings,
  pkceChallenge,
} from './oidc-client';

const ISSUER = 'http://localhost:18080/realms/quiz-dock';
const INTERNAL = 'http://keycloak:8080';

/** Discovery as Keycloak serves it with a public hostname and a dynamic back channel. */
const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${INTERNAL}/realms/quiz-dock/protocol/openid-connect/token`,
  end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
  jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
};

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe('oidcSettings', () => {
  it('requires the issuer, as an http(s) URL without query or fragment', () => {
    expect(() => oidcSettings({})).toThrow(/OIDC_ISSUER is required/);
    expect(() => oidcSettings({ OIDC_ISSUER: '  ' })).toThrow(/OIDC_ISSUER is required/);
    expect(() => oidcSettings({ OIDC_ISSUER: 'idp.example.com' })).toThrow(/not a URL/);
    for (const bad of ['ftp://idp/x', 'https://idp/x?a=1', 'https://idp/x#f', 'https://idp/x?']) {
      expect(() => oidcSettings({ OIDC_ISSUER: bad })).toThrow(/without query or fragment/);
    }
  });

  it('keeps the issuer as written, trailing slash included (OIDC Core §3.1.3.7, #99)', () => {
    const slashed = 'https://idp.example.com/tenant/app/';
    expect(oidcSettings({ OIDC_ISSUER: ` ${slashed}\n` }).issuer).toBe(slashed);
    expect(oidcSettings({ OIDC_ISSUER: ISSUER }).issuer).toBe(ISSUER);
  });

  it('reads the internal address, or takes it from a JWKS URI on another host', () => {
    expect(
      oidcSettings({ OIDC_ISSUER: ISSUER, OIDC_INTERNAL_URL: `${INTERNAL}/` }).internalUrl,
    ).toBe(INTERNAL);
    const derived = oidcSettings({
      OIDC_ISSUER: `${ISSUER}/`,
      OIDC_JWKS_URI: `${INTERNAL}/realms/quiz-dock/protocol/openid-connect/certs`,
    });
    expect(derived.issuer).toBe(`${ISSUER}/`);
    expect(derived.internalUrl).toBe(INTERNAL);
    expect(oidcSettings({ OIDC_ISSUER: ISSUER }).internalUrl).toBeNull();
  });
});

describe('discoveryUrl', () => {
  it('builds the discovery URL per OIDC Discovery §4: drops the trailing slash of the issuer, there only', () => {
    const doc = 'https://idp.example.com/tenant/app/.well-known/openid-configuration';
    expect(discoveryUrl('https://idp.example.com/tenant/app/')).toBe(doc);
    expect(discoveryUrl('https://idp.example.com/tenant/app')).toBe(doc);
    expect(discoveryUrl('https://idp.example.com/')).toBe(
      'https://idp.example.com/.well-known/openid-configuration',
    );
  });
});

describe('issuerMismatch', () => {
  it('compares exactly, and names a trailing slash as the only difference', () => {
    expect(issuerMismatch(ISSUER, ISSUER)).toBeNull();
    expect(issuerMismatch(`${ISSUER}/`, ISSUER)).toMatch(/by a trailing slash only/);
    expect(issuerMismatch('https://other/x', ISSUER)).not.toMatch(/trailing slash/);
  });
});

describe('OidcClient', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async (url: string) =>
      String(url).endsWith('/.well-known/openid-configuration')
        ? json(200, discovery)
        : json(404, {}),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const client = (env: NodeJS.ProcessEnv = {}) =>
    new OidcClient(oidcSettings({ OIDC_ISSUER: ISSUER, OIDC_INTERNAL_URL: INTERNAL, ...env }));

  it('fetches discovery on the internal address, sends the browser to the public one', async () => {
    const url = new URL(
      await client().authorizationUrl({
        redirectUri: 'http://localhost:15173/auth/callback',
        state: 'st',
        nonce: 'no',
        codeVerifier: 'verifier-verifier-verifier-verifier-verifier-00',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${INTERNAL}/realms/quiz-dock/.well-known/openid-configuration`,
    );
    expect(`${url.origin}${url.pathname}`).toBe(discovery.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'quiz-dock-frontend',
      redirect_uri: 'http://localhost:15173/auth/callback',
      scope: 'openid profile email',
      state: 'st',
      nonce: 'no',
      code_challenge: pkceChallenge('verifier-verifier-verifier-verifier-verifier-00'),
      code_challenge_method: 'S256',
    });
  });

  it('finds the discovery of an issuer whose path ends in a slash, on either address', async () => {
    const slashed = 'https://idp.example.com/tenant/app/';
    fetchMock.mockImplementation(async () => json(200, { ...discovery, issuer: slashed }));
    await new OidcClient(oidcSettings({ OIDC_ISSUER: slashed })).authorizationUrl({
      redirectUri: 'http://app/auth/callback',
      state: 'st',
      nonce: 'no',
      codeVerifier: 'v',
    });
    await new OidcClient(
      oidcSettings({ OIDC_ISSUER: slashed, OIDC_INTERNAL_URL: 'http://idp:9000' }),
    ).authorizationUrl({
      redirectUri: 'http://app/auth/callback',
      state: 'st',
      nonce: 'no',
      codeVerifier: 'v',
    });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      `${slashed}.well-known/openid-configuration`,
      'http://idp:9000/tenant/app/.well-known/openid-configuration',
    ]);
  });

  it('computes the S256 challenge of RFC 7636 (appendix B)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('exchanges a code as a public client: client_id and verifier in the body', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/token')
        ? json(200, { access_token: 'at', refresh_token: 'rt', id_token: 'it', expires_in: 60 })
        : json(200, discovery),
    );
    const before = Date.now();
    const set = await client().exchangeCode('the-code', 'the-verifier', 'http://app/auth/callback');
    expect(set).toMatchObject({ accessToken: 'at', refreshToken: 'rt', idToken: 'it' });
    expect(set.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/token'))!;
    expect(url).toBe(discovery.token_endpoint);
    expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://app/auth/callback',
      code_verifier: 'the-verifier',
      client_id: 'quiz-dock-frontend',
    });
    expect(init.headers.authorization).toBeUndefined();
  });

  it('authenticates as a confidential client when a secret is set', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/token') ? json(200, { access_token: 'at' }) : json(200, discovery),
    );
    await client({ OIDC_CLIENT_SECRET: 's3cret' }).refresh('rt-old');
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/token'))!;
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('quiz-dock-frontend:s3cret').toString('base64')}`,
    );
    expect(new URLSearchParams(init.body as URLSearchParams).get('client_id')).toBeNull();
  });

  it('keeps the refresh token when the provider does not rotate it', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/token') ? json(200, { access_token: 'at2' }) : json(200, discovery),
    );
    expect(await client().refresh('rt-old')).toMatchObject({
      accessToken: 'at2',
      refreshToken: 'rt-old',
    });
  });

  it('tells a refused grant from a provider in trouble', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/token') ? json(400, { error: 'invalid_grant' }) : json(200, discovery),
    );
    await expect(client().refresh('rt')).rejects.toBeInstanceOf(OidcGrantError);
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/token') ? json(502, {}) : json(200, discovery),
    );
    await expect(client().refresh('rt')).rejects.not.toBeInstanceOf(OidcGrantError);
  });

  it('builds the end-session address with the ID token as a hint', async () => {
    const url = new URL((await client().endSessionUrl('id-token', 'http://app'))!);
    expect(`${url.origin}${url.pathname}`).toBe(discovery.end_session_endpoint);
    expect(url.searchParams.get('id_token_hint')).toBe('id-token');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://app');
  });
});
