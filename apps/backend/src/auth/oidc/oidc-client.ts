import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';

type Jwks = ReturnType<typeof createRemoteJWKSet>;

/** The provider's endpoints the backend uses, each on the side it is reached from. */
interface Endpoints {
  /** Front channel (the browser goes there). */
  authorization: string;
  endSession: string | null;
  /** Back channel (the backend calls it). */
  token: string;
  jwks: string;
}

/** What the token endpoint answers (RFC 6749 §5.1, OIDC Core §3.1.3.3). */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** When the access token expires, in ms since the epoch. */
  expiresAt: number;
}

/** The token endpoint refused the grant (expired or revoked session, reused refresh token…). */
export class OidcGrantError extends Error {}

/** Settings of the OIDC client, all from the environment (see `oidcSettings`). */
export interface OidcSettings {
  /** `iss` expected in the tokens: the provider as the browser sees it. */
  issuer: string;
  clientId: string;
  /** Confidential client when set; public client with PKCE otherwise. */
  clientSecret: string | null;
  audience: string | null;
  /** Where the backend reaches the provider when the public address is not reachable from its network. */
  internalUrl: string | null;
  jwksUri: string | null;
  scope: string;
}

const originOf = (url: string): string => new URL(url).origin;

/**
 * Reads the OIDC settings. `OIDC_INTERNAL_URL` defaults to the origin of an
 * `OIDC_JWKS_URI` pointing elsewhere than the issuer — the setup that variable
 * already described (the provider seen under another name from the backend).
 */
export function oidcSettings(env: NodeJS.ProcessEnv = process.env): OidcSettings {
  const issuer = env.OIDC_ISSUER?.replace(/\/+$/, '');
  if (!issuer) throw new Error('OIDC_ISSUER is required when AUTH_MODE=oidc.');
  const jwksUri = env.OIDC_JWKS_URI || null;
  let internalUrl = env.OIDC_INTERNAL_URL ? originOf(env.OIDC_INTERNAL_URL) : null;
  if (!internalUrl && jwksUri && originOf(jwksUri) !== originOf(issuer)) {
    internalUrl = originOf(jwksUri);
  }
  return {
    issuer,
    clientId: env.OIDC_CLIENT_ID || 'quiz-dock-frontend',
    clientSecret: env.OIDC_CLIENT_SECRET || null,
    audience: env.OIDC_AUDIENCE || null,
    internalUrl,
    jwksUri,
    scope: 'openid profile email',
  };
}

/** A random URL-safe string (state, nonce, PKCE verifier, session id). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** PKCE `S256` challenge of a verifier (RFC 7636 §4.2). */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/**
 * The backend's OpenID Connect client (Authorization Code + PKCE, RFC 6749 /
 * 7636, OIDC Core and Discovery). Nothing provider-specific: every endpoint
 * comes from the discovery document. The browser never sees a token — the
 * backend exchanges the code, keeps the tokens and renews them.
 */
export class OidcClient {
  private readonly logger = new Logger(OidcClient.name);
  private endpoints: Promise<Endpoints> | null = null;
  private jwks: Promise<Jwks> | null = null;

  constructor(readonly settings: OidcSettings) {}

  /** A URL on the provider's public address → the same on its internal one (back channel). */
  private toInternal(url: string): string {
    const { internalUrl, issuer } = this.settings;
    return internalUrl && url.startsWith(originOf(issuer))
      ? internalUrl + url.slice(originOf(issuer).length)
      : url;
  }

  /** The reverse, for the addresses the browser is sent to (front channel). */
  private toPublic(url: string): string {
    const { internalUrl, issuer } = this.settings;
    return internalUrl && url.startsWith(internalUrl)
      ? originOf(issuer) + url.slice(internalUrl.length)
      : url;
  }

  /**
   * The discovery document, fetched once. A failure is not kept, so the next
   * request tries again — the provider may simply not be up yet.
   */
  private discover(): Promise<Endpoints> {
    if (!this.endpoints) {
      this.endpoints = this.fetchDiscovery();
      this.endpoints.catch(() => {
        this.endpoints = null;
      });
    }
    return this.endpoints;
  }

