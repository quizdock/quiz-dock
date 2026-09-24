import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Output } from '../output';
import { migrationStatus } from './migrate-status';

export interface DoctorDeps {
  prisma: Pick<PrismaService, '$queryRaw'>;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  /** Redis ping (injected for tests). */
  pingRedis: (url: string) => Promise<void>;
  /** Write probe in the media dir (injected for tests). */
  probeWritable: (dir: string) => void;
  /** Shipped migrations folder; default `<cwd>/prisma/migrations`. */
  migrationsDir?: string;
}

export async function defaultPingRedis(url: string): Promise<void> {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}

export function defaultProbeWritable(dir: string): void {
  rmSync(mkdtempSync(join(dir, '.doctor-')), { recursive: true, force: true });
}

/**
 * `doctor`: checks the runtime configuration and connectivity, mirroring the
 * troubleshooting table of the self-hosting guide. Returns `true` when healthy.
 */
export async function doctor(out: Output, deps: DoctorDeps): Promise<boolean> {
  const { env } = deps;
  let healthy = true;
  const fail = (msg: string) => {
    healthy = false;
    out.fail(msg);
  };

  out.line('Environment');
  const mode = env.AUTH_MODE ?? 'none';
  if (mode === 'none' || mode === 'oidc') out.ok(`AUTH_MODE=${mode}`);
  else fail(`AUTH_MODE=${mode} is not one of none|oidc`);
  out.ok(`APP_NAME=${env.APP_NAME ?? 'QuizDock'}  APP_LANG=${env.APP_LANG ?? 'en'}`);

  out.line('Database');
  if (!env.DATABASE_URL) fail('DATABASE_URL is not set');
  else {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      out.ok('PostgreSQL reachable');
      const status = await migrationStatus(deps.prisma, deps.migrationsDir);
      out.ok(`${status.applied.length} migration(s) applied`);
      if (status.pending.length)
        fail(
          `${status.pending.length} pending: ${status.pending.join(', ')} — run the migrate step`,
        );
      if (status.failed.length)
        fail(
          `${status.failed.length} failed: ${status.failed.join(', ')} — see \`prisma migrate resolve\``,
        );
    } catch (err) {
      fail(`PostgreSQL: ${(err as Error).message}`);
    }
  }

  out.line('Redis');
  if (!env.REDIS_URL) fail('REDIS_URL is not set');
  else {
    try {
      await deps.pingRedis(env.REDIS_URL);
      out.ok('Redis reachable');
    } catch (err) {
      fail(`Redis: ${(err as Error).message}`);
    }
  }

  out.line('Media');
  const mediaDir = env.MEDIA_DIR ?? '/data/media';
  try {
    deps.probeWritable(mediaDir);
    out.ok(`${mediaDir} is writable`);
  } catch (err) {
    fail(`${mediaDir}: ${(err as Error).message}`);
  }

  const anonymous = env.ALLOW_ANONYMOUS_PARTICIPANTS === 'true';
  if (anonymous && mode !== 'oidc') {
    out.warn('ALLOW_ANONYMOUS_PARTICIPANTS=true has no effect outside AUTH_MODE=oidc');
  }

  if (mode === 'oidc') {
    out.line('OIDC');
    out.ok(
      anonymous
        ? 'participants: accounts or open access, chosen at each launch'
        : 'participants: accounts required (ALLOW_ANONYMOUS_PARTICIPANTS not set)',
    );
    const issuer = env.OIDC_ISSUER?.replace(/\/+$/, '');
    if (!issuer) fail('OIDC_ISSUER is not set');
    else {
      out.ok(`issuer ${issuer}`);
      out.ok(
        `client_id ${env.OIDC_CLIENT_ID ?? 'quiz-dock-frontend'}  roles claim ${env.OIDC_ROLES_CLAIM || 'roles'}`,
      );
      let jwksUri = env.OIDC_JWKS_URI || undefined;
      if (jwksUri) out.ok(`JWKS from OIDC_JWKS_URI (${jwksUri}) — discovery skipped`);
      else {
        const url = `${issuer}/.well-known/openid-configuration`;
        try {
          const res = await deps.fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const doc = (await res.json()) as { issuer?: string; jwks_uri?: string };
          if (typeof doc.jwks_uri !== 'string') throw new Error('no jwks_uri in document');
          jwksUri = doc.jwks_uri;
          out.ok(`discovery ok → jwks_uri ${jwksUri}`);
          if (doc.issuer && doc.issuer.replace(/\/+$/, '') !== issuer)
            out.warn(
              `discovery issuer "${doc.issuer}" ≠ OIDC_ISSUER — tokens must carry OIDC_ISSUER exactly`,
            );
        } catch (err) {
          fail(
            `discovery ${url}: ${(err as Error).message} — set OIDC_JWKS_URI if the issuer host is not reachable from here`,
          );
        }
      }
      if (jwksUri) {
        try {
          const res = await deps.fetch(jwksUri);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const jwks = (await res.json()) as { keys?: unknown[] };
          if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error('no keys');
          out.ok(`JWKS reachable (${jwks.keys.length} key(s))`);
        } catch (err) {
          fail(`JWKS ${jwksUri}: ${(err as Error).message}`);
        }
      }
    }
  }

  out.line();
  out.line(healthy ? 'All checks passed.' : 'Some checks failed.');
  return healthy;
}
