import {
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
  type SettingRow,
  type SettingsAccess,
  type SettingsList,
} from '@quiz-dock/contracts';

export type { SettingRow, SettingsAccess, SettingsList };

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
  /** The setup wizard sets C2–C4 whatever the scope (§3.8). */
  wizard = false,
): 'critical' | 'locked' | 'scope' | 'safe-mode' | null {
  if (!row.overridable) return 'critical';
  if (row.locked) return 'locked';
  if (access.safeMode) return 'safe-mode';
  if (access.scope !== 'write' && !wizard) return 'scope';
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

/**
 * The categories as the page lists them: the quiz's pace first, the one most often
 * tuned; then the dictionary's order (§1.1–1.7).
 */
export const CATEGORIES: SettingDefinition['category'][] = [
  'pace',
  'identity',
  'access',
  'network',
  'storage',
  'limits',
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

/** The environment reference of the Documentation: a row per variable, its anchor the name in lower case. */
export const DOCS_URL = 'https://quizdock.github.io/docs/operator/configuration/';

/** How the operator lets the web administration change the instance (ADMIN_WEB_SCOPE, ADMIN_TOKEN). */
export const WEB_CHANGES_DOC =
  'https://quizdock.github.io/docs/admin/overview/#allow-changes-from-the-web';

export function docLink(def: Pick<SettingDefinition, 'key' | 'category'>): string | null {
  return def.category === 'internal' ? null : `${DOCS_URL}#${def.key.toLowerCase()}`;
}

// ── Editing (§3.7, the control of a row) ────────────────────────────────────

export type Control =
  | { kind: 'flag' }
  | { kind: 'choice'; options: string[] }
  | { kind: 'number'; min?: number; max?: number; step: number; unit?: 'MB' | 's' }
  | { kind: 'list' }
  | { kind: 'links' }
  | { kind: 'text' };

/** The words a variable accepts, when it accepts a few: `` `on` · `off` ``. */
const CHOICES = /^`[^`]+`( · `[^`]+`)+$/;

interface NumberBounds {
  minValue?: number | null;
  maxValue?: number | null;
}

/** The control a setting is edited with, from its definition. */
export function controlOf(def: SettingDefinition): Control {
  if (def.key === 'MEDIA_LIBRARY_LINKS') return { kind: 'links' };
  if (CHOICES.test(def.accepts)) {
    const options = def.accepts.split(' · ').map((o) => o.replace(/`/g, ''));
    return options.length === 2 && options.includes('true') && options.includes('false')
      ? { kind: 'flag' }
      : { kind: 'choice', options };
  }
  if (typeof def.default === 'number') {
    const bounds = (def.bounds ?? {}) as NumberBounds;
    const shown = (n: number | null | undefined) =>
      typeof n === 'number' && Number.isFinite(n) ? displayNumber(def, n).amount : undefined;
    const unit = displayNumber(def, 0).unit;
    return {
      kind: 'number',
      min: shown(bounds.minValue),
      max: shown(bounds.maxValue),
      step: unit === 's' ? 0.5 : 1,
      unit,
    };
  }
  if (Array.isArray(def.default)) return { kind: 'list' };
  return { kind: 'text' };
}

/** The value as the control holds it: numbers in the administration's unit, lists as items. */
export function draftOf(def: SettingDefinition, value: unknown): unknown {
  if (typeof value === 'number') return displayNumber(def, value).amount;
  if (value === true || value === false) return value ? 'true' : 'false';
  return value;
}

/** The raw text an override stores, as `.env` would have it. */
export function rawOf(def: SettingDefinition, draft: unknown): string {
  if (def.key === 'MEDIA_LIBRARY_LINKS') {
    const links = draft as { name: string; url: string; kinds?: string[] }[];
    return links.length ? JSON.stringify(links) : 'none';
  }
  if (Array.isArray(draft))
    return draft
      .map((d) => String(d).trim())
      .filter(Boolean)
      .join(',');
  if (typeof draft === 'number') {
    if (def.unit === 'bytes') return String(Math.round(draft * MB));
    if (def.unit === 'ms') return String(Math.round(draft * 1000));
    return String(draft);
  }
  return String(draft ?? '');
}

/** Checked as typed, as the server will (§3.10: the server always decides). */
export function problemOf(def: SettingDefinition, raw: string): string | null {
  if (raw === '' && !def.allowEmpty) return def.accepts;
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) return def.accepts;
  if (def.bounds && !def.bounds.safeParse(parsed.data).success) return def.accepts;
  return null;
}
