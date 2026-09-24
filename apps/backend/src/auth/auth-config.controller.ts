import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DEMO_USER, isDemoMode } from '../demo/demo.config';
import { allowsAnonymousParticipants, authMode } from './auth-mode';
import { AuthConfigDto } from './dto/auth-config.dto';
import { Public } from './public.decorator';

/** Expose la config d'auth à la SPA (publique, pas de JWT requis). */
@ApiTags('auth')
@Controller('auth')
export class AuthConfigController {
  @Public()
  @Get('config')
  @ApiOkResponse({ type: AuthConfigDto })
  config(): AuthConfigDto {
    const mode = authMode();
    return {
      mode,
      demo: isDemoMode() ? { user: DEMO_USER } : null,
      standalone: process.env.QUIZDOCK_FLAVOR === 'standalone',
      anonymousParticipants: allowsAnonymousParticipants(),
      oidc:
        mode === 'oidc'
          ? {
              authority: process.env.OIDC_ISSUER ?? '',
              clientId: process.env.OIDC_CLIENT_ID ?? 'quiz-dock-frontend',
              sessionScope: process.env.OIDC_SESSION_SCOPE === 'tab' ? 'tab' : 'browser',
            }
          : null,
    };
  }
}
