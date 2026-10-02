import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';

/**
 * Admin CLI context: only what the commands need. Deliberately NOT `AppModule`,
 * which would spin up the game gateway (Socket.IO) and static serving. Redis is
 * here because `QuizzesService` (a live quiz cannot be deleted) needs the client;
 * an unreachable Redis only logs, the commands still run.
 */
@Module({
  imports: [PrismaModule, RedisModule, UsersModule, QuizzesModule, AdminModule],
})
export class CliModule {}
