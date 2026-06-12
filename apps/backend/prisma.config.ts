import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Source de vérité unique : le `.env` à la racine du monorepo (ports + creds).
// (Prisma 7 ne charge plus le .env automatiquement dès qu'un prisma.config.ts existe.)
loadEnv({ path: '../../.env' });

// DATABASE_URL **dérivée** des variables Postgres centralisées — jamais dupliquée.
// Hôte (CLI Prisma) → localhost:${POSTGRES_PORT}. En conteneur, compose fournit déjà
// DATABASE_URL (postgres:5432 interne) et garde donc la priorité. Les valeurs par
// défaut sont alignées sur docker-compose.
if (!process.env.DATABASE_URL) {
  const user = process.env.POSTGRES_USER ?? 'roux';
  const password = process.env.POSTGRES_PASSWORD ?? 'roux';
  const db = process.env.POSTGRES_DB ?? 'rouxquizz';
  const port = process.env.POSTGRES_PORT ?? '45432';
  process.env.DATABASE_URL = `postgresql://${user}:${password}@localhost:${port}/${db}?schema=public`;
}

// Prisma 7 : l'URL de connexion ne vit plus dans schema.prisma. Elle est fournie
// ici pour les commandes Migrate/Introspect (le client runtime, lui, passe par un
// driver adapter — voir PrismaService).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
  },
  // Requis pour `extensions = [citext]` dans le schéma (postgresqlExtensions).
  experimental: {
    extensions: true,
  },
});
