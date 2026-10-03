import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppConfigController, ICONS } from './app-config/app-config.controller';
import { AuthModule } from './auth/auth.module';
import { DemoModule } from './demo/demo.module';
import { GameModule } from './game/game.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { SlidesModule } from './slides/slides.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { StoreModule } from './store/store.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from './admin/settings/settings.service';
import { AdminHttpModule } from './admin/http/admin-http.module';

/**
 * En image unique (front+back), `CLIENT_DIR` pointe le SPA buildé : le backend
 * sert le statique + le fallback `index.html` (routing client). Tout ce qui n'est
 * PAS du SPA est exclu pour atteindre les vrais handlers : API (`/api/v1`, swagger
 * `/api/docs`), `/health`, le WebSocket `/socket.io`, et `/config.js` (contrôleur
 * white-label runtime). En dev, `CLIENT_DIR` est absent → le SPA passe par Vite.
 */
const clientDir = settings.get(SETTINGS.CLIENT_DIR);
const serveStatic = clientDir
  ? [
      ServeStaticModule.forRoot({
        rootPath: clientDir,
        exclude: [
          '/api/{*splat}',
          '/api',
          '/health',
          '/health/ready',
          '/config.js',
          '/branding/override.css',
          ...ICONS.map((icon) => `/${icon}`),
          '/manifest.webmanifest',
          '/socket.io/{*splat}',
          '/socket.io',
        ],
        serveStaticOptions: {
          index: 'index.html',
          // Hashed built files are kept for good; the rest (the page itself) is
          // asked again, so a new version reaches the browser.
          setHeaders: (res, path) =>
            res.setHeader(
              'Cache-Control',
              /[/\\]assets[/\\]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
            ),
        },
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
    StoreModule,
    QuestionsModule,
    SlidesModule,
    MediaModule,
    GameModule,
    DemoModule,
    AdminHttpModule,
  ],
  controllers: [HealthController, MeController, AppConfigController],
  providers: [],
})
export class AppModule {}
