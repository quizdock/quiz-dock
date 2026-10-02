import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SETTINGS } from '@quiz-dock/contracts';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AUTH_PROVIDER, type AuthProvider } from '../../auth/auth-provider';
import { Public } from '../../auth/public.decorator';
import { UsersService } from '../../users/users.service';
import { OperationRunner } from '../runner/operation-runner';
import { settings } from '../settings/settings.service';
import { SetupLockedError, SetupService } from '../setup/setup.service';
import { OperationAnswerDto, RunOperationDto } from './admin-operations.dto';
import { refusalError } from './outcome-http';

class SetupStatusDto extends createZodDto(
  z.object({
    open: z.boolean(),
    authMode: z.enum(['none', 'oidc']),
    /** OIDC: the wizard needs a signed-in account. */
    signedIn: z.boolean(),
  }),
) {}

class SetupTokenDto extends createZodDto(z.object({ token: z.string().min(1).max(128) })) {}
class SetupSessionDto extends createZodDto(z.object({ session: z.string() })) {}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The setup wizard's access (§3.8): before any administrator exists, the setup
 * token opens a session, and the session runs the wizard's operations through
 * the same runner — validated, confirmed, audited. With OIDC, a signed-in
 * account too.
 */
@ApiTags('setup')
@Public()
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly runner: OperationRunner,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly users: UsersService,
  ) {}

  /** The account signed in, when there is one (the wizard's routes are public). */
  private async account(req: Request) {
    const principal = await this.auth.authenticate(req).catch(() => null);
    return principal ? this.users.upsertFromPrincipal(principal) : null;
  }

  @Get('status')
  @ApiOkResponse({ type: SetupStatusDto })
  async status(@Req() req: Request): Promise<SetupStatusDto> {
    const authMode = settings.get(SETTINGS.AUTH_MODE);
    return {
      open: !(await this.setup.completed()),
      authMode,
      signedIn: authMode === 'oidc' ? (await this.account(req)) !== null : true,
    };
  }

  /** The setup token, for a wizard session (the token is spent). */
  @Post('session')
  @HttpCode(200)
  @ApiOkResponse({ type: SetupSessionDto })
  async session(@Req() req: Request, @Body() body: SetupTokenDto): Promise<SetupSessionDto> {
    let session: string | null;
    try {
      session = await this.setup.open(body.token.trim(), req.ip ?? 'unknown');
    } catch (err) {
      if (err instanceof SetupLockedError) {
        throw new HttpException({ code: 'setup.too_many_attempts' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }
    if (!session) throw new HttpException({ code: 'setup.token_invalid' }, HttpStatus.FORBIDDEN);
    return { session };
  }

  /** One of the wizard's operations, under its session. */
  @Post('operations/:id')
  @HttpCode(200)
  @ApiOkResponse({ type: OperationAnswerDto })
  async run(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RunOperationDto,
  ): Promise<OperationAnswerDto> {
    const header = req.headers['x-setup-session'];
    if (!(await this.setup.session(typeof header === 'string' ? header : undefined))) {
      throw new HttpException({ code: 'setup.session_invalid' }, HttpStatus.FORBIDDEN);
    }
    const user = await this.account(req);
    if (settings.get(SETTINGS.AUTH_MODE) === 'oidc' && !user) {
      throw new HttpException({ code: 'auth.required' }, HttpStatus.UNAUTHORIZED);
    }
    const outcome = await this.runner.run({
      id,
      raw: body.params ?? {},
      actor: {
        via: 'api',
        setup: true,
        name: user ? `${user.displayName} (setup)` : 'setup wizard',
        userId: user?.id,
        roles: user?.roles,
        address: req.ip,
      },
      dryRun: body.dryRun,
      confirmation: body.confirmation,
    });
    if (outcome.kind === 'refused') throw refusalError(outcome);
    return outcome;
  }

  /**
   * The page a phone opens in the phone test (§3.8): reaching it is the test. A
   * page of its own, without the application: it must load on any phone.
   */
  @Get('phone/:id')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async phone(@Req() req: Request, @Param('id') id: string): Promise<string> {
    const ok = await this.setup.reached(id, String(req.headers['user-agent'] ?? ''));
    const name = escape(settings.get(SETTINGS.APP_NAME) || 'QuizDock');
    const [title, text] = ok
      ? ['✓', 'This phone reaches the instance: the participants will reach it the same way.']
      : ['✗', 'This test is over or unknown: start a new one from the administration.'];
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem"><p style="font-size:4rem;margin:0">${title}</p><h1 style="font-size:1.25rem">${name}</h1><p>${text}</p></body></html>`;
  }
}
