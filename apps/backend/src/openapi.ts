import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildSwaggerDocument } from './swagger';

/**
 * Génère le document OpenAPI dans `openapi/openapi.json` SANS démarrer de serveur.
 * Source de vérité du client REST régénéré par Orval (cf. `pnpm generate:api`).
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const document = buildSwaggerDocument(app);
  mkdirSync('openapi', { recursive: true });
  writeFileSync('openapi/openapi.json', `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

void generate();
