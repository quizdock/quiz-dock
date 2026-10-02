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
import { PresetsOperations } from './operations/presets.operations';
import { QuizzesOperations } from './operations/quizzes.operations';
import { PresetService } from './presets/preset.service';
import { SetupOperations, WIZARD_OPERATIONS } from './operations/setup.operations';
import { SetupService } from './setup/setup.service';
import type { AdminOperation } from './operations/operation';
import { SettingsOperations } from './operations/settings.operations';
import { StatsOperations } from './operations/stats.operations';
import { AccountsOperations } from './operations/accounts.operations';
import { GameStateModule } from '../game/game-state.module';
import { type ConfirmationStore, RedisConfirmationStore } from './runner/confirmations';
import { OperationRunner } from './runner/operation-runner';
import { OverridesService } from './settings/overrides.service';
import { settings } from './settings/settings.service';

/** Every group of operations: the registry, reviewed in one place (§3.2, no discovery). */
const OPERATION_GROUPS = [
  CliCommandOperations,
  SettingsOperations,
  QuizzesOperations,
  PresetsOperations,
  SetupOperations,
  MediaOperations,
  StatsOperations,
  AccountsOperations,
];

/**
 * The administration's core (§3.4): the operations, the runner and its
 * stores. The accesses — `qd`, the admin API — sit on top of it.
 */
@Module({
  imports: [UsersModule, QuizzesModule, MediaModule, GameStateModule],
  providers: [
    OverridesService,
    PresetService,
    SetupService,
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
      useFactory: (...groups: { list(): AdminOperation[] }[]) =>
        groups
          .flatMap((g) => g.list())
          .map((op) => (WIZARD_OPERATIONS.has(op.id) ? { ...op, wizard: true } : op)),
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
  exports: [OperationRunner, AUDIT_REPOSITORY, OverridesService, SetupService],
})
export class AdminModule {}
