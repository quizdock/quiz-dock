import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GameEngine } from './game.engine';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

// PrismaModule / RedisModule sont @Global → injectables sans réimport.
@Module({
  imports: [AuthModule, UsersModule],
  providers: [GameGateway, GameService, GameEngine],
})
export class GameModule {}
