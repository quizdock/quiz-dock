import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 : l'URL de connexion ne vit plus dans schema.prisma. Elle est fournie
// ici pour les commandes Migrate/Introspect (le client runtime, lui, passe par un
// driver adapter — voir PrismaService). `dotenv/config` charge apps/backend/.env
// (Prisma 7 ne le fait plus automatiquement dès qu'un prisma.config.ts existe).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  // `process.env` (et non le helper `env()`) : il ne faut PAS exiger DATABASE_URL,
  // car `prisma generate` (postinstall, CI, build Docker) charge ce fichier sans
  // base. Les commandes Migrate reçoivent l'URL via .env (dotenv) ou compose.
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
