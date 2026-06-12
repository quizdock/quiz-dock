import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
    const mode = process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'none';
    return {
      mode,
      oidc:
        mode === 'oidc'
          ? {
              authority: process.env.OIDC_ISSUER ?? '',
              clientId: process.env.OIDC_CLIENT_ID ?? 'roux-quizz-frontend',
            }
          : null,
    };
  }
}
