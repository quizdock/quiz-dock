import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AllowAnyRole } from '../auth/allow-any-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { MeResponseDto } from './me-response.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
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
}
