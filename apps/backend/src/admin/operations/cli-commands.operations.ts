import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { isManager } from '../../auth/roles';
import { defaultPingRedis, defaultProbeWritable, doctor } from '../../cli/commands/doctor';
import { migrationStatus } from '../../cli/commands/migrate-status';
import { findUser, samplesLoad, userList, userSetRole } from '../../cli/commands/users';
import { quizImport, quizList, quizTransfer } from '../../cli/commands/quiz';
import { seatRelease, seatStatus } from '../../cli/commands/seat';
import { sessionsPurge } from '../../cli/commands/sessions';
import { type OutputEntry, RecordingOutput } from '../../cli/output';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizPortableService } from '../../quizzes/portable/quiz-portable.service';
import { SampleQuizzesService } from '../../quizzes/samples/sample-quizzes.service';
import { RedisService } from '../../redis/redis.service';
import { HostSeatService } from '../../users/host-seat.service';
import { settings } from '../settings/settings.service';
import { type AdminOperation, OperationError, defineOperation } from './operation';

/** What a command printed, as the operation's data. */
export interface PrintedData {
  output: OutputEntry[];
}

/** Runs a command that prints, keeping what it prints. */
async function printed(
  command: (out: RecordingOutput) => Promise<unknown>,
): Promise<{ data: PrintedData; value: unknown }> {
  const out = new RecordingOutput();
  const value = await command(out);
  return { data: { output: out.entries }, value };
}

const who = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .describe('An account: its subject (local:<name> in local mode) or e-mail');
const ROLES = ['host', 'admin', 'host,admin', 'admin,host', 'player'] as const;

/**
 * The commands `qd` had before the runner, as operations (§3.2): the same
 * code, the same results, what they print kept as data.
 */
