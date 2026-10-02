import { UserRole } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { MemoryAuditRepository } from '../audit/audit.repository';
import {
  type AdminOperation,
  OperationError,
  defineOperation,
  done,
} from '../operations/operation';
import { settingsFrom } from '../settings/settings.service';
import { MemoryConfirmationStore } from './confirmations';
import { type OperationCall, OperationRunner, maskParams } from './operation-runner';

const ADMIN = { via: 'api' as const, name: 'ada', userId: 'u1', roles: [UserRole.admin] };
const HOST = { via: 'api' as const, name: 'hal', userId: 'u2', roles: [UserRole.host] };
const CLI = { via: 'cli' as const, name: 'root' };
const WRITE_ENV = {
  AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'https://id.example.org',
  ADMIN_WEB_SCOPE: 'write',
};

const ran: unknown[] = [];

const ops: AdminOperation[] = [
  defineOperation({
    id: 'thing.read',
    domain: 'instance',
    category: 'health',
    effect: 'read',
    summary: 'Reads.',
    params: z.object({}),
    run: () => Promise.resolve(done({ ok: true })),
  }),
  defineOperation({
    id: 'thing.write',
    domain: 'instance',
    category: 'settings',
    effect: 'write',
    summary: 'Writes.',
    params: z.object({
      key: z.string(),
      value: z.number().optional(),
      token: z.string().optional(),
    }),
    settings: ({ key }) => [key],
    run: (_ctx, p) => {
      ran.push(p);
      return Promise.resolve(done());
    },
  }),
  defineOperation({
    id: 'quiz.delete',
    domain: 'quizzes',
    category: 'quizzes',
    effect: 'destructive',
    summary: 'Deletes a quiz.',
    describe: ({ quiz }) => `Delete ${quiz}.`,
    params: z.object({ quiz: z.string() }),
    dryRun: true,
    run: (ctx, p) => {
      ran.push({ ...p, dryRun: ctx.dryRun });
      return Promise.resolve(done());
    },
  }),
  defineOperation({
    id: 'media.write',
    domain: 'media',
    category: 'media',
    effect: 'write',
    summary: 'Media.',
    params: z.object({}),
    run: () => Promise.resolve(done()),
  }),
  defineOperation({
    id: 'thing.fail',
    domain: 'instance',
    category: 'health',
    effect: 'read',
    summary: 'Fails.',
    params: z.object({ how: z.enum(['op', 'http', 'crash', 'slow']) }),
    timeoutMs: 20,
    run: async (_ctx, { how }) => {
      if (how === 'op') throw new OperationError('conflict', 'Busy.');
      if (how === 'http') throw new NotFoundException('gone');
      if (how === 'slow') await new Promise((r) => setTimeout(r, 200));
      throw new Error('boom');
    },
  }),
];

ops.push(
  defineOperation({
    id: 'thing.slow-write',
    domain: 'instance',
    category: 'settings',
    effect: 'write',
    summary: 'Writes, slowly.',
    params: z.object({}),
    timeoutMs: 20,
    run: async () => {
      await new Promise((r) => setTimeout(r, 60));
      return done();
    },
  }),
);

function setup(env: Record<string, string> = WRITE_ENV) {
  const audit = new MemoryAuditRepository();
  const runner = new OperationRunner(ops, settingsFrom(env), audit, new MemoryConfirmationStore());
  return {
    runner,
    audit,
    run: (call: Partial<OperationCall> & { id: string }) =>
      runner.run({ actor: ADMIN, raw: {}, ...call }),
  };
}

beforeEach(() => (ran.length = 0));

