import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, QuizzesModule, QuestionsModule, MediaModule],
  controllers: [HealthController, MeController],
  providers: [],
})
export class AppModule {}
