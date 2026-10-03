import { Inject, Injectable } from '@nestjs/common';
import {
  SETTING_LIST,
  SETTINGS,
  type SettingDefinition,
  type SettingRow,
  type SettingsAccess,
  type SettingsList,
  type OperationResults,
} from '@quiz-dock/contracts';
import { z } from 'zod';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { OverridesService } from '../settings/overrides.service';
import { SettingsService } from '../settings/settings.service';
import {
  type AdminOperation,
  OperationError,
  defineOperation,
  done,
  nothingToDo,
} from './operation';

const DEFINITIONS = new Map(SETTING_LIST.map((d) => [d.key, d]));

/**
 * A secret setting's value never reaches the audit — not even when the change
 * is refused (a secret is never overridable, and the attempt is audited).
 */
const redactSecretValue = (params: Record<string, unknown>) =>
  typeof params.key === 'string' &&
  DEFINITIONS.get(params.key.toUpperCase())?.secret &&
  params.value !== undefined
    ? { ...params, value: '***' }
    : params;

/**
 * A value as a `.env` line takes it: bare when nothing in it is special; else in
 * single quotes, which Compose reads literally — a `${OTHER}` in a value set from
 * the web must not become another variable's value (a secret) once pasted.
 */
export function envLine(key: string, value: string): string {
  if (!/[\s#"'$\\]/.test(value)) return `${key}=${value}`;
  if (!value.includes("'")) return `${key}='${value}'`;
  // A single quote cannot sit in single quotes: double ones, `$` escaped as `$$`.
  return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$')}"`;
}

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
function brokenRules(
  settings: SettingsService,
  changes: Record<string, string | undefined>,
): string[] {
  // Told apart by their key: a message may carry a value (the largest upload's size)
  // that the change moves without breaking anything new.
  const now = new Set(
    settings
      .issues()
      .filter((i) => i.code === 'rule')
      .map((i) => i.key),
  );
  return settings
    .withOverrides(changes)
    .issues()
    .filter((i) => i.code === 'rule' && !now.has(i.key))
    .map((i) => i.message);
}

/**
 * Checks a value as an override is checked (§3.1): readable, within its
 * bounds — strictly, unlike an environment value — and breaking no rule.
 */
export function checkOverride(
  settings: SettingsService,
  key: string,
  value: string,
): SettingDefinition {
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
  const broken = brokenRules(settings, { [key]: value });
  if (broken.length)
    throw new OperationError('invalid_params', broken.join(' '), { path: 'value' });
  return def;
}

export function settingsAccess(settings: SettingsService): SettingsAccess {
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
export function settingRow(settings: SettingsService, def: SettingDefinition): SettingRow {
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
    private readonly settings: SettingsService,
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
          const rows = defs
            .filter((d) => !d.internal || key)
            .map((d) => settingRow(this.settings, d));
          const rules = key ? [] : this.settings.issues().filter((i) => i.code === 'rule');
          return Promise.resolve({
            outcome: 'done',
            notes: [],
            data: { rows, rules, access: settingsAccess(this.settings) } satisfies SettingsList,
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
        redact: redactSecretValue,
        validate: ({ key, value }) => void checkOverride(this.settings, key, value),
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
          const broken = brokenRules(
            this.settings,
            Object.fromEntries(keys.map((k) => [k, undefined])),
          );
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
            .map(([k, v]) => envLine(k, v));
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
          data: { entries: await this.audit.list(query) } satisfies OperationResults['audit.list'],
        }),
      }),
    ];
  }
}
