import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { UserPreferences } from '@quiz-dock/contracts';
import { AllowAnyRole } from '../auth/allow-any-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PreferencesService } from '../users/preferences.service';
import { MeResponseDto } from './me-response.dto';
import { UpdatePreferencesDto, UserPreferencesDto } from './preferences.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly preferences: PreferencesService) {}

  /** Profil de l'utilisateur courant (provisionné par AuthGuard) — tout rôle. */
  @Get()
  @AllowAnyRole()
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() user: User): MeResponseDto {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      roles: user.roles,
      subject: user.oidcSubject,
    };
  }

  /** What the account remembers wherever it signs in — any role. */
  @Get('preferences')
  @AllowAnyRole()
  @ApiOkResponse({ type: UserPreferencesDto })
  getPreferences(@CurrentUser() user: User): Promise<UserPreferences> {
    return this.preferences.get(user.id);
  }

  /** Changes some of them: a key left out is kept, `null` goes back to the default. */
  @Patch('preferences')
  @AllowAnyRole()
  @ApiOkResponse({ type: UserPreferencesDto })
  updatePreferences(
    @CurrentUser() user: User,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<UserPreferences> {
    return this.preferences.update(user.id, dto);
  }
}
