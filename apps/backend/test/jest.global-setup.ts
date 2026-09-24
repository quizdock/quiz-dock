import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const BACKEND_DIR = join(__dirname, '..');

/**
 * The integration tests never touch the development data. They run against
 * `<database>_test` — derived from `DATABASE_URL` when set (CI), else from the
 * root `.env` like the Prisma CLI does — created and migrated here, and against
 * Redis database 1. The development stack keeps its host seat, its quizzes and
 * its live games.
 */
export default async function globalSetup(): Promise<void> {
  loadEnv({ path: join(BACKEND_DIR, '../../.env'), quiet: true });
  const base = new URL(
    process.env.DATABASE_URL ??
      `postgresql://${process.env.POSTGRES_USER ?? 'live'}:${process.env.POSTGRES_PASSWORD ?? 'live'}` +
        `@localhost:${process.env.POSTGRES_PORT ?? '15432'}/${process.env.POSTGRES_DB ?? 'quizdock'}?schema=public`,
  );
  const devName = base.pathname.slice(1);
  const testName = devName.endsWith('_test') ? devName : `${devName}_test`;
  const test = new URL(base);
  test.pathname = `/${testName}`;

  const admin = new URL(base);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    // A name taken from our own config, quoted as an identifier.
    if (found.rowCount === 0)
      await client.query(`CREATE DATABASE "${testName.replace(/"/g, '""')}"`);
  } catch (err) {
    // No Postgres: the unit tests still run, the integration ones say what is missing.
    console.warn(
      `[jest] no test database (${(err as Error).message}); integration tests will fail.`,
    );
    process.env.DATABASE_URL = test.toString();
    return;
  } finally {
    await client.end().catch(() => undefined);
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: test.toString() },
    stdio: 'ignore',
  });

  // Inherited by the Jest workers, spawned after this.
  process.env.DATABASE_URL = test.toString();
  const redis = new URL(
    process.env.REDIS_URL ?? `redis://localhost:${process.env.REDIS_PORT ?? '16379'}`,
  );
  redis.pathname = '/1';
  process.env.REDIS_URL = redis.toString();
}
