import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GameGateway } from './game.gateway';

@Module({
  imports: [AuthModule, UsersModule],
  providers: [GameGateway],
})
export class GameModule {}