@Injectable()
export class CliCommandOperations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly seat: HostSeatService,
    private readonly samples: SampleQuizzesService,
    private readonly portable: QuizPortableService,
  ) {}

  list(): AdminOperation[] {
    const { prisma } = this;
    return [
      defineOperation({
        id: 'health.doctor',
        domain: 'instance',
        category: 'health',
        effect: 'read',
        summary:
          'Checks the configuration, the database, the migrations, Redis, the folders and the identity provider.',
        params: z.object({}),
        run: async () => {
          const { data, value } = await printed((out) =>
            doctor(out, {
              prisma,
              settings,
              fetch,
              pingRedis: defaultPingRedis,
              probeWritable: defaultProbeWritable,
            }),
          );
          return { outcome: value ? 'done' : 'partial', notes: [], data };
        },
      }),
      defineOperation({
        id: 'migrations.status',
        domain: 'instance',
        category: 'health',
        effect: 'read',
        summary: 'Lists the applied, pending and failed database migrations.',
        params: z.object({}),
        run: async () => {
          const status = await migrationStatus(prisma);
          const out = new RecordingOutput();
          out.line(`Applied (${status.applied.length}):`);
          for (const m of status.applied) out.ok(m);
          out.line(`Pending (${status.pending.length}):`);
          for (const m of status.pending) out.warn(m);
          if (status.failed.length) {
            out.line(`Failed (${status.failed.length}):`);
            for (const m of status.failed) out.fail(m);
          }
          return {
            outcome: status.pending.length || status.failed.length ? 'partial' : 'done',
            notes: [],
            data: { ...status, output: out.entries },
          };
        },
      }),
      defineOperation({
        id: 'seat.status',
        domain: 'instance',
        category: 'users',
        effect: 'read',
        summary: 'Shows who holds the local-mode host seat.',
        params: z.object({}),
        run: async () => ({
          outcome: 'done',
          notes: [],
          ...(await printed((out) => seatStatus(out, this.seat))),
        }),
      }),
      defineOperation({
        id: 'seat.release',
        domain: 'instance',
        category: 'users',
        effect: 'write',
        summary: 'Frees the local-mode host seat, whoever holds it.',
        params: z.object({}),
        run: async () => {
          const { data } = await printed((out) => seatRelease(out, this.seat));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'users.list',
        domain: 'instance',
        category: 'users',
        effect: 'read',
        summary: 'Lists the accounts: name, subject, e-mail, roles, quizzes.',
        params: z.object({}),
        run: async () => {
          const { data } = await printed((out) => userList(out, prisma));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'users.set-role',
        domain: 'instance',
        category: 'users',
        effect: 'write',
        summary: 'Grants host, admin or both to an account; player revokes the grant.',
        params: z.object({
          user: who,
          roles: z.enum(ROLES).describe('host, admin, host,admin, or player to revoke'),
        }),
        confirmation: ({ user, roles }) =>
          roles.includes('admin') || roles === 'player'
            ? `Change the administrator rights of ${user} (${roles}).`
            : null,
        run: async (ctx, { user, roles }) => {
          const target = await findUser(prisma, user);
          // No lock-out (§3.10): the last administrator keeps the role.
          if (!roles.includes('admin') && isManager(target.roles)) {
            const admins = await prisma.user.count({ where: { roles: { has: UserRole.admin } } });
            if (admins <= 1 && ctx.actor.via === 'api') {
              throw new OperationError('conflict', 'The last administrator cannot lose the role.');
            }
          }
          const { data } = await printed((out) => userSetRole(out, prisma, user, roles));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'samples.load',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'write',
        summary: "Adds the built-in sample quizzes to an account's bank.",
        params: z.object({ user: who }),
        run: async (_ctx, { user }) => {
          const { data } = await printed((out) => samplesLoad(out, prisma, this.samples, user));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'quizzes.list',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'read',
        summary: "Lists every quiz, or one account's: id, title, owner, status.",
        params: z.object({ owner: who.optional() }),
        run: async (_ctx, { owner }) => {
          const { data } = await printed((out) => quizList(out, prisma, owner));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'quizzes.transfer',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'write',
        summary:
          'Hands a quiz over to another account; the media only it uses and its history follow.',
        params: z.object({ quiz: z.string().trim().min(1).max(64), to: who }),
        run: async (_ctx, { quiz, to }) => {
          const { data } = await printed((out) => quizTransfer(out, prisma, this.redis, quiz, to));
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'quizzes.export',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'read',
        summary: 'Exports a quiz as a bundle (zip: quiz.json and its media), whoever owns it.',
        params: z.object({ quiz: z.string().trim().min(1).max(64) }),
        run: async (_ctx, { quiz }) => {
          const { filename, zip } = await this.portable.exportZip(quiz);
          return {
            outcome: 'done',
            notes: [],
            data: { filename, size: zip.length, base64: zip.toString('base64') },
          };
        },
      }),
      defineOperation({
        id: 'quizzes.import',
        domain: 'quizzes',
        category: 'quizzes',
        effect: 'write',
        summary: "Creates a draft in an account's bank from a bundle (zip or quiz.json).",
        params: z.object({
          owner: who,
          bundle: z.string().min(1).describe('The bundle, base64'),
          filename: z.string().max(255).optional(),
        }),
        timeoutMs: 5 * 60_000,
        run: async (_ctx, { owner, bundle, filename }) => {
          const buffer = Buffer.from(bundle, 'base64');
          const { data } = await printed((out) =>
            quizImport(out, prisma, this.portable, filename ?? '-', owner, {
              read: () => Promise.resolve(buffer),
              write: () => Promise.reject(new Error('not writable')),
            }),
          );
          return { outcome: 'done', notes: [], data };
        },
      }),
      defineOperation({
        id: 'sessions.purge',
        domain: 'quizzes',
        category: 'sessions',
        effect: 'destructive',
        summary: 'Deletes the archived sessions past their retention date, with their results.',
        describe: () => 'Delete every archived session past its retention date, with its results.',
        params: z.object({}),
        dryRun: true,
        timeoutMs: 10 * 60_000,
        run: async (ctx) => {
          const { data, value } = await printed((out) => sessionsPurge(out, prisma, ctx.dryRun));
          return { outcome: value ? 'done' : 'nothing-to-do', notes: [], data };
        },
      }),
    ];
  }
}
