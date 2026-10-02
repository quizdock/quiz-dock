import { Inject, Injectable } from '@nestjs/common';
import { SETTING_LIST, SETTINGS, type SettingDefinition } from '@quiz-dock/contracts';
import { z } from 'zod';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { type SettingIssue, settings } from '../settings/settings.service';
import { type AdminOperation, OperationError, defineOperation } from './operation';

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

/** Reading the settings and the audit log. */
@Injectable()
export class SettingsOperations {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

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
