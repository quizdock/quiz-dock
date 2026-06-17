import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GameController } from './game.controller';
import { GameEngine } from './game.engine';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

// PrismaModule / RedisModule sont @Global → injectables sans réimport.
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [GameController],
  providers: [GameGateway, GameService, GameEngine],
})
export class GameModule {}
