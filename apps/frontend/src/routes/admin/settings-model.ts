import { SETTINGS, type SettingDefinition, type SettingKey } from '@quiz-dock/contracts';
import { QUIZDOCK_REPOSITORY } from '@/lib/feedback';

/** A setting as `settings.list` gives it (the backend's `SettingRow`). */
export interface SettingRow {
  key: string;
  category: SettingDefinition['category'];
  criticality: SettingDefinition['criticality'];
  applies: SettingDefinition['applies'];
  overridable: boolean;
  secret: boolean;
  value: unknown;
  source: 'default' | 'env' | 'override';
  envValue?: unknown;
  default: unknown;
  locked: boolean;
  issues: { key: string; code: string; message: string }[];
}

export interface SettingsAccess {
  scope: 'read' | 'write';
  locks: string[];
  authMode: 'none' | 'oidc';
  tokenRequired: boolean;
  tokenSet: boolean;
  safeMode: boolean;
}

export interface SettingsList {
  rows: SettingRow[];
  rules: { key: string; code: string; message: string }[];
  access: SettingsAccess;
}

export const definitionOf = (key: string): SettingDefinition | undefined =>
  (SETTINGS as Record<string, SettingDefinition>)[key];

const MB = 1024 * 1024;

/** A number as the administration speaks it: one unit per kind, megabytes and seconds (§1, note 2). */
export function displayNumber(
  def: SettingDefinition | undefined,
  value: number,
): { amount: number; unit?: 'MB' | 's' } {
  if (!def?.unit) return { amount: value };
  if (def.unit === 'bytes') return { amount: Math.round((value / MB) * 10) / 10, unit: 'MB' };
  if (def.unit === 'ms') return { amount: Math.round(value / 100) / 10, unit: 's' };
  return { amount: value, unit: def.unit };
}

export type ShownValue =
  | { kind: 'empty' }
  | { kind: 'secret'; set: boolean }
  | { kind: 'flag'; on: boolean }
  | { kind: 'number'; amount: number; unit?: 'MB' | 's' }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] };

/** What to show for a value, whatever its type. */
export function shownValue(row: Pick<SettingRow, 'key' | 'secret'>, value: unknown): ShownValue {
  if (row.secret) return { kind: 'secret', set: value === true };
  if (value === null || value === undefined || value === '') return { kind: 'empty' };
  if (typeof value === 'boolean') return { kind: 'flag', on: value };
  if (value === 'on' || value === 'off') return { kind: 'flag', on: value === 'on' };
  if (typeof value === 'number')
    return { kind: 'number', ...displayNumber(definitionOf(row.key), value) };
  if (Array.isArray(value)) {
    const items = value.map((v) =>
      v && typeof v === 'object' && 'name' in v ? String((v as { name: unknown }).name) : String(v),
    );
    return items.length ? { kind: 'list', items } : { kind: 'empty' };
  }
  return { kind: 'text', text: String(value) };
}

export type SettingFilter = 'changed' | 'overridden' | 'problem' | 'editable';

/** Whether the web could change it (lot 4 makes it so): never a C1, a locked one, nor with the scope `read`. */
export function editable(row: SettingRow, access: SettingsAccess): boolean {
  return row.overridable && !row.locked && access.scope === 'write' && !access.safeMode;
}

/** Why it is read-only, when it is. */
export function readOnlyReason(
  row: SettingRow,
  access: SettingsAccess,
): 'critical' | 'locked' | 'scope' | 'safe-mode' | null {
  if (!row.overridable) return 'critical';
  if (row.locked) return 'locked';
  if (access.safeMode) return 'safe-mode';
  if (access.scope !== 'write') return 'scope';
  return null;
}

export function matches(
  row: SettingRow,
  query: string,
  filters: ReadonlySet<SettingFilter>,
  access: SettingsAccess,
  label: (key: string) => string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const haystack =
      `${row.key} ${label(row.key)} ${definitionOf(row.key)?.description ?? ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.has('changed') && row.source === 'default') return false;
  if (filters.has('overridden') && row.source !== 'override') return false;
  if (filters.has('problem') && !row.issues.length) return false;
  if (filters.has('editable') && !editable(row, access)) return false;
  return true;
}

/** The categories, in the dictionary's order (§1.1–1.7). */
export const CATEGORIES: SettingDefinition['category'][] = [
  'identity',
  'access',
  'network',
  'storage',
  'limits',
  'pace',
  'admin',
  'internal',
];

/** Rules shared with other variables (§3.1), shown in a setting's help. */
export const RULES: Partial<Record<SettingKey, SettingKey[]>> = {
  ALLOW_ANONYMOUS_PARTICIPANTS: ['AUTH_MODE'],
  AUTH_MODE: ['ALLOW_ANONYMOUS_PARTICIPANTS', 'OIDC_ISSUER'],
  OIDC_ISSUER: ['AUTH_MODE'],
  MEDIA_MAX_BYTES: ['MEDIA_MAX_VIDEO_MB', 'MEDIA_MAX_AUDIO_MB', 'IMPORT_MAX_BYTES'],
  MEDIA_MAX_VIDEO_MB: ['MEDIA_MAX_BYTES', 'MEDIA_MAX_AUDIO_MB', 'IMPORT_MAX_BYTES'],
  MEDIA_MAX_AUDIO_MB: ['MEDIA_MAX_BYTES', 'MEDIA_MAX_VIDEO_MB', 'IMPORT_MAX_BYTES'],
  IMPORT_MAX_BYTES: ['MEDIA_MAX_BYTES', 'MEDIA_MAX_VIDEO_MB', 'MEDIA_MAX_AUDIO_MB'],
  ADMIN_TOKEN: ['AUTH_MODE'],
};

/** The section of the self-hosting guide that documents a category. */
const DOC_ANCHORS: Partial<Record<SettingDefinition['category'], string>> = {
  identity: 'identity--branding',
  access: 'access--authentication',
  network: 'network--invitation',
  storage: 'storage',
  limits: 'limits',
  pace: 'game-pace',
  admin: 'administration',
};

export const DOCS_URL = `${QUIZDOCK_REPOSITORY}/blob/main/docs/self-hosting/configuration.md`;

export function docLink(category: SettingDefinition['category']): string | null {
  const anchor = DOC_ANCHORS[category];
  return anchor ? `${DOCS_URL}#${anchor}` : null;
}
