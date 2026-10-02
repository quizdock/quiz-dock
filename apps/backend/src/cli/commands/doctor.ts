import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Output } from '../output';
import {
  discoveryUrl,
  issuerMismatch,
  oidcSettings,
  type OidcSettings,
} from '../../auth/oidc/oidc-client';
import { migrationStatus } from './migrate-status';
import { SETTING_LIST, SETTINGS } from '@quiz-dock/contracts';
import type { SettingsService } from '../../admin/settings/settings.service';

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
 * troubleshooting table of the self-hosting guide. Returns `true` when healthy.
 */
export async function doctor(out: Output, deps: DoctorDeps): Promise<boolean> {
  const { settings } = deps;
  let healthy = true;
  const fail = (msg: string) => {
    healthy = false;
    out.fail(msg);
  };

  out.line('Environment');
  const mode = settings.get(SETTINGS.AUTH_MODE);
  out.ok(`AUTH_MODE=${mode}`);
  out.ok(
    `APP_NAME=${settings.get(SETTINGS.APP_NAME)}  APP_LANG=${settings.get(SETTINGS.APP_LANG)}`,
  );
  // Values that cannot be read or fall outside their range, rules between variables:
  // a critical one fails the check, the others are warnings.
  for (const issue of settings.issues()) {
    if (critical(issue.key)) fail(issue.message);
    else out.warn(issue.message);
  }

  out.line('Database');
  if (!settings.get(SETTINGS.DATABASE_URL)) fail('DATABASE_URL is not set');
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
  if (settings.describe(SETTINGS.REDIS_URL).source === 'default') fail('REDIS_URL is not set');
  else {
    try {
      await deps.pingRedis(settings.get(SETTINGS.REDIS_URL));
      out.ok('Redis reachable');
    } catch (err) {
      fail(`Redis: ${(err as Error).message}`);
    }
  }

  out.line('Media');
  // The uploaded media, and the shared templates' catalogue.
  for (const dir of [settings.path(SETTINGS.MEDIA_DIR), settings.path(SETTINGS.STORE_DIR)]) {
    try {
      deps.probeWritable(dir);
      out.ok(`${dir} is writable`);
    } catch (err) {
      fail(`${dir}: ${(err as Error).message}`);
    }
  }

  const anonymous = settings.get(SETTINGS.ALLOW_ANONYMOUS_PARTICIPANTS);

  if (mode === 'oidc') {
    out.line('OIDC');
    out.ok(
      anonymous
        ? 'participants: accounts or open access, chosen at each launch'
        : 'participants: accounts required (ALLOW_ANONYMOUS_PARTICIPANTS not set)',
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
      if (internalUrl) out.ok(`provider reached at ${internalUrl} from here`);
      let jwksUri = oidc.jwksUri ?? undefined;
      try {
        const res = await deps.fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as Record<string, unknown>;
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
          if (typeof doc[key] !== 'string') throw new Error(`no ${key} in document`);
        }
        jwksUri ??= onBackChannel(doc.jwks_uri as string);
        out.ok(`discovery ok → token endpoint ${onBackChannel(doc.token_endpoint as string)}`);
        const mismatch = typeof doc.issuer === 'string' && issuerMismatch(doc.issuer, issuer);
        if (mismatch) out.warn(mismatch);
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
