import { join } from 'node:path';
import {
  SETTING_LIST,
  SETTINGS,
  type SettingDefinition,
  type SettingIssue,
} from '@quiz-dock/contracts';

/** Where a raw value comes from, in order of precedence (default < `.env` < interface). */
export interface SettingSource {
  readonly name: 'override' | 'env';
  /** The raw text, or `undefined` when this source does not hold the variable. */
  read(key: string): string | undefined;
}

/** Something to tell the operator about a value: logged at start, listed by `qd doctor`. */
export type { SettingIssue };

/** What a setting resolves to, and why. */
export interface SettingState<T = unknown> {
  key: string;
  value: T;
  source: SettingSource['name'] | 'default';
  /** The value the environment gives, when an override replaces it. */
  envValue?: T;
  issues: SettingIssue[];
}

/**
 * The process environment, read on every call: a test that changes a variable,
 * or replaces `process.env` altogether, is seen at once. The one place of the
 * backend allowed to read it.
 */
export const envSource: SettingSource = {
  name: 'env',
  // eslint-disable-next-line no-restricted-properties -- the environment's one reader
  read: (key) => process.env[key],
};

/** A fixed environment, for tests and tools. */
export const recordSource = (env: Record<string, string | undefined>): SettingSource => ({
  name: 'env',
  read: (key) => env[key],
});

/**
 * The values changed from the administration (`instance_setting`), held in
 * memory: the `OverridesService` loads them, and loads them again when a replica
 * says they changed. Read on the game's hot path: a map lookup.
 */
export class OverrideStore {
  private values = new Map<string, string>();

  replace(entries: Iterable<[string, string]>): void {
    this.values = new Map(entries);
  }

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  entries(): [string, string][] {
    return [...this.values];
  }
}

const DEFINITIONS = new Map(SETTING_LIST.map((d) => [d.key, d]));

/**
 * The overrides as a source: only for a variable the administration may change,
 * and never in safe mode (`ADMIN_OVERRIDES=ignore`, read from the environment
 * alone: kept, not applied).
 */
export function overrideSource(store: OverrideStore, env: SettingSource): SettingSource {
  return {
    name: 'override',
    read: (key) => {
      if (!DEFINITIONS.get(key)?.overridable) return undefined;
      const safe = SETTINGS.ADMIN_OVERRIDES.schema.safeParse(env.read('ADMIN_OVERRIDES') ?? '');
      return safe.success && safe.data === 'ignore' ? undefined : store.get(key);
    },
  };
}

/** A value as a message may quote it: never a secret's. */
const quote = (def: SettingDefinition, raw: string) =>
  def.secret ? `${def.key} (set)` : `${def.key}=${JSON.stringify(raw)}`;

const describeDefault = (def: SettingDefinition) =>
  def.default === '' || def.default === null ? 'unset' : JSON.stringify(def.default);

/**
 * Resolves the application's settings (administration spec §3.1): each one
 * through its sources in order, the first holding a readable value winning,
 * else its default. A value is parsed once per raw text: reading a setting on
 * the game's hot path costs a map lookup.
 */
export class SettingsService {
  private readonly cache = new Map<string, { raws: (string | undefined)[]; state: SettingState }>();

  constructor(private readonly sources: SettingSource[] = [envSource]) {}

  /** The value of a setting, typed. */
  get<T>(def: SettingDefinition<T>): T {
    return this.describe(def).value;
  }

  /** A path setting: the value as written, its default under the working directory. */
  path(def: SettingDefinition<string>): string {
    const { value, source } = this.describe(def);
    return source === 'default' ? join(process.cwd(), value) : value;
  }

  /** The value, where it comes from and what is wrong with it. */
  describe<T>(def: SettingDefinition<T>): SettingState<T> {
    const raws = this.sources.map((s) => s.read(def.key));
    const hit = this.cache.get(def.key);
    if (hit && hit.raws.every((raw, i) => raw === raws[i])) return hit.state as SettingState<T>;
    const state = this.resolve(def, raws);
    this.cache.set(def.key, { raws, state });
    return state;
  }

  private resolve<T>(def: SettingDefinition<T>, raws: (string | undefined)[]): SettingState<T> {
    const issues: SettingIssue[] = [];
    for (const [i, raw] of raws.entries()) {
      if (raw === undefined || (raw === '' && !def.allowEmpty)) continue;
      if (def.deprecated)
        issues.push({ key: def.key, code: 'deprecated', message: def.deprecated });
      const parsed = def.schema.safeParse(raw);
      if (!parsed.success) {
        const why = parsed.error.issues[0]?.message ?? 'unreadable';
        issues.push({
          key: def.key,
          code: 'unreadable',
          message:
            `${quote(def, raw)} cannot be read (${why}; accepts ${def.accepts}): ` +
            `${describeDefault(def)} is used instead` +
            (def.criticality === 'C1' ? '. From v1, the instance will refuse to start.' : '.'),
        });
        continue;
      }
      if (def.bounds && !def.bounds.safeParse(parsed.data).success) {
        issues.push({
          key: def.key,
          code: 'out-of-bounds',
          message: `${quote(def, raw)} is outside what it accepts (${def.accepts}): used as is for now; a later release will enforce it.`,
        });
      }
      const source = this.sources[i].name;
      return {
        key: def.key,
        value: parsed.data,
        source,
        ...(source === 'override'
          ? { envValue: this.envValue(def, raws.slice(i + 1), i + 1) }
          : {}),
        issues,
      };
    }
    return { key: def.key, value: def.default, source: 'default', issues };
  }

