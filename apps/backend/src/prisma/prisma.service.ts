import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

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
    const connectionString = settings.get(SETTINGS.DATABASE_URL);
    if (!connectionString) {
      throw new Error('DATABASE_URL est requis pour initialiser le client Prisma.');
    }
    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit(): Promise<void> {
    // La génération OpenAPI instancie AppModule sans base (CI sans Postgres) :
    // on saute la connexion dans ce cas (cf. openapi.ts).
    if (settings.get(SETTINGS.PRISMA_SKIP_CONNECT)) {
      return;
    }
    await this.$connect();
    this.logger.log('Connexion PostgreSQL établie (Prisma).');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
