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
  // La génération du document n'a pas besoin de base : on fournit une URL de
  // repli (sinon PrismaService refuse de s'instancier) et on coupe la connexion
  // Prisma — la CI génère l'OpenAPI sans Postgres.
  process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
  process.env.PRISMA_SKIP_CONNECT = '1';

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const document = buildSwaggerDocument(app);
  mkdirSync('openapi', { recursive: true });
  writeFileSync('openapi/openapi.json', `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

void generate();
