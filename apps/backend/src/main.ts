import 'reflect-metadata';
import { configureTextQuizBodyParser } from './quizzes/portable/text-quiz-body-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { isOidcMode } from './auth/auth-mode';
import { sameOriginMiddleware } from './auth/oidc/same-origin.middleware';
import { cspMiddleware } from './common/csp';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { trustProxy } from './common/trust-proxy';
import { buildSwaggerDocument } from './swagger';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from './admin/settings/settings.service';
import { SetupService } from './admin/setup/setup.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  // Which hops may speak for the client (`X-Forwarded-For`, `X-Forwarded-Proto`):
  // `req.ip` and `req.secure` follow `TRUST_PROXY`, like the sockets.
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy());
  app.enableCors();
  configureTextQuizBodyParser(app);
  // The pages say where their scripts, styles, frames and requests may come from.
  app.use(cspMiddleware());
  // The browser session is a cookie: what changes something comes from our own pages.
  if (isOidcMode()) app.use(sameOriginMiddleware());
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'config.js', 'branding/override.css'] });
  // Validation runtime des DTO Zod (createZodDto) sur toutes les routes.
  app.useGlobalPipes(new ZodValidationPipe());
  // Sérialise les erreurs en corps tokenisé { code, params? } (ADR 0001).
  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI auto-généré → consommé par Orval côté frontend (technique §2.3).
  const document = buildSwaggerDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  // What the operator should know about the configuration (also listed by `qd doctor`).
  for (const issue of settings.issues()) Logger.warn(issue.message, 'Settings');
  // A fresh instance: the setup wizard's token, in the logs (§3.8).
  await app.get(SetupService).announce();

  const port = settings.get(SETTINGS.PORT);
  await app.listen(port, '0.0.0.0');
  Logger.log(`QuizDock API démarrée sur le port ${port}`, 'Bootstrap');
}

void bootstrap();
