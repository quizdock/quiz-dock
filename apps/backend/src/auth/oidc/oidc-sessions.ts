import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import { OidcGrantError, type OidcClient, randomToken, type TokenSet } from './oidc-client';

/** A signed-in browser, as kept server-side. */
interface StoredSession extends TokenSet {
  sub: string;
}

/** A sign-in on its way to the provider and back (state, nonce, PKCE verifier). */
export interface PendingLogin {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

/**
 * A session unused for this long is forgotten. The provider bounds it too: once
 * its refresh token is refused, the session ends whatever this says.
 */
export const SESSION_IDLE_S = 24 * 3600;
/** A sign-in not completed within ten minutes is dropped. */
export const LOGIN_TTL_S = 600;
/** Renew the access token this long before it expires. */
const RENEW_BEFORE_MS = 30_000;
/** How long a refresh may hold the lock, and how long another request waits for it. */
const REFRESH_LOCK_MS = 10_000;
const REFRESH_WAIT_MS = 5_000;

/**
 * Only a hash of the session id is stored: the cookie is the one copy of the id,
 * and a look at Redis gives nothing to present as someone's cookie.
 */
const hashOf = (sid: string): string => createHash('sha256').update(sid).digest('base64url');
const sessionKey = (sid: string) => `auth:session:${hashOf(sid)}`;
const lockKey = (sid: string) => `auth:refresh:${hashOf(sid)}`;
const loginKey = (state: string) => `auth:login:${hashOf(state)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads and deletes a key in one step, on any Redis version (GETDEL needs 6.2). */
async function take(redis: RedisService, key: string): Promise<string | null> {
  const res = await redis.multi().get(key).del(key).exec();
  const value = res?.[0]?.[1];
  return typeof value === 'string' ? value : null;
}

/** The session as it is while its access token has not expired yet, else nothing. */
const stillValid = (session: StoredSession): StoredSession | null =>
  session.expiresAt > Date.now() ? session : null;

/**
 * The browser sessions of `AUTH_MODE=oidc` (Backend for Frontend): the tokens
 * stay in Redis, the browser holds a random id in an `httpOnly` cookie. Every
 * sign-in gets a fresh id (no session fixation); the access token is renewed
 * here, one request at a time per session.
 */
export class OidcSessions {
  private readonly logger = new Logger(OidcSessions.name);

  constructor(
    private readonly redis: RedisService,
    private readonly client: OidcClient,
  ) {}

  async savePendingLogin(state: string, login: PendingLogin): Promise<void> {
    await this.redis.set(loginKey(state), JSON.stringify(login), 'EX', LOGIN_TTL_S);
  }

  /** Reads and forgets a pending sign-in: a state is good for one callback. */
  async takePendingLogin(state: string): Promise<PendingLogin | null> {
    const raw = await take(this.redis, loginKey(state));
    return raw ? (JSON.parse(raw) as PendingLogin) : null;
  }

  /** Opens a session for fresh tokens; returns the id to set in the cookie. */
  async create(sub: string, tokens: TokenSet): Promise<string> {
    const sid = randomToken();
    const session: StoredSession = { sub, ...tokens };
    await this.redis.set(sessionKey(sid), JSON.stringify(session), 'EX', SESSION_IDLE_S);
    return sid;
  }

  async destroy(sid: string): Promise<StoredSession | null> {
    const raw = await take(this.redis, sessionKey(sid));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  private async read(sid: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(sessionKey(sid));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  /**
   * A valid access token for the session, renewed when it is about to expire;
   * null when the session is unknown, or over (the provider refused to renew).
   * The idle timer restarts on every use.
   */
  async accessToken(sid: string): Promise<string | null> {
    let session = await this.read(sid);
    if (!session) return null;
    if (session.expiresAt - Date.now() < RENEW_BEFORE_MS) {
      session = await this.renew(sid, session);
      if (!session) return null;
    }
    await this.redis.expire(sessionKey(sid), SESSION_IDLE_S);
    return session.accessToken;
  }

  /**
   * Renews under a per-session lock: tabs share the session, and with rotating
   * refresh tokens two renewals at once would revoke each other. The request
   * that does not get the lock waits for the other's result.
   */
  private async renew(sid: string, session: StoredSession): Promise<StoredSession | null> {
    if (!session.refreshToken) {
      await this.destroy(sid);
      return null;
    }
    const locked = await this.redis.set(lockKey(sid), '1', 'PX', REFRESH_LOCK_MS, 'NX');
    if (!locked) {
      const deadline = Date.now() + REFRESH_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(150);
        const current = await this.read(sid);
        if (!current) return null;
        if (current.expiresAt !== session.expiresAt) return current;
      }
      return stillValid(session);
    }
    try {
      const tokens = await this.client.refresh(session.refreshToken);
      const renewed: StoredSession = {
        ...session,
        ...tokens,
        idToken: tokens.idToken ?? session.idToken,
      };
      await this.redis.set(sessionKey(sid), JSON.stringify(renewed), 'EX', SESSION_IDLE_S);
      return renewed;
    } catch (err) {
      if (err instanceof OidcGrantError) {
        // The provider ended the session (logout, expiry, revocation): so do we.
        await this.destroy(sid);
        return null;
      }
      // The provider is out of reach for now: the token serves until it expires.
      this.logger.warn(`Token renewal failed: ${(err as Error).message}`);
      return stillValid(session);
    } finally {
      await this.redis.del(lockKey(sid));
    }
  }
}
