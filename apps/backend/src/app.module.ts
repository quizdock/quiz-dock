import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    QuizzesModule,
    QuestionsModule,
    MediaModule,
    GameModule,
  ],
  controllers: [HealthController, MeController],
  providers: [],
})
export class AppModule {}
