import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActiveGameDto } from './dto/active-game.dto';
import { GameEngine } from './game.engine';
import { GameService } from './game.service';

/**
 * API REST des parties live (complète le gateway WebSocket). Sert au dashboard à
 * retrouver les parties en cours d'un hôte pour les reprendre (§6.2) — ou les arrêter.
 */
@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GameController {
  constructor(
    private readonly games: GameService,
    private readonly engine: GameEngine,
  ) {}

  /** Parties encore vivantes de l'hôte courant (index Redis auto-nettoyé). */
  @Get('mine')
  @ApiOkResponse({ type: ActiveGameDto, isArray: true })
  mine(@CurrentUser() user: User): Promise<ActiveGameDto[]> {
    return this.games.listActiveHostGames(user.id);
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
