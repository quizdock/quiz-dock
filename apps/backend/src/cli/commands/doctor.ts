import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Output, Said } from '../output';
import {
  discoveryUrl,
  issuerMismatch,
  oidcSettings,
  type OidcSettings,
} from '../../auth/oidc/oidc-client';
import { migrationStatus } from './migrate-status';
import { SETTING_LIST, SETTINGS } from '@quiz-dock/contracts';
import type { SettingsService } from '../../admin/settings/settings.service';
import { IDP_TIMEOUT_MS } from '../../auth/oidc/oidc-client';

export interface DoctorDeps {
  prisma: Pick<PrismaService, '$queryRaw'>;
  /** The configuration to check (the backend's, or a fixed one in tests). */
  settings: SettingsService;
  fetch: typeof fetch;
  /** Redis ping (injected for tests). */
  pingRedis: (url: string) => Promise<void>;
  /** Write probe in the media dir (injected for tests). */
  probeWritable: (dir: string) => void;
  /** Shipped migrations folder; default `<cwd>/prisma/migrations`. */
  migrationsDir?: string;
}

/** Whether a variable is critical (C1): its problems fail the check. */
const critical = (key: string) =>
  SETTING_LIST.some((def) => def.key === key && def.criticality === 'C1');

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
 * troubleshooting table of the Documentation (operator/troubleshooting). Returns `true` when healthy.
 */
