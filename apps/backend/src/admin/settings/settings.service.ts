import { join } from 'node:path';
import { SETTING_LIST, SETTINGS, type SettingDefinition } from '@quiz-dock/contracts';

/** Where a raw value comes from, in order of precedence (default < `.env` < interface). */
export interface SettingSource {
  readonly name: 'override' | 'env';
  /** The raw text, or `undefined` when this source does not hold the variable. */
  read(key: string): string | undefined;
}

/** Something to tell the operator about a value: logged at start, listed by `qd doctor`. */
export interface SettingIssue {
  key: string;
  code: 'unreadable' | 'out-of-bounds' | 'deprecated' | 'rule';
  message: string;
}

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
      return { key: def.key, value: parsed.data, source: this.sources[i].name, issues };
    }
    return { key: def.key, value: def.default, source: 'default', issues };
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

/** What `client_max_body_size` lets through in the two-container setup's nginx. */
const PROXY_BODY_LIMIT = 64 * 1024 * 1024;
const MB = 1024 * 1024;

export const SETTING_RULES: SettingRule[] = [
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
        ? `The largest upload allowed (${Math.round(largest / MB)} MB) is above what the two-container setup's nginx lets through (64 MB): raise its client_max_body_size, or the limits.`
        : null;
    },
  },
];

/** The backend's settings, from its environment. */
export const settings = new SettingsService();

/** Settings over a fixed environment, for tests and tools. */
export const settingsFrom = (env: Record<string, string | undefined>): SettingsService =>
  new SettingsService([recordSource(env)]);
