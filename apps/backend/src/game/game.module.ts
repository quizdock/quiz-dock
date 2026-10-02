import { MediaModule } from '../media/media.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GameController } from './game.controller';
import { GameEngine } from './game.engine';
import { GameGateway } from './game.gateway';
import { GameStateModule } from './game-state.module';
import { PinAttempts } from './pin-attempts';
import { SessionArchiveService } from './session-archive.service';

// PrismaModule / RedisModule sont @Global → injectables sans réimport.
@Module({
  imports: [AuthModule, UsersModule, MediaModule, GameStateModule],
  controllers: [GameController],
  providers: [GameGateway, GameEngine, SessionArchiveService, PinAttempts],
})
export class GameModule {}
