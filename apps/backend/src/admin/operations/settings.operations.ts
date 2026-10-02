import { Inject, Injectable } from '@nestjs/common';
import { SETTING_LIST, SETTINGS, type SettingDefinition } from '@quiz-dock/contracts';
import { z } from 'zod';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { OverridesService } from '../settings/overrides.service';
import { type SettingIssue, settings } from '../settings/settings.service';
import {
  type AdminOperation,
  OperationError,
  defineOperation,
  done,
  nothingToDo,
} from './operation';

const DEFINITIONS = new Map(SETTING_LIST.map((d) => [d.key, d]));
const settingKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((k) => k.toUpperCase());

/** A setting the administration may change, or why not. */
function changeable(key: string): SettingDefinition {
  const def = DEFINITIONS.get(key);
  if (!def) throw new OperationError('not_found', `No setting "${key}".`);
  if (!def.overridable || def.internal || def.deprecated) {
    throw new OperationError('critical', `${key} is set in .env only (level ${def.criticality}).`);
  }
  return def;
}

/** The rules between variables a change would break, that hold now. */
function brokenRules(changes: Record<string, string | undefined>): string[] {
  const now = new Set(
    settings
      .issues()
      .filter((i) => i.code === 'rule')
      .map((i) => i.message),
  );
  return settings
    .withOverrides(changes)
    .issues()
    .filter((i) => i.code === 'rule' && !now.has(i.message))
    .map((i) => i.message);
}

/**
 * Checks a value as an override is checked (§3.1): readable, within its
 * bounds — strictly, unlike an environment value — and breaking no rule.
 */
export function checkOverride(key: string, value: string): SettingDefinition {
  const def = changeable(key);
  if (value === '' && !def.allowEmpty) {
    throw new OperationError('invalid_params', `${key}: empty — go back to .env instead.`, {
      path: 'value',
    });
  }
  const parsed = def.schema.safeParse(value);
  if (!parsed.success || (def.bounds && !def.bounds.safeParse(parsed.data).success)) {
    throw new OperationError('invalid_params', `${key} accepts ${def.accepts}.`, {
      path: 'value',
      accepts: def.accepts,
    });
  }
  const broken = brokenRules({ [key]: value });
  if (broken.length)
    throw new OperationError('invalid_params', broken.join(' '), { path: 'value' });
  return def;
}

/** A setting as the administration shows it: never a secret's value. */
export interface SettingRow {
  key: string;
  category: SettingDefinition['category'];
  criticality: SettingDefinition['criticality'];
  applies: SettingDefinition['applies'];
  overridable: boolean;
  secret: boolean;
  /** The value in use; for a secret, whether it is set. */
  value: unknown;
  source: 'default' | 'env' | 'override';
  /** The value `.env` gives, when an override replaces it. */
  envValue?: unknown;
  default: unknown;
  /** Named by `ADMIN_LOCK`: the web never changes it. */
  locked: boolean;
  issues: SettingIssue[];
}

/** What the web may do with the settings (§3.7): shown above them. */
export interface SettingsAccess {
  scope: 'read' | 'write';
  locks: string[];
  authMode: 'none' | 'oidc';
  /** Local mode: a change needs `ADMIN_TOKEN`, and whether it is set at all. */
  tokenRequired: boolean;
  tokenSet: boolean;
  /** `ADMIN_OVERRIDES=ignore`: the values changed from the web are not applied. */
  safeMode: boolean;
}

export function settingsAccess(): SettingsAccess {
  const authMode = settings.get(SETTINGS.AUTH_MODE);
  return {
    scope: settings.get(SETTINGS.ADMIN_WEB_SCOPE),
    locks: settings.get(SETTINGS.ADMIN_LOCK),
    authMode,
    tokenRequired: authMode === 'none',
    tokenSet: settings.get(SETTINGS.ADMIN_TOKEN) !== '',
    safeMode: settings.get(SETTINGS.ADMIN_OVERRIDES) === 'ignore',
  };
}

/** One boundary for secrets (§3.11): a secret's value never leaves through here. */
export function settingRow(def: SettingDefinition): SettingRow {
  const state = settings.describe(def);
  const show = (value: unknown) =>
    def.secret ? value !== '' && value !== undefined && value !== null : value;
  return {
    key: def.key,
    category: def.category,
    criticality: def.criticality,
    applies: def.applies,
    overridable: def.overridable,
    secret: !!def.secret,
    value: show(state.value),
    source: state.source,
    ...(state.envValue !== undefined ? { envValue: show(state.envValue) } : {}),
    default: def.secret ? false : def.default,
    locked: settings.get(SETTINGS.ADMIN_LOCK).includes(def.key),
    issues: state.issues,
  };
}

