import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Output } from '../output';
import { oidcSettings, type OidcSettings } from '../../auth/oidc/oidc-client';
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
  // The uploaded media, and the shared templates' catalogue.
  for (const dir of [env.MEDIA_DIR ?? '/data/media', env.STORE_DIR ?? '/data/store']) {
    try {
      deps.probeWritable(dir);
      out.ok(`${dir} is writable`);
    } catch (err) {
      fail(`${dir}: ${(err as Error).message}`);
    }
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
    let settings: OidcSettings | null = null;
    try {
      settings = oidcSettings(env);
    } catch (err) {
      fail((err as Error).message);
    }
    if (settings) {
      const { issuer, internalUrl, clientSecret } = settings;
      out.ok(`issuer ${issuer}`);
      out.ok(
        `client_id ${settings.clientId} (${clientSecret ? 'confidential' : 'public, PKCE'})  roles claim ${env.OIDC_ROLES_CLAIM || 'roles'}`,
      );
      if (env.OIDC_SESSION_SCOPE)
        out.warn('OIDC_SESSION_SCOPE is ignored (sessions are server-side)');
      // The backend talks to the provider itself now: discovery gives it the token endpoint.
      const onBackChannel = (url: string) =>
        internalUrl && url.startsWith(new URL(issuer).origin)
          ? internalUrl + url.slice(new URL(issuer).origin.length)
          : url;
      const url = onBackChannel(`${issuer}/.well-known/openid-configuration`);
      if (internalUrl) out.ok(`provider reached at ${internalUrl} from here`);
      let jwksUri = settings.jwksUri ?? undefined;
      try {
        const res = await deps.fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as Record<string, unknown>;
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
          if (typeof doc[key] !== 'string') throw new Error(`no ${key} in document`);
        }
        jwksUri ??= onBackChannel(doc.jwks_uri as string);
        out.ok(`discovery ok → token endpoint ${onBackChannel(doc.token_endpoint as string)}`);
        if (typeof doc.issuer === 'string' && doc.issuer.replace(/\/+$/, '') !== issuer)
          out.warn(
            `discovery issuer "${doc.issuer}" ≠ OIDC_ISSUER — tokens must carry OIDC_ISSUER exactly`,
          );
      } catch (err) {
        fail(
          `discovery ${url}: ${(err as Error).message} — set OIDC_INTERNAL_URL if the issuer host is not reachable from here`,
        );
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