  private async fetchDiscovery(): Promise<Endpoints> {
    const url = this.toInternal(`${this.settings.issuer}/.well-known/openid-configuration`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${url} → HTTP ${res.status}`);
    const doc = (await res.json()) as Record<string, unknown>;
    const str = (key: string): string | null => (typeof doc[key] === 'string' ? doc[key] : null);
    const authorization = str('authorization_endpoint');
    const token = str('token_endpoint');
    const jwks = str('jwks_uri');
    if (!authorization || !token || !jwks) {
      throw new Error(`OIDC discovery document at ${url} lacks an endpoint.`);
    }
    const issuer = str('issuer')?.replace(/\/+$/, '');
    if (issuer && issuer !== this.settings.issuer) {
      this.logger.warn(
        `Discovery issuer "${issuer}" differs from OIDC_ISSUER "${this.settings.issuer}" — tokens must carry the latter.`,
      );
    }
    const endSession = str('end_session_endpoint');
    return {
      authorization: this.toPublic(authorization),
      endSession: endSession ? this.toPublic(endSession) : null,
      token: this.toInternal(token),
      jwks: this.settings.jwksUri ?? this.toInternal(jwks),
    };
  }

  private keys(): Promise<Jwks> {
    if (!this.jwks) {
      const uri = this.settings.jwksUri
        ? Promise.resolve(this.settings.jwksUri)
        : this.discover().then((e) => e.jwks);
      this.jwks = uri.then((u) => createRemoteJWKSet(new URL(u)));
      this.jwks.catch(() => {
        this.jwks = null;
      });
    }
    return this.jwks;
  }

  /** The address the browser is sent to, to sign in (OIDC Core §3.1.2.1). */
  async authorizationUrl(p: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<string> {
    const url = new URL((await this.discover()).authorization);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.settings.clientId,
      redirect_uri: p.redirectUri,
      scope: this.settings.scope,
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.codeVerifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Where the browser goes to end the provider's session too, or null if it has no such endpoint. */
  async endSessionUrl(
    idToken: string | null,
    postLogoutRedirectUri: string,
  ): Promise<string | null> {
    const endpoint = (await this.discover()).endSession;
    if (!endpoint) return null;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
      ...(idToken ? { id_token_hint: idToken } : {}),
    }).toString();
    return url.toString();
  }

  /** Authorization code → tokens (RFC 6749 §4.1.3, with the PKCE verifier). */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenSet> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  }

  /** Refresh token → new tokens (RFC 6749 §6); the old refresh token stays if none is sent back. */
  async refresh(refreshToken: string): Promise<TokenSet> {
    const set = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return { ...set, refreshToken: set.refreshToken ?? refreshToken };
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenSet> {
    const { clientId, clientSecret } = this.settings;
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    const body = new URLSearchParams(params);
    if (clientSecret) {
      // client_secret_basic (RFC 6749 §2.3.1): both parts form-encoded, then Base64.
      const pair = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`;
    } else {
      body.set('client_id', clientId);
    }
    const res = await fetch((await this.discover()).token, { method: 'POST', headers, body });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // 400 invalid_grant & co: the grant is dead. Anything else is the provider's trouble.
      if (res.status === 400 || res.status === 401) {
        throw new OidcGrantError(String(json.error ?? `HTTP ${res.status}`));
      }
      throw new Error(`OIDC token endpoint → HTTP ${res.status}`);
    }
    if (typeof json.access_token !== 'string') {
      throw new Error('OIDC token endpoint answered without an access token.');
    }
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 300;
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      idToken: typeof json.id_token === 'string' ? json.id_token : null,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  /** Validates an access token: signature against the JWKS, `iss`, `exp`, and `aud` when configured. */
  async verifyAccessToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, await this.keys(), {
      issuer: this.settings.issuer,
      ...(this.settings.audience ? { audience: this.settings.audience } : {}),
    });
    return payload;
  }

  /** Validates the ID token of a sign-in (OIDC Core §3.1.3.7): issuer, audience = us, nonce. */
  async verifyIdToken(token: string, nonce: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, await this.keys(), {
      issuer: this.settings.issuer,
      audience: this.settings.clientId,
    });
    if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch.');
    return payload;
  }
}
