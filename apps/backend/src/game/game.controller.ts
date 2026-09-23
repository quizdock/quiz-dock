import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type User, UserRole } from '@prisma/client';
import { AllowManager } from '../auth/allow-manager.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActiveGameDto } from './dto/active-game.dto';
import { JoinAddressesDto } from './dto/join-addresses.dto';
import { GameEngine } from './game.engine';
import { GameService } from './game.service';

/**
 * API REST des parties live (complète le gateway WebSocket). Sert au dashboard à
 * retrouver les parties en cours d'un hôte pour les reprendre (§6.2) — ou les arrêter.
 */
const DOCKER_BRIDGE = /^172\.(1[7-9]|2\d|3[01])\./;

@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GameController {
  constructor(
    private readonly games: GameService,
    private readonly engine: GameEngine,
  ) {}

  /**
   * Parties encore vivantes (index Redis auto-nettoyé) : **les siennes** pour un
   * hôte, **celles de l'instance** pour un `admin`, qui est le seul à avoir la
   * vue d'ensemble (RG-14). Les entrées disent alors de quel hôte elles sont.
   */
  @Get('mine')
  @AllowManager()
  @ApiOkResponse({ type: ActiveGameDto, isArray: true })
  mine(@CurrentUser() user: User): Promise<ActiveGameDto[]> {
    return user.role === UserRole.admin
      ? this.games.listAllActiveGames()
      : this.games.listActiveHostGames(user.id);
  }

  /**
   * Addresses the invitations may point at: `APP_PUBLIC_URL` when configured
   * (a real deployment), and the machine's LAN IPv4 addresses — `HOST_LAN_IPS`
   * when set, else the host's interfaces. Bare IPs: the browser knows the
   * scheme and port it reached the app through (a proxy or Vite rewrites the
   * Host header, so this side cannot). `lanSource: hidden` tells the console
   * the process only sees a container bridge (Docker Desktop, bridge network).
   */
  @Get('join-addresses')
  @ApiOkResponse({ type: JoinAddressesDto })
  joinAddresses(): JoinAddressesDto {
    const publicUrl = (process.env.APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
    const configured = (process.env.HOST_LAN_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (configured.length) {
      return {
        publicUrl: publicUrl || null,
        lanIps: [...new Set(configured)],
        lanSource: 'configured',
      };
    }
    const detected = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      // Docker's default bridge pools (172.17–172.31) are not a LAN anyone can reach.
      .filter((i) => i.family === 'IPv4' && !i.internal && !DOCKER_BRIDGE.test(i.address))
      .map((i) => i.address);
    return {
      publicUrl: publicUrl || null,
      lanIps: [...new Set(detected)],
      lanSource: detected.length ? 'detected' : 'hidden',
    };
  }

  /**
   * Termine une partie (depuis le dashboard, sans socket de contrôle). Réservé à
   * l'hôte propriétaire — `engine.end` refuse les autres. Diffuse `game:ended` à la
   * room et purge l'état (le PIN sort de l'index des parties en cours).
   */
  @Post(':pin/end')
  @HttpCode(204)
  @ApiNoContentResponse()
  end(@CurrentUser() user: User, @Param('pin') pin: string): Promise<void> {
    return this.engine.end(pin, user.id);
  }
}
