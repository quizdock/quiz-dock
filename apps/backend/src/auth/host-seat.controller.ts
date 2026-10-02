import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { HostSeatService, type HostSeatState } from '../users/host-seat.service';
import { AllowAnyRole } from './allow-any-role.decorator';
import { CurrentUser } from './current-user.decorator';
import { ClaimHostSeatDto, HostSeatDto, HostSeatReleaseDto } from './dto/host-seat.dto';
import { Public } from './public.decorator';
import { isOidcMode } from './auth-mode';

const toDto = (s: HostSeatState): HostSeatDto => ({
  holder: s.holder,
  expiresAt: s.expiresAt?.toISOString() ?? null,
  claimedAt: s.claimedAt?.toISOString() ?? null,
});

/**
 * Local-mode host seat (`AUTH_MODE=none`): who holds it, an explicit claim (the
 * SPA asks for confirmation first), and a release (called on log out).
 */
@ApiTags('auth')
@Controller('auth/host-seat')
export class HostSeatController {
  constructor(private readonly seat: HostSeatService) {}

  @Public()
  @Get()
  @ApiOkResponse({ type: HostSeatDto })
  async state(): Promise<HostSeatDto> {
    if (isOidcMode()) return { holder: null, expiresAt: null, claimedAt: null };
    return toDto(await this.seat.state());
  }

  @AllowAnyRole()
  @ApiBearerAuth()
  @Post('claim')
  @HttpCode(200)
  @ApiOkResponse({ type: HostSeatDto })
  @ApiConflictResponse({ description: 'host_seat.taken — another local user holds the seat.' })
  async claim(@CurrentUser() user: User, @Body() dto: ClaimHostSeatDto): Promise<HostSeatDto> {
    return toDto(await this.seat.claim(user, dto.expiresInMinutes ?? null));
  }

  @AllowAnyRole()
  @ApiBearerAuth()
  @Post('release')
  @HttpCode(200)
  @ApiOkResponse({ type: HostSeatReleaseDto })
  async release(@CurrentUser() user: User): Promise<HostSeatReleaseDto> {
    return { released: await this.seat.release(user) };
  }
}