export async function doctor(out: Output, deps: DoctorDeps): Promise<boolean> {
  const { settings } = deps;
  let healthy = true;
  const fail = (msg: string, said?: Said) => {
    healthy = false;
    out.fail(msg, said);
  };
  const group = (title: string, code: string) => out.line(title, { code: `doctor.group.${code}` });

  group('Environment', 'environment');
  const mode = settings.get(SETTINGS.AUTH_MODE);
  out.ok(`AUTH_MODE=${mode}`);
  out.ok(
    `APP_NAME=${settings.get(SETTINGS.APP_NAME)}  APP_LANG=${settings.get(SETTINGS.APP_LANG)}`,
  );
  // Values that cannot be read or fall outside their range, rules between variables:
  // a critical one fails the check, the others are warnings.
  for (const issue of settings.issues()) {
    const said = { code: `doctor.issue.${issue.code}`, params: { key: issue.key } };
    if (critical(issue.key)) fail(issue.message, said);
    else out.warn(issue.message, said);
  }

  group('Database', 'database');
  if (!settings.get(SETTINGS.DATABASE_URL))
    fail('DATABASE_URL is not set', { code: 'doctor.unset', params: { key: 'DATABASE_URL' } });
  else {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      out.ok('PostgreSQL reachable', { code: 'doctor.postgres_ok' });
      // The application needs to own its database, not the whole server. The single
      // image is left out: its PostgreSQL answers from inside the container only.
      const [role] = await deps.prisma.$queryRaw<{ rolsuper: boolean }[]>`
        SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
      if (role?.rolsuper && settings.get(SETTINGS.QUIZDOCK_FLAVOR) !== 'standalone')
        out.warn(
          'QuizDock connects as a PostgreSQL superuser: a flaw in it would reach every database of the server. A new install gets a role of its own (QUIZDOCK_DB_USER). Nothing to do for now: a coming release of the quizdock script will move an existing install to it.',
          { code: 'doctor.postgres_superuser' },
        );
      const status = await migrationStatus(deps.prisma, deps.migrationsDir);
      out.ok(`${status.applied.length} migration(s) applied`, {
        code: 'doctor.migrations_applied',
        params: { count: status.applied.length },
      });
      if (status.pending.length)
        fail(
          `${status.pending.length} pending: ${status.pending.join(', ')} — run the migrate step`,
          { code: 'doctor.migrations_pending', params: { count: status.pending.length } },
        );
      if (status.failed.length)
        fail(
          `${status.failed.length} failed: ${status.failed.join(', ')} — see \`prisma migrate resolve\``,
          { code: 'doctor.migrations_failed', params: { count: status.failed.length } },
        );
    } catch (err) {
      fail(`PostgreSQL: ${(err as Error).message}`, {
        code: 'doctor.postgres_failed',
        params: { error: (err as Error).message },
      });
    }
  }

  group('Redis', 'redis');
  if (settings.describe(SETTINGS.REDIS_URL).source === 'default')
    fail('REDIS_URL is not set', { code: 'doctor.unset', params: { key: 'REDIS_URL' } });
  else {
    try {
      await deps.pingRedis(settings.get(SETTINGS.REDIS_URL));
      out.ok('Redis reachable', { code: 'doctor.redis_ok' });
    } catch (err) {
      fail(`Redis: ${(err as Error).message}`, {
        code: 'doctor.redis_failed',
        params: { error: (err as Error).message },
      });
    }
  }

  group('Media', 'media');
  // The uploaded media, and the shared templates' catalogue.
  for (const dir of [settings.path(SETTINGS.MEDIA_DIR), settings.path(SETTINGS.STORE_DIR)]) {
    try {
      deps.probeWritable(dir);
      out.ok(`${dir} is writable`, { code: 'doctor.dir_ok', params: { dir } });
    } catch (err) {
      fail(`${dir}: ${(err as Error).message}`, {
        code: 'doctor.dir_failed',
        params: { dir, error: (err as Error).message },
      });
    }
  }

  const anonymous = settings.get(SETTINGS.ALLOW_ANONYMOUS_PARTICIPANTS);

  if (mode === 'oidc') {
    group('OIDC', 'oidc');
    out.ok(
      anonymous
        ? 'participants: accounts or open access, chosen at each launch'
        : 'participants: accounts required (ALLOW_ANONYMOUS_PARTICIPANTS not set)',
      { code: anonymous ? 'doctor.participants_open' : 'doctor.participants_accounts' },
    );
    let oidc: OidcSettings | null = null;
    try {
      oidc = oidcSettings(settings);
    } catch (err) {
      fail((err as Error).message);
    }
    if (oidc) {
      const { issuer, internalUrl, clientSecret } = oidc;
      out.ok(`issuer ${issuer}`);
      out.ok(
        `client_id ${oidc.clientId} (${clientSecret ? 'confidential' : 'public, PKCE'})  roles claim ${settings.get(SETTINGS.OIDC_ROLES_CLAIM)}`,
      );
      // The backend talks to the provider itself now: discovery gives it the token endpoint.
      const onBackChannel = (url: string) =>
        internalUrl && url.startsWith(new URL(issuer).origin)
          ? internalUrl + url.slice(new URL(issuer).origin.length)
          : url;
      const url = onBackChannel(discoveryUrl(issuer));
      if (internalUrl)
        out.ok(`provider reached at ${internalUrl} from here`, {
          code: 'doctor.provider_internal',
          params: { url: internalUrl },
        });
      let jwksUri = oidc.jwksUri ?? undefined;
      try {
        const res = await deps.fetch(url, { signal: AbortSignal.timeout(IDP_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as Record<string, unknown>;
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
          if (typeof doc[key] !== 'string') throw new Error(`no ${key} in document`);
        }
        jwksUri ??= onBackChannel(doc.jwks_uri as string);
        const tokenEndpoint = onBackChannel(doc.token_endpoint as string);
        out.ok(`discovery ok → token endpoint ${tokenEndpoint}`, {
          code: 'doctor.discovery_ok',
          params: { url: tokenEndpoint },
        });
        const mismatch = typeof doc.issuer === 'string' && issuerMismatch(doc.issuer, issuer);
        if (mismatch) out.warn(mismatch);
      } catch (err) {
        fail(
          `discovery ${url}: ${(err as Error).message} — set OIDC_INTERNAL_URL if the issuer host is not reachable from here`,
          { code: 'doctor.discovery_failed', params: { url, error: (err as Error).message } },
        );
      }
      if (jwksUri) {
        try {
          const res = await deps.fetch(jwksUri, { signal: AbortSignal.timeout(IDP_TIMEOUT_MS) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const jwks = (await res.json()) as { keys?: unknown[] };
          if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error('no keys');
          out.ok(`JWKS reachable (${jwks.keys.length} key(s))`, {
            code: 'doctor.jwks_ok',
            params: { count: jwks.keys.length },
          });
        } catch (err) {
          fail(`JWKS ${jwksUri}: ${(err as Error).message}`, {
            code: 'doctor.jwks_failed',
            params: { url: jwksUri, error: (err as Error).message },
          });
        }
      }
    }
  }

  out.line();
  out.line(healthy ? 'All checks passed.' : 'Some checks failed.');
  return healthy;
}