describe('OperationRunner', () => {
  it('refuses an operation declared twice', () => {
    expect(
      () =>
        new OperationRunner(
          [ops[0], ops[0]],
          settingsFrom({}),
          new MemoryAuditRepository(),
          new MemoryConfirmationStore(),
        ),
    ).toThrow('declared twice');
  });

  it('runs an operation and returns its result', async () => {
    expect(await setup().run({ id: 'thing.read' })).toEqual({
      kind: 'result',
      result: { outcome: 'done', notes: [], data: { ok: true } },
    });
  });

  it('refuses an unknown operation', async () => {
    expect(await setup().run({ id: 'nope' })).toMatchObject({
      kind: 'refused',
      code: 'unknown_operation',
    });
  });

  describe('rights', () => {
    it('the API needs the administrator role, whatever the domain', async () => {
      const { run } = setup();
      for (const id of ['thing.read', 'quiz.delete', 'media.write']) {
        expect(await run({ id, actor: HOST, raw: { quiz: 'q' } })).toMatchObject({
          code: 'forbidden',
        });
      }
    });

    it('the CLI is trusted', async () => {
      expect(await setup().run({ id: 'thing.read', actor: CLI })).toMatchObject({ kind: 'result' });
    });
  });

  it('validates the parameters, one error shape', async () => {
    expect(await setup().run({ id: 'thing.write', raw: { key: 3 } })).toMatchObject({
      kind: 'refused',
      code: 'invalid_params',
      params: { path: 'key' },
    });
  });

  describe('gate', () => {
    it('ADMIN_WEB_SCOPE=read: the web reads the instance and changes nothing there', async () => {
      const { run } = setup({ ...WRITE_ENV, ADMIN_WEB_SCOPE: 'read' });
      expect(await run({ id: 'thing.read' })).toMatchObject({ kind: 'result' });
      expect(await run({ id: 'thing.write', raw: { key: 'APP_NAME' } })).toMatchObject({
        code: 'scope_read',
      });
      // The other domains are not concerned.
      expect(await run({ id: 'media.write' })).toMatchObject({ kind: 'result' });
      // Nor the CLI.
      expect(await run({ id: 'thing.write', raw: { key: 'APP_NAME' }, actor: CLI })).toMatchObject({
        kind: 'result',
      });
    });

    it('ADMIN_LOCK freezes the variables it names, for the web', async () => {
      const { run } = setup({ ...WRITE_ENV, ADMIN_LOCK: 'app_name, LIVE_MOTION' });
      expect(await run({ id: 'thing.write', raw: { key: 'APP_NAME' } })).toMatchObject({
        code: 'locked',
        params: { keys: ['APP_NAME'] },
      });
      expect(await run({ id: 'thing.write', raw: { key: 'APP_LANG' } })).toMatchObject({
        kind: 'result',
      });
      expect(await run({ id: 'thing.write', raw: { key: 'APP_NAME' }, actor: CLI })).toMatchObject({
        kind: 'result',
      });
    });

    describe('local mode', () => {
      const TOKEN = 'x'.repeat(40);

      it('the web changes nothing without ADMIN_TOKEN set', async () => {
        const { run } = setup({ ADMIN_WEB_SCOPE: 'write' });
        expect(await run({ id: 'thing.write', raw: { key: 'A' } })).toMatchObject({
          code: 'local_mode_token',
        });
        expect(await run({ id: 'quiz.delete', raw: { quiz: 'q' } })).toMatchObject({
          code: 'local_mode_token',
        });
        expect(await run({ id: 'thing.read' })).toMatchObject({ kind: 'result' });
      });

      it('with it, a change needs the token, compared exactly', async () => {
        const { run } = setup({ ADMIN_WEB_SCOPE: 'write', ADMIN_TOKEN: TOKEN });
        expect(await run({ id: 'thing.write', raw: { key: 'A' } })).toMatchObject({
          code: 'local_mode_token',
        });
        expect(
          await run({
            id: 'thing.write',
            raw: { key: 'A' },
            actor: { ...ADMIN, adminToken: `${TOKEN}y` },
          }),
        ).toMatchObject({ code: 'local_mode_token' });
        expect(
          await run({
            id: 'thing.write',
            raw: { key: 'A' },
            actor: { ...ADMIN, adminToken: TOKEN },
          }),
        ).toMatchObject({ kind: 'result' });
      });

      it('the media page keeps working as it did', async () => {
        expect(await setup({}).run({ id: 'media.write' })).toMatchObject({ kind: 'result' });
      });
    });
  });

  describe('confirmation', () => {
    it('a destructive operation is asked first, then run with the token', async () => {
      const { run } = setup();
      const ask = await run({ id: 'quiz.delete', raw: { quiz: 'q1' } });
      expect(ask).toMatchObject({ kind: 'confirm', summary: 'Delete q1.' });
      expect(ran).toEqual([]);
      const token = (ask as { token: string }).token;
      expect(
        await run({ id: 'quiz.delete', raw: { quiz: 'q1' }, confirmation: token }),
      ).toMatchObject({
        kind: 'result',
      });
      expect(ran).toEqual([{ quiz: 'q1', dryRun: false }]);
      // Single use.
      expect(
        await run({ id: 'quiz.delete', raw: { quiz: 'q1' }, confirmation: token }),
      ).toMatchObject({
        code: 'confirmation_invalid',
      });
    });

    it('the token is bound to the parameters and the caller', async () => {
      const { run } = setup();
      const ask = (await run({ id: 'quiz.delete', raw: { quiz: 'q1' } })) as { token: string };
      expect(
        await run({ id: 'quiz.delete', raw: { quiz: 'q2' }, confirmation: ask.token }),
      ).toMatchObject({
        code: 'confirmation_invalid',
      });
      const again = (await run({ id: 'quiz.delete', raw: { quiz: 'q1' } })) as { token: string };
      expect(
        await run({
          id: 'quiz.delete',
          raw: { quiz: 'q1' },
          confirmation: again.token,
          actor: { ...ADMIN, userId: 'u9' },
        }),
      ).toMatchObject({ code: 'confirmation_invalid' });
      expect(ran).toEqual([]);
    });

    it('a preview needs none; an operation that cannot preview refuses to', async () => {
      const { run } = setup();
      expect(await run({ id: 'quiz.delete', raw: { quiz: 'q1' }, dryRun: true })).toMatchObject({
        kind: 'result',
      });
      expect(ran).toEqual([{ quiz: 'q1', dryRun: true }]);
      expect(await run({ id: 'thing.write', raw: { key: 'A' }, dryRun: true })).toMatchObject({
        code: 'dry_run_unsupported',
      });
    });
  });

  describe('errors', () => {
    it.each([
      ['op', 'conflict'],
      ['http', 'not_found'],
      ['crash', 'failed'],
      ['slow', 'timeout'],
    ])('a %s failure becomes %s', async (how, code) => {
      expect(await setup().run({ id: 'thing.fail', raw: { how } })).toMatchObject({
        kind: 'refused',
        code,
      });
    });
  });

  it('a change past its time is answered "timeout", and its real outcome audited when it ends', async () => {
    const { run, audit } = setup();
    expect(await run({ id: 'thing.slow-write' })).toMatchObject({
      kind: 'refused',
      code: 'timeout',
    });
    await new Promise((r) => setTimeout(r, 120));
    const entries = await audit.list({ operation: 'thing.slow-write' });
    expect(entries.map((e) => [e.outcome, e.code])).toEqual([
      ['done', 'late'],
      ['refused', 'timeout'],
    ]);
  });

  describe('audit', () => {
    it('keeps every change and every refusal, never a read, a question or a preview', async () => {
      const { run, audit } = setup();
      await run({ id: 'thing.read' });
      await run({ id: 'thing.write', raw: { key: 'APP_NAME', value: 1, token: 'hunter2' } });
      const ask = (await run({ id: 'quiz.delete', raw: { quiz: 'q1' } })) as { token: string };
      await run({ id: 'quiz.delete', raw: { quiz: 'q1' }, dryRun: true });
      await run({ id: 'quiz.delete', raw: { quiz: 'q1' }, confirmation: ask.token });
      await run({ id: 'thing.read', actor: HOST });
      expect(audit.entries.map((e) => [e.operation, e.outcome, e.code])).toEqual([
        ['thing.write', 'done', null],
        ['quiz.delete', 'done', null],
        ['thing.read', 'refused', 'forbidden'],
      ]);
      expect(audit.entries[0]).toMatchObject({
        via: 'api',
        actor: 'ada',
        userId: 'u1',
        params: { key: 'APP_NAME', value: 1, token: '***' },
      });
    });
  });

  it('masks secrets and sums up long values', () => {
    expect(
      maskParams({
        adminToken: 'x',
        password: '',
        bundle: 'a'.repeat(300),
        list: [{ secret: 's' }],
      }),
    ).toEqual({
      adminToken: '***',
      password: '',
      bundle: '[300 characters]',
      list: [{ secret: '***' }],
    });
  });

  it('the catalogue says, per caller, what is reachable and why not', () => {
    const { runner } = setup({ ...WRITE_ENV, ADMIN_WEB_SCOPE: 'read' });
    const byId = (actor: Parameters<OperationRunner['catalogue']>[0]) =>
      Object.fromEntries(runner.catalogue(actor).map((d) => [d.id, d.refusal ?? 'ok']));
    expect(byId(ADMIN)).toMatchObject({
      'thing.read': 'ok',
      'thing.write': 'scope_read',
      'quiz.delete': 'ok',
    });
    expect(byId(HOST)).toMatchObject({ 'thing.read': 'forbidden' });
    expect(byId(CLI)).toMatchObject({ 'thing.write': 'ok' });
    const write = runner.catalogue(ADMIN).find((d) => d.id === 'thing.write')!;
    expect(write.params).toMatchObject({ type: 'object', required: ['key'] });
  });

  describe('the setup wizard and shell-only operations', () => {
    const extra = [
      { ...ops[1], id: 'wizard.write', wizard: true },
      { ...ops[0], id: 'shell.only', access: 'cli' as const },
    ];
    const runner = () =>
      new OperationRunner(
        [...ops, ...extra],
        settingsFrom({ ADMIN_LOCK: 'APP_NAME' }),
        new MemoryAuditRepository(),
        new MemoryConfirmationStore(),
      );
    const WIZARD = { via: 'api' as const, name: 'setup', setup: true };

    it('the wizard runs its own operations, whatever the scope and without the local token', async () => {
      expect(
        await runner().run({ id: 'wizard.write', raw: { key: 'APP_LANG' }, actor: WIZARD }),
      ).toMatchObject({
        kind: 'result',
      });
      expect(
        await runner().run({ id: 'thing.write', raw: { key: 'APP_LANG' }, actor: WIZARD }),
      ).toMatchObject({
        code: 'forbidden',
      });
    });

    it('the wizard never changes a locked variable', async () => {
      expect(
        await runner().run({ id: 'wizard.write', raw: { key: 'APP_NAME' }, actor: WIZARD }),
      ).toMatchObject({
        code: 'locked',
      });
    });

    it('a shell-only operation is refused to the web, even to an administrator', async () => {
      expect(await runner().run({ id: 'shell.only', raw: {}, actor: ADMIN })).toMatchObject({
        code: 'forbidden',
      });
      expect(await runner().run({ id: 'shell.only', raw: {}, actor: CLI })).toMatchObject({
        kind: 'result',
      });
    });
  });
});
