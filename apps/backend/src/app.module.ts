import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppConfigController } from './app-config/app-config.controller';
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

/**
 * En image unique (front+back), `CLIENT_DIR` pointe le SPA buildé : le backend
 * sert le statique + le fallback `index.html` (routing client). Tout ce qui n'est
 * PAS du SPA est exclu pour atteindre les vrais handlers : API (`/api/v1`, swagger
 * `/api/docs`), `/health`, le WebSocket `/socket.io`, et `/config.js` (contrôleur
 * white-label runtime). En dev, `CLIENT_DIR` est absent → le SPA passe par Vite.
 */
const serveStatic = process.env.CLIENT_DIR
  ? [
      ServeStaticModule.forRoot({
        rootPath: process.env.CLIENT_DIR,
        exclude: [
          '/api/{*splat}',
          '/api',
          '/health',
          '/config.js',
          '/socket.io/{*splat}',
          '/socket.io',
        ],
        serveStaticOptions: { index: 'index.html' },
      }),
    ]
  : [];

@Module({
  imports: [
    ...serveStatic,
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    QuizzesModule,
    QuestionsModule,
    MediaModule,
    GameModule,
  ],
  controllers: [HealthController, MeController, AppConfigController],
  providers: [],
})
export class AppModule {}
