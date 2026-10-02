import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DEMO_USER, isDemoMode } from '../demo/demo.config';
import { allowsAnonymousParticipants, authMode } from './auth-mode';
import { AuthConfigDto } from './dto/auth-config.dto';
import { communityRegistries } from '../store/community/community-config';
import { Public } from './public.decorator';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

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
      communityStore: communityRegistries().length > 0,
      demo: isDemoMode() ? { user: DEMO_USER } : null,
      standalone: settings.get(SETTINGS.QUIZDOCK_FLAVOR) === 'standalone',
      anonymousParticipants: allowsAnonymousParticipants(),
    };
  }
}
