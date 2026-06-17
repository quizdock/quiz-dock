import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActiveGameDto } from './dto/active-game.dto';
import { GameService } from './game.service';

/**
 * API REST des parties live (complète le gateway WebSocket). Sert au dashboard à
 * retrouver les parties en cours d'un hôte pour les reprendre (§6.2).
 */
@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GameController {
  constructor(private readonly games: GameService) {}

  /** Parties encore vivantes de l'hôte courant (index Redis auto-nettoyé). */
  @Get('mine')
  @ApiOkResponse({ type: ActiveGameDto, isArray: true })
  mine(@CurrentUser() user: User): Promise<ActiveGameDto[]> {
    return this.games.listActiveHostGames(user.id);
  }
}
