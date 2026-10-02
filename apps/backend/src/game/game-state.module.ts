import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { GameService } from './game.service';

/**
 * The games' state in Redis, without their transport: the game module plays
 * them over its socket gateway; the administration (and `qd`, which has no
 * socket server) only reads them.
 */
@Module({
  imports: [MediaModule],
  providers: [GameService],
  exports: [GameService],
})
export class GameStateModule {}
