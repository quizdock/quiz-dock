import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { buildSwaggerDocument } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  app.enableCors();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // Validation runtime des DTO Zod (createZodDto) sur toutes les routes.
  app.useGlobalPipes(new ZodValidationPipe());
  // Sérialise les erreurs en corps tokenisé { code, params? } (ADR 0001).
  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI auto-généré → consommé par Orval côté frontend (technique §2.3).
  const document = buildSwaggerDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`QuizDock API démarrée sur le port ${port}`, 'Bootstrap');
}

void bootstrap();