/** Reading and changing the settings, reading the audit log. */
@Injectable()
export class SettingsOperations {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly overrides: OverridesService,
  ) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'settings.list',
        domain: 'instance',
        category: 'settings',
        effect: 'read',
        summary:
          'Lists every setting: its value, where it comes from, its default, what is wrong with it.',
        params: z.object({ key: z.string().trim().max(64).optional() }),
        run: (_ctx, { key }) => {
          const defs = key ? SETTING_LIST.filter((d) => d.key === key.toUpperCase()) : SETTING_LIST;
          if (key && !defs.length) throw new OperationError('not_found', `No setting "${key}".`);
          const rows = defs.filter((d) => !d.internal || key).map(settingRow);
          const rules = key ? [] : settings.issues().filter((i) => i.code === 'rule');
          return Promise.resolve({
            outcome: 'done',
            notes: [],
            data: { rows, rules, access: settingsAccess() },
          });
        },
      }),
      defineOperation({
        id: 'settings.set',
        domain: 'instance',
        category: 'settings',
        effect: 'write',
        summary: 'Changes a setting from the administration; its .env value stays, to go back to.',
        params: z.object({ key: settingKey, value: z.string().max(10_000) }),
        settings: ({ key }) => [key],
        validate: ({ key, value }) => void checkOverride(key, value),
        confirmation: ({ key, value }) => {
          const def = DEFINITIONS.get(key);
          return def?.criticality === 'C2' ? `Change ${key} to ${JSON.stringify(value)}.` : null;
        },
        run: async (ctx, { key, value }) => {
          const previous = this.overrides.store.get(key) ?? null;
          if (previous === value)
            return nothingToDo(`${key} is already ${value}.`, 'settings.unchanged');
          await this.overrides.apply([{ key, value }], ctx.actor);
          return { ...done({ key, value }), memento: { override: previous } };
        },
      }),
      defineOperation({
        id: 'settings.reset',
        domain: 'instance',
        category: 'settings',
        effect: 'write',
        summary:
          'Takes back what the administration changed: the .env value (or the default) applies again.',
        params: z
          .object({ key: settingKey.optional(), all: z.boolean().optional() })
          .refine((p) => !!p.key !== !!p.all, { message: 'key or all' }),
        settings: ({ key }) => (key ? [key] : this.overrides.store.entries().map(([k]) => k)),
        confirmation: ({ all }) =>
          all ? 'Take back every setting changed from the administration.' : null,
        run: async (ctx, { key, all }) => {
          const keys = all ? this.overrides.store.entries().map(([k]) => k) : [key!];
          const removed = Object.fromEntries(
            keys.flatMap((k) => {
              const v = this.overrides.store.get(k);
              return v === undefined ? [] : [[k, v]];
            }),
          );
          if (!Object.keys(removed).length)
            return nothingToDo('Nothing was changed here.', 'settings.unchanged');
          const broken = brokenRules(Object.fromEntries(keys.map((k) => [k, undefined])));
          if (broken.length) throw new OperationError('invalid_params', broken.join(' '));
          await this.overrides.apply(
            Object.keys(removed).map((k) => ({ key: k, value: null })),
            ctx.actor,
          );
          return { ...done({ keys: Object.keys(removed) }), memento: { overrides: removed } };
        },
      }),
      defineOperation({
        id: 'settings.export',
        domain: 'instance',
        category: 'settings',
        effect: 'read',
        summary:
          'The settings changed from the administration, as a .env excerpt: to pin them, or move them to another instance.',
        params: z.object({}),
        run: () => {
          const lines = this.overrides.store
            .entries()
            .filter(([k]) => DEFINITIONS.get(k) && !DEFINITIONS.get(k)?.secret)
            .map(([k, v]) => `${k}=${/[\s#"'$]/.test(v) ? JSON.stringify(v) : v}`);
          return Promise.resolve(
            done({
              env: lines.length
                ? `# Changed from the administration — paste into .env, then take them back there.\n${lines.join('\n')}\n`
                : '',
              count: lines.length,
            }),
          );
        },
      }),
      defineOperation({
        id: 'audit.list',
        domain: 'instance',
        category: 'audit',
        effect: 'read',
        summary: 'Lists the administrative actions, newest first.',
        params: z.object({
          limit: z.number().int().min(1).max(200).default(50),
          before: z.string().max(26).optional(),
          operation: z.string().max(64).optional(),
          setting: z.string().max(64).optional(),
        }),
        run: async (_ctx, query) => ({
          outcome: 'done',
          notes: [],
          data: { entries: await this.audit.list(query) },
        }),
      }),
    ];
  }
}
