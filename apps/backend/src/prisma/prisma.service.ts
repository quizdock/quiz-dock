import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma exposé en injection NestJS.
 *
 * Prisma 7 utilise le « query compiler » : la connexion runtime passe
 * obligatoirement par un driver adapter (ici `@prisma/adapter-pg`), et non plus
 * par une `url` dans le schéma. La même `DATABASE_URL` sert à la CLI Migrate via
 * prisma.config.ts.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL est requis pour initialiser le client Prisma.');
    }
    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit(): Promise<void> {
    // La génération OpenAPI instancie AppModule sans base (CI sans Postgres) :
    // on saute la connexion dans ce cas (cf. openapi.ts).
    if (process.env.PRISMA_SKIP_CONNECT === '1') {
      return;
    }
    await this.$connect();
    this.logger.log('Connexion PostgreSQL établie (Prisma).');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