  /** What the environment alone gives, under an override: its readable value, else the default. */
  private envValue<T>(def: SettingDefinition<T>, raws: (string | undefined)[], offset: number): T {
    for (const [j, raw] of raws.entries()) {
      if (this.sources[offset + j].name !== 'env') continue;
      if (raw === undefined || (raw === '' && !def.allowEmpty)) continue;
      const parsed = def.schema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
    return def.default;
  }

  /**
   * The settings as they would be with these overrides changed (`undefined`
   * removes one): to check the rules between variables before saving.
   */
  withOverrides(changes: Record<string, string | undefined>): SettingsService {
    const current = this.sources.find((s) => s.name === 'override');
    const candidate: SettingSource = {
      name: 'override',
      read: (key) => (key in changes ? changes[key] : current?.read(key)),
    };
    return new SettingsService([candidate, ...this.sources.filter((s) => s.name !== 'override')]);
  }

  /** Everything to report about the current configuration: each value, then the rules between them. */
  issues(): SettingIssue[] {
    return [
      ...SETTING_LIST.flatMap((def) => this.describe(def).issues),
      ...SETTING_RULES.flatMap((rule) => {
        const message = rule.check(this);
        return message ? [{ key: rule.key, code: 'rule' as const, message }] : [];
      }),
    ];
  }
}

/** A rule between variables (§3.11, specification objects): a message when it is broken. */
export interface SettingRule {
  key: string;
  check(settings: SettingsService): string | null;
}

/** The request body limit of the Documentation's reverse-proxy example (nginx `client_max_body_size 64m`). */
const PROXY_BODY_LIMIT = 64 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * The generation of deployment files this image expects (`QUIZDOCK_FILES` in its
 * Compose files). 2: the files `quizdock upgrade` keeps in step with the release
 * (Keycloak 26.7, the hardened migrations, /health/ready).
 */
export const DEPLOYMENT_FILES_EXPECTED = 2;

/** Passwords the Compose files and the env examples ship with: fine to try, not to keep. */
export const DEFAULT_PASSWORDS = ['live', 'change-me', 'change-me-database'];

/** The password of a connection string, if it carries one. */
function urlPassword(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).password) || null;
  } catch {
    return null;
  }
}

export const SETTING_RULES: SettingRule[] = [
  {
    key: 'DATABASE_URL',
    check: (s) => {
      const password = urlPassword(s.get(SETTINGS.DATABASE_URL));
      return password && DEFAULT_PASSWORDS.includes(password)
        ? `The database password is a default one ("${password}"): set POSTGRES_PASSWORD in .env to a secret of your own. PostgreSQL is on the internal network only, but anything that reaches it with that password reads every quiz and result.`
        : null;
    },
  },
  {
    key: 'QUIZDOCK_FILES',
    check: (s) => {
      // The single image runs without Compose files; a plain `docker run` says nothing either.
      if (s.get(SETTINGS.QUIZDOCK_FLAVOR) === 'standalone') return null;
      const files = s.get(SETTINGS.QUIZDOCK_FILES);
      if (files !== null && files >= DEPLOYMENT_FILES_EXPECTED) return null;
      return "The Compose files are older than this release expects (QUIZDOCK_FILES): with the quizdock script, download its latest version, run `./quizdock upgrade`, then adopt any `<file>.new` it writes next to a file you edited. Started otherwise (your own Compose, `docker run`), compare with the release's docker-compose.prod.yml.";
    },
  },
  {
    key: 'ALLOW_ANONYMOUS_PARTICIPANTS',
    check: (s) =>
      s.get(SETTINGS.ALLOW_ANONYMOUS_PARTICIPANTS) && s.get(SETTINGS.AUTH_MODE) !== 'oidc'
        ? 'ALLOW_ANONYMOUS_PARTICIPANTS=true has no effect outside AUTH_MODE=oidc.'
        : null,
  },
  {
    key: 'MEDIA_MAX_VIDEO_MB',
    check: (s) => {
      const largest = Math.max(
        s.get(SETTINGS.MEDIA_MAX_BYTES),
        s.get(SETTINGS.MEDIA_MAX_VIDEO_MB) * MB,
        s.get(SETTINGS.MEDIA_MAX_AUDIO_MB) * MB,
        s.get(SETTINGS.IMPORT_MAX_BYTES),
      );
      return largest > PROXY_BODY_LIMIT
        ? `The largest upload allowed (${Math.round(largest / MB)} MB) is above 64 MB: check that the reverse proxy in front lets it through (nginx: client_max_body_size), or lower the limits.`
        : null;
    },
  },
];

/** The values changed from the administration, as the backend holds them. */
export const overrides = new OverrideStore();

/**
 * The backend's settings: the administration's overrides, then its environment.
 * One instance. A class receives it by injection (`SettingsService`, provided
 * by the administration's module); this export is for what nothing injects —
 * a module function read per request or at load (an upload's limit, a
 * decorator's options, the start-up), and the code that predates the registry.
 */
export const settings = new SettingsService([overrideSource(overrides, envSource), envSource]);

/** Settings over a fixed environment (and overrides), for tests and tools. */
export const settingsFrom = (
  env: Record<string, string | undefined>,
  store?: OverrideStore,
): SettingsService =>
  new SettingsService(
    store ? [overrideSource(store, recordSource(env)), recordSource(env)] : [recordSource(env)],
  );
