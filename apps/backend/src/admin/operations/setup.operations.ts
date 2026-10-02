import { Injectable } from '@nestjs/common';
import { SETTINGS } from '@quiz-dock/contracts';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { localPrincipal } from '../../auth/no-auth.provider';
import { canonical, isManager } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SetupService } from '../setup/setup.service';
import {
  type AdminOperation,
  OperationError,
  defineOperation,
  done,
  nothingToDo,
} from './operation';

/**
 * What the setup wizard may run (§3.8): the health, the settings and presets
 * (C2–C4, whatever `ADMIN_WEB_SCOPE` says — never a locked one, never a C1),
 * the samples, the first administrator, the phone test, the end of the setup.
 */
export const WIZARD_OPERATIONS = new Set([
  'health.doctor',
  'settings.list',
  'settings.set',
  'settings.reset',
  'settings.export',
  'presets.list',
  'presets.plan',
  'presets.apply',
  'samples.load',
  'users.list',
  'setup.status',
  'setup.first-admin',
  'setup.complete',
  'invite.test',
  'invite.test-status',
]);

/** An address a phone may be sent to: an http(s) origin. */
const origin = z
  .string()
  .trim()
  .max(200)
  .regex(/^https?:\/\/[^\s/?#]+$/i, 'an http(s) address without path');

/** The setup and its wizard (§3.8), and the phone test of the invitation addresses. */
@Injectable()
export class SetupOperations {
  constructor(
    private readonly setup: SetupService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'setup.status',
        domain: 'instance',
        category: 'setup',
        effect: 'read',
        summary: 'Whether the setup is completed, and the invitation addresses a phone reached.',
        params: z.object({}),
        run: async () =>
          done({
            completed: await this.setup.completed(),
            tested: await this.setup.testedAddresses(),
          }),
      }),
      defineOperation({
        id: 'setup.token',
        domain: 'instance',
        category: 'setup',
        effect: 'write',
        access: 'cli',
        summary:
          'A new setup token for the web wizard (valid 24 h, single use); the previous one stops working.',
        params: z.object({}),
        run: async (ctx) => {
          if (await this.setup.completed()) {
            return nothingToDo(
              'The setup is completed: `qd setup.reopen` opens it again.',
              'setup.completed',
            );
          }
          const token = await this.setup.newToken(ctx.actor);
          return done({ output: [{ level: 'ok', text: `Setup token: ${token}` }] });
        },
      }),
      defineOperation({
        id: 'setup.complete',
        domain: 'instance',
        category: 'setup',
        effect: 'write',
        summary:
          'Closes the setup wizard for good (an instance fully set in .env skips it this way).',
        params: z.object({}),
        run: async (ctx) => {
          // OIDC: whoever finishes holds the administrator role from the provider.
          if (
            ctx.actor.via === 'api' &&
            this.settings.get(SETTINGS.AUTH_MODE) === 'oidc' &&
            !isManager(ctx.actor.roles ?? [])
          ) {
            throw new OperationError(
              'forbidden',
              'Finishing the setup needs the administrator role.',
            );
          }
          if (await this.setup.completed())
            return nothingToDo('Already completed.', 'setup.completed');
          await this.setup.complete(ctx.actor);
          return done({
            output: [{ level: 'ok', text: 'Setup completed: the wizard is closed.' }],
          });
        },
      }),
      defineOperation({
        id: 'setup.reopen',
        domain: 'instance',
        category: 'setup',
        effect: 'write',
        access: 'cli',
        summary: 'Opens the setup wizard again, with a new token.',
        params: z.object({}),
        run: async (ctx) => {
          const token = await this.setup.reopen(ctx.actor);
          return done({ output: [{ level: 'ok', text: `Setup reopened. Setup token: ${token}` }] });
        },
      }),
      defineOperation({
        id: 'setup.first-admin',
        domain: 'instance',
        category: 'setup',
        effect: 'write',
        summary:
          'Local mode: makes a name the first administrator (granted, kept whatever the host seat).',
        params: z.object({ name: z.string().trim().min(1).max(60) }),
        validate: () => {
          if (this.settings.get(SETTINGS.AUTH_MODE) !== 'none') {
            throw new OperationError(
              'conflict',
              'With OIDC, the administrator role comes from the identity provider.',
            );
          }
        },
        run: async (_ctx, { name }) => {
          const principal = localPrincipal(name);
          const existing = await this.prisma.user.findUnique({
            where: { oidcSubject: principal.sub },
          });
          const granted = canonical([...(existing?.assignedRoles ?? []), UserRole.admin]);
          await this.prisma.user.upsert({
            where: { oidcSubject: principal.sub },
            create: {
              oidcSubject: principal.sub,
              displayName: name,
              roles: granted,
              assignedRoles: granted,
            },
            update: {
              assignedRoles: granted,
              roles: canonical([...(existing?.roles ?? []), UserRole.admin]),
            },
          });
          return done({ subject: principal.sub });
        },
      }),
      defineOperation({
        id: 'invite.test',
        domain: 'instance',
        category: 'setup',
        effect: 'read',
        summary: 'Starts a phone test of an invitation address: the page to open from a phone.',
        params: z.object({ address: origin }),
        run: async (ctx, { address }) => {
          // Only the wizard remembers a reached address (offered first to hosts):
          // a read must leave nothing behind (§3.10).
          const { id } = await this.setup.startPhoneTest(address, !!ctx.actor.setup);
          return done({ id, url: `${address}/api/v1/setup/phone/${id}` });
        },
      }),
      defineOperation({
        id: 'invite.test-status',
        domain: 'instance',
        category: 'setup',
        effect: 'read',
        summary: 'Whether a phone reached the test page.',
        params: z.object({ id: z.string().max(40) }),
        run: async (_ctx, { id }) => {
          const test = await this.setup.phoneTest(id);
          if (!test) throw new OperationError('not_found', 'This phone test expired.');
          return done(test);
        },
      }),
    ];
  }
}
