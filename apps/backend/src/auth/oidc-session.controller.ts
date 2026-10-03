import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { SETTINGS } from '@quiz-dock/contracts';
import type { Request, Response } from 'express';
import { seen, settings } from '../admin/settings/settings.service';
import { UsersService } from '../users/users.service';
import { AuthRedirectDto, OidcCallbackDto, OidcSignedInDto } from './dto/oidc-session.dto';
import { OidcProvider } from './oidc.provider';
import { OidcClient, randomToken } from './oidc/oidc-client';
import { OidcSessions } from './oidc/oidc-sessions';
import {
  LOGIN_COOKIE,
  LOGIN_COOKIE_PATH,
  cookieName,
  readOurCookie,
  SESSION_COOKIE,
  serializeCookie,
} from './oidc/session-cookie';
import { LOGIN_TTL_S } from './oidc/oidc-sessions';
import { Public } from './public.decorator';

/** The address the browser uses for this application (the page that called us). */
/** `__Host-` needs Path=/: the login cookie keeps to the auth endpoints only without it. */
const loginCookiePath = (secure: boolean) => (secure ? '/' : LOGIN_COOKIE_PATH);

function appOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') return origin;
  return `${req.protocol}://${req.host}`;
}

/**
 * Sign-in, its return and sign-out in `AUTH_MODE=oidc` (Backend for Frontend).
 * The SPA calls these with `fetch` and navigates where they say; the tokens
 * never leave the backend. The provider sends the browser back to the SPA's
 * `/auth/callback` page, which hands the code over here — the redirect URI a
 * deployment registered with its provider stays the same.
 */
@ApiTags('auth')
@Controller('auth')
export class OidcSessionController {
  private readonly logger = new Logger(OidcSessionController.name);

  constructor(
    @Optional() @Inject(OidcClient) private readonly client: OidcClient | null,
    @Optional() @Inject(OidcSessions) private readonly sessions: OidcSessions | null,
    @Optional() @Inject(OidcProvider) private readonly provider: OidcProvider | null,
    private readonly users: UsersService,
  ) {}

  private oidc() {
    if (!this.client || !this.sessions || !this.provider) {
      throw new NotFoundException('auth.oidc_disabled');
    }
    return { client: this.client, sessions: this.sessions, provider: this.provider };
  }

  /** Starts a sign-in: remembers state, nonce and PKCE verifier, returns the provider's address. */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthRedirectDto })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthRedirectDto> {
    const { client, sessions } = this.oidc();
    const state = randomToken();
    const login = {
      codeVerifier: randomToken(48),
      nonce: randomToken(),
      redirectUri: `${appOrigin(req)}/auth/callback`,
    };
    // Over plain HTTP behind an https address: the proxy is not trusted (Health says so).
    if (!req.secure && settings.get(SETTINGS.APP_PUBLIC_URL).startsWith('https://'))
      seen.plainSignInBehindHttps = true;
    await sessions.savePendingLogin(state, login);
    res.append(
      'Set-Cookie',
      serializeCookie(cookieName(LOGIN_COOKIE, req.secure), state, {
        secure: req.secure,
        path: loginCookiePath(req.secure),
        maxAgeS: LOGIN_TTL_S,
      }),
    );
    return { url: await client.authorizationUrl({ ...login, state }) };
  }

  /**
   * Completes a sign-in: the state must be the one this browser started, the code
   * is exchanged, the ID token checked (issuer, audience, nonce), and a fresh
   * session opened.
   */
  @Public()
  @Post('callback')
  @HttpCode(200)
  @ApiOkResponse({ type: OidcSignedInDto })
  @ApiUnauthorizedResponse({ description: 'auth.login_failed — the sign-in cannot be completed.' })
  async callback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: OidcCallbackDto,
  ): Promise<OidcSignedInDto> {
    const { client, sessions, provider } = this.oidc();
    res.append(
      'Set-Cookie',
      serializeCookie(cookieName(LOGIN_COOKIE, req.secure), '', {
        secure: req.secure,
        path: loginCookiePath(req.secure),
        maxAgeS: 0,
      }),
    );
    if (readOurCookie(req.headers.cookie, LOGIN_COOKIE) !== dto.state) {
      throw new UnauthorizedException('auth.login_failed');
    }
    const login = await sessions.takePendingLogin(dto.state);
    if (!login || (dto.iss && dto.iss !== client.settings.issuer)) {
      throw new UnauthorizedException('auth.login_failed');
    }
    try {
      const tokens = await client.exchangeCode(dto.code, login.codeVerifier, login.redirectUri);
      if (!tokens.idToken) throw new Error('No ID token.');
      await client.verifyIdToken(tokens.idToken, login.nonce);
      const principal = provider.principalOf(await client.verifyAccessToken(tokens.accessToken));
      if (!principal) throw new Error('No subject in the access token.');
      await this.users.upsertFromPrincipal(principal);
      // A new session on every sign-in, whatever the browser held before.
      const previous = readOurCookie(req.headers.cookie, SESSION_COOKIE);
      if (previous) await sessions.destroy(previous);
      const sid = await sessions.create(principal.sub, tokens);
      res.append(
        'Set-Cookie',
        serializeCookie(cookieName(SESSION_COOKIE, req.secure), sid, { secure: req.secure }),
      );
      return { name: principal.displayName };
    } catch (err) {
      // The reason stays in the log: the browser only learns that it failed.
      this.logger.warn(`Sign-in failed: ${(err as Error).message}`);
      throw new UnauthorizedException('auth.login_failed');
    }
  }

  /** Ends the session here and returns the provider's end-session address, if it has one. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthRedirectDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthRedirectDto> {
    const { client, sessions } = this.oidc();
    const sid = readOurCookie(req.headers.cookie, SESSION_COOKIE);
    const ended = sid ? await sessions.destroy(sid) : null;
    // Both names go: the prefixed one, and a bare one set before the prefix.
    for (const name of new Set([cookieName(SESSION_COOKIE, req.secure), SESSION_COOKIE])) {
      res.append('Set-Cookie', serializeCookie(name, '', { secure: req.secure, maxAgeS: 0 }));
    }
    const url = await client
      .endSessionUrl(ended?.idToken ?? null, appOrigin(req))
      .catch(() => null);
    return { url };
  }
}
