import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { AdminModule } from './admin.module';
import { OperationRunner } from './runner/operation-runner';

/**
 * Against the test database: the operations of `qd`, through the real runner —
 * the same results as the commands they wrap, each change in the audit table.
 */
describe('AdminModule (integration)', () => {
  let runner: OperationRunner;
  let prisma: PrismaService;
  let close: () => Promise<void>;
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
    await prisma.user.create({ data: { oidcSubject: subject, displayName: 'Ada', roles: [] } });
  });

  afterAll(async () => {
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
});
