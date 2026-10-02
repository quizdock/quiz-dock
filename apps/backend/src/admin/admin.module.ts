import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaModule } from '../media/media.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { RedisService } from '../redis/redis.service';
import { UsersModule } from '../users/users.module';
import { ADMIN_OPERATIONS, AUDIT_REPOSITORY, CONFIRMATION_STORE } from './admin.tokens';
import { type AuditRepository, PrismaAuditRepository } from './audit/audit.repository';
import { CliCommandOperations } from './operations/cli-commands.operations';
import { MediaOperations } from './operations/media.operations';
import type { AdminOperation } from './operations/operation';
import { SettingsOperations } from './operations/settings.operations';
import { type ConfirmationStore, RedisConfirmationStore } from './runner/confirmations';
import { OperationRunner } from './runner/operation-runner';
import { settings } from './settings/settings.service';

/** Every group of operations: the registry, reviewed in one place (§3.2, no discovery). */
const OPERATION_GROUPS = [CliCommandOperations, SettingsOperations, MediaOperations];

/**
 * The administration's core (§3.4): the operations, the runner and its
 * stores. The accesses — `qd`, the admin API — sit on top of it.
 */
@Module({
  imports: [UsersModule, QuizzesModule, MediaModule],
  providers: [
    ...OPERATION_GROUPS,
    {
      provide: AUDIT_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaAuditRepository(prisma),
    },
    {
      provide: CONFIRMATION_STORE,
      inject: [RedisService],
      useFactory: (redis: RedisService) => new RedisConfirmationStore(redis),
    },
    {
      provide: ADMIN_OPERATIONS,
      inject: OPERATION_GROUPS,
      useFactory: (...groups: { list(): AdminOperation[] }[]) => groups.flatMap((g) => g.list()),
    },
    {
      provide: OperationRunner,
      inject: [ADMIN_OPERATIONS, AUDIT_REPOSITORY, CONFIRMATION_STORE],
      useFactory: (
        ops: AdminOperation[],
        audit: AuditRepository,
        confirmations: ConfirmationStore,
      ) => new OperationRunner(ops, settings, audit, confirmations),
    },
  ],
  exports: [OperationRunner, AUDIT_REPOSITORY],
})
export class AdminModule {}
