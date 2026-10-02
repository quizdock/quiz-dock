import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { AdminModule } from './admin.module';
import { SETTINGS } from '@quiz-dock/contracts';
import { operationsHelp } from '../cli/adapter';
import { WIZARD_OPERATIONS } from './operations/setup.operations';
import { OperationRunner } from './runner/operation-runner';
import { settings } from './settings/settings.service';
import { ThemeService } from './theme/theme.service';

/**
 * Against the test database: the operations of `qd`, through the real runner —
 * the same results as the commands they wrap, each change in the audit table.
 */
describe('AdminModule (integration)', () => {
  let runner: OperationRunner;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let moduleTheme: () => ThemeService;
  const subject = `local:admin-db-${Date.now()}`;
  const cli = { via: 'cli' as const, name: 'tester' };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, AdminModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    runner = app.get(OperationRunner);
    prisma = app.get(PrismaService);
    close = () => app.close();
    moduleTheme = () => app.get(ThemeService);
    await prisma.user.create({ data: { oidcSubject: subject, displayName: 'Ada', roles: [] } });
  });

  afterAll(async () => {
    await prisma.instanceSetting.deleteMany({ where: { updatedBy: 'tester' } });
    await prisma.instanceSetting.deleteMany({ where: { key: 'theme.palette' } });
    await prisma.user.deleteMany({ where: { oidcSubject: subject } });
    await prisma.adminAudit.deleteMany({ where: { actor: 'tester' } });
    await close();
  });

  it('users.list lists the accounts, as user:list did', async () => {
    const outcome = await runner.run({ id: 'users.list', raw: {}, actor: cli });
    expect(outcome.kind).toBe('result');
    const output = (
      outcome as { result: { data: { output: { level: string; rows?: { subject: string }[] }[] } } }
    ).result.data.output;
    expect(output[0].level).toBe('table');
    expect(output[0].rows!.map((r) => r.subject)).toContain(subject);
  });

  it('users.set-role grants, is confirmed and audited', async () => {
    const call = { id: 'users.set-role', raw: { user: subject, roles: 'admin' }, actor: cli };
    const ask = await runner.run(call);
    expect(ask.kind).toBe('confirm');
    const outcome = await runner.run({ ...call, confirmation: (ask as { token: string }).token });
    expect(outcome).toMatchObject({ kind: 'result', result: { outcome: 'done' } });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { oidcSubject: subject } })).roles,
    ).toEqual(['admin']);

    const [entry] = await (
      (await runner.run({
        id: 'audit.list',
        raw: { operation: 'users.set-role' },
        actor: cli,
      })) as {
        result: { data: { entries: { actor: string; params: unknown; outcome: string }[] } };
      }
    ).result.data.entries;
    expect(entry).toMatchObject({
      actor: 'tester',
      params: { user: subject, roles: 'admin' },
      outcome: 'done',
    });
  });

  it('an unknown account is a not_found refusal, audited too', async () => {
    expect(
      await runner.run({
        id: 'users.set-role',
        raw: { user: 'local:nobody-here', roles: 'host' },
        actor: cli,
      }),
    ).toMatchObject({ kind: 'refused', code: 'not_found' });
    const refusals = await prisma.adminAudit.count({
      where: { actor: 'tester', outcome: 'refused' },
    });
    expect(refusals).toBeGreaterThan(0);
  });

  it('settings.list never gives a secret away', async () => {
    const outcome = (await runner.run({ id: 'settings.list', raw: {}, actor: cli })) as {
      result: { data: { rows: { key: string; value: unknown }[] } };
    };
    const db = outcome.result.data.rows.find((r) => r.key === 'DATABASE_URL')!;
    expect(db.value).toBe(true);
  });

  describe('settings changed from the administration', () => {
    const run = (id: string, raw: Record<string, unknown>, confirmation?: string) =>
      runner.run({ id, raw, actor: cli, confirmation });

    it('a change applies at once, keeps the .env value, and is audited with what it replaced', async () => {
      expect(await run('settings.set', { key: 'game_read_delay_ms', value: '1500' })).toMatchObject(
        {
          kind: 'result',
          result: { outcome: 'done' },
        },
      );
      expect(settings.describe(SETTINGS.GAME_READ_DELAY_MS)).toMatchObject({
        value: 1500,
        source: 'override',
        envValue: 3000,
      });
      const audit = await prisma.adminAudit.findFirst({
        where: { actor: 'tester', operation: 'settings.set' },
        orderBy: { id: 'desc' },
      });
      expect(audit?.params).toEqual({
        key: 'GAME_READ_DELAY_MS',
        value: '1500',
        before: { override: null },
      });
      const exported = (await run('settings.export', {})) as { result: { data: { env: string } } };
      expect(exported.result.data.env).toContain('GAME_READ_DELAY_MS=1500');
      expect(await run('settings.reset', { key: 'GAME_READ_DELAY_MS' })).toMatchObject({
        kind: 'result',
      });
      expect(settings.describe(SETTINGS.GAME_READ_DELAY_MS).source).not.toBe('override');
    });

    it('refuses a critical variable, a value out of its range, a broken rule', async () => {
      expect(await run('settings.set', { key: 'AUTH_MODE', value: 'oidc' })).toMatchObject({
        code: 'critical',
      });
      expect(await run('settings.set', { key: 'APP_LANG', value: 'xx' })).toMatchObject({
        code: 'invalid_params',
        params: { accepts: expect.stringContaining('fr') },
      });
      expect(await run('settings.set', { key: 'GAME_READ_DELAY_MS', value: '-5' })).toMatchObject({
        code: 'invalid_params',
      });
      expect(
        await run('settings.set', { key: 'ALLOW_ANONYMOUS_PARTICIPANTS', value: 'true' }),
      ).toMatchObject({
        code: 'invalid_params',
        message: expect.stringContaining('AUTH_MODE=oidc'),
      });
      expect(await run('settings.set', { key: 'NOPE', value: '1' })).toMatchObject({
        code: 'not_found',
      });
    });

    it('a level C2 change is confirmed first', async () => {
      const ask = await run('settings.set', { key: 'MEDIA_MAX_AUDIO_MB', value: '20' });
      expect(ask).toMatchObject({ kind: 'confirm', summary: 'Change MEDIA_MAX_AUDIO_MB to "20".' });
      await run(
        'settings.set',
        { key: 'MEDIA_MAX_AUDIO_MB', value: '20' },
        (ask as { token: string }).token,
      );
      expect(settings.get(SETTINGS.MEDIA_MAX_AUDIO_MB)).toBe(20);
      await run('settings.reset', { key: 'MEDIA_MAX_AUDIO_MB' });
      expect(settings.get(SETTINGS.MEDIA_MAX_AUDIO_MB)).toBe(10);
    });
  });

  describe("someone else's quiz", () => {
    const run = (id: string, raw: Record<string, unknown>, confirmation?: string) =>
      runner.run({ id, raw, actor: cli, confirmation });
    let quizId: string;

    beforeAll(async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { oidcSubject: subject } });
      quizId = (await prisma.quiz.create({ data: { ownerId: owner.id, title: 'Capitals' } })).id;
    });

    it('is archived, then restored as a draft', async () => {
      expect(await run('quizzes.archive', { quiz: quizId })).toMatchObject({
        result: { outcome: 'done' },
      });
      expect((await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } })).status).toBe(
        'archived',
      );
      expect(await run('quizzes.archive', { quiz: quizId })).toMatchObject({
        result: { outcome: 'nothing-to-do' },
      });
      await run('quizzes.restore', { quiz: quizId });
      expect((await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } })).status).toBe('draft');
    });

    it('is listed among the orphans while its owner is not a host', async () => {
      const orphans = (await run('quizzes.orphans', {})) as {
        result: { data: { rows: { id: string; why: string }[] } };
      };
      expect(orphans.result.data.rows).toContainEqual(
        expect.objectContaining({ id: quizId, why: 'not a host' }),
      );
    });

    it('is deleted once confirmed, the confirmation naming it and its owner', async () => {
      const ask = await run('quizzes.delete', { quiz: quizId });
      expect(ask).toMatchObject({
        kind: 'confirm',
        summary: expect.stringContaining('"Capitals" of Ada'),
      });
      await run('quizzes.delete', { quiz: quizId }, (ask as { token: string }).token);
      expect(await prisma.quiz.findUnique({ where: { id: quizId } })).toBeNull();
    });
  });

  describe('presets', () => {
    it('a named preset applies its levels at once, previewed first, then taken back', async () => {
      const preview = (await runner.run({
        id: 'presets.apply',
        raw: { preset: 'express' },
        actor: cli,
        dryRun: true,
      })) as {
        result: { data: { plan: { changes: { key: string; to: unknown; skipped?: string }[] } } };
      };
      expect(preview.result.data.plan.changes.map((c) => [c.key, c.skipped ?? null])).toEqual([
        ['GAME_READ_DELAY_MS', null],
        ['GAME_ALL_ANSWERED_DELAY_MS', null],
        ['GAME_AUTO_ADVANCE_MS', null],
        // Local mode: no participant signs in, the audience does not apply.
        ['ALLOW_ANONYMOUS_PARTICIPANTS', 'not-applicable'],
      ]);
      expect(settings.get(SETTINGS.GAME_READ_DELAY_MS)).toBe(3000);
      expect(
        await runner.run({ id: 'presets.apply', raw: { preset: 'express' }, actor: cli }),
      ).toMatchObject({
        kind: 'result',
      });
      expect(settings.get(SETTINGS.GAME_READ_DELAY_MS)).toBe(1500);
      const listed = (await runner.run({ id: 'presets.list', raw: {}, actor: cli })) as {
        result: { data: { current: Record<string, string> } };
      };
      expect(listed.result.data.current.pace).toBe('fast');
      const ask = await runner.run({ id: 'settings.reset', raw: { all: true }, actor: cli });
      await runner.run({
        id: 'settings.reset',
        raw: { all: true },
        actor: cli,
        confirmation: (ask as { token: string }).token,
      });
      expect(settings.get(SETTINGS.GAME_READ_DELAY_MS)).toBe(3000);
    });
  });

  describe('the palette', () => {
    it('a readable palette is served as a stylesheet; an unreadable one refused; then taken back', async () => {
      const theme = moduleTheme();
      expect(
        await runner.run({ id: 'theme.set', raw: { light: { primary: '#fde68a' } }, actor: cli }),
      ).toMatchObject({
        kind: 'refused',
        code: 'invalid_params',
        message: expect.stringContaining('primary-foreground on primary'),
      });
      expect(
        await runner.run({ id: 'theme.set', raw: { light: { primary: '#1d4ed8' } }, actor: cli }),
      ).toMatchObject({
        kind: 'result',
      });
      expect(await theme.css()).toContain('--primary: #1d4ed8;');
      await runner.run({ id: 'theme.reset', raw: {}, actor: cli });
      expect(await theme.css()).not.toContain('--primary');
    });
  });

  describe('the registry, operation by operation (§3.6, §3.11)', () => {
    const ids = () => runner.catalogue(cli).map((d) => d.id);
    const host = { via: 'api' as const, name: 'h', userId: 'x', roles: ['host' as const] };
    const admin = { via: 'api' as const, name: 'a', userId: 'y', roles: ['admin' as const] };
    const wizard = { via: 'api' as const, name: 'w', setup: true };

    it('every operation has a JSON Schema of its parameters and a line of CLI help', () => {
      for (const d of runner.catalogue(cli)) {
        expect(d.params).toMatchObject({ type: 'object' });
        expect(operationsHelp([d])).toContain(d.id);
      }
    });

    it('the matrix: a host never reaches one; the setup wizard only its own; the shell all', () => {
      const reach = (actor: Parameters<OperationRunner['catalogue']>[0]) =>
        Object.fromEntries(runner.catalogue(actor).map((d) => [d.id, d.refusal ?? 'ok']));
      for (const id of ids()) expect(reach(host)[id]).toBe('forbidden');
      expect(Object.values(reach(cli)).every((r) => r === 'ok')).toBe(true);
      const wizardReach = reach(wizard);
      for (const id of ids()) {
        expect([id, wizardReach[id] === 'ok']).toEqual([id, WIZARD_OPERATIONS.has(id)]);
      }
      // An administrator reaches every operation of the web but the shell's own.
      const adminReach = reach(admin);
      for (const id of ids()) {
        const op = runner.operation(id)!;
        expect([id, adminReach[id] === 'forbidden']).toEqual([id, op.access === 'cli']);
      }
    });
  });
});
