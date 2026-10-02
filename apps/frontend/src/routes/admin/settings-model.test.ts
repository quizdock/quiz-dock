import { describe, expect, it } from 'vitest';
import { fieldsOf, paramsFrom } from './operation-panel';
import {
  type SettingRow,
  type SettingsAccess,
  editable,
  matches,
  readOnlyReason,
  shownValue,
} from './settings-model';

const row = (over: Partial<SettingRow> = {}): SettingRow => ({
  key: 'GAME_READ_DELAY_MS',
  category: 'pace',
  criticality: 'C3',
  applies: 'live',
  overridable: true,
  secret: false,
  value: 3000,
  source: 'default',
  default: 3000,
  locked: false,
  issues: [],
  ...over,
});

const access = (over: Partial<SettingsAccess> = {}): SettingsAccess => ({
  scope: 'write',
  locks: [],
  authMode: 'oidc',
  tokenRequired: false,
  tokenSet: false,
  safeMode: false,
  ...over,
});

describe('settings, as the administration shows them', () => {
  it('speaks megabytes and seconds, whatever the variable is written in', () => {
    expect(shownValue(row(), 3000)).toEqual({ kind: 'number', amount: 3, unit: 's' });
    expect(shownValue(row({ key: 'MEDIA_MAX_BYTES' }), 10 * 1024 * 1024)).toEqual({
      kind: 'number',
      amount: 10,
      unit: 'MB',
    });
    expect(shownValue(row({ key: 'MEDIA_MAX_VIDEO_MB' }), 50)).toEqual({
      kind: 'number',
      amount: 50,
      unit: 'MB',
    });
    expect(shownValue(row({ key: 'GAME_MEDIA_WAIT_S' }), 10)).toEqual({
      kind: 'number',
      amount: 10,
      unit: 's',
    });
  });

  it('a secret is only set or not; lists by name; empty is empty', () => {
    expect(shownValue(row({ key: 'ADMIN_TOKEN', secret: true }), true)).toEqual({
      kind: 'secret',
      set: true,
    });
    expect(shownValue(row({ key: 'MEDIA_LIBRARY_LINKS' }), [{ name: 'Freesound' }])).toEqual({
      kind: 'list',
      items: ['Freesound'],
    });
    expect(shownValue(row({ key: 'APP_LOGO_URL' }), '')).toEqual({ kind: 'empty' });
    expect(shownValue(row({ key: 'LIVE_MOTION' }), 'off')).toEqual({ kind: 'flag', on: false });
  });

  it('says why a setting is read-only', () => {
    expect(readOnlyReason(row({ overridable: false }), access())).toBe('critical');
    expect(readOnlyReason(row({ locked: true }), access())).toBe('locked');
    expect(readOnlyReason(row(), access({ scope: 'read' }))).toBe('scope');
    expect(readOnlyReason(row(), access({ safeMode: true }))).toBe('safe-mode');
    expect(readOnlyReason(row(), access())).toBeNull();
    expect(editable(row(), access())).toBe(true);
  });

  it('searches the name, the label and the description; filters', () => {
    const label = () => 'Reading time before the timer';
    const none = new Set<never>();
    expect(matches(row(), 'reading time', none, access(), label)).toBe(true);
    expect(matches(row(), 'timer starts', none, access(), label)).toBe(true);
    expect(matches(row(), 'logo', none, access(), label)).toBe(false);
    expect(matches(row(), '', new Set(['changed'] as const), access(), label)).toBe(false);
    expect(
      matches(row({ source: 'env' }), '', new Set(['changed'] as const), access(), label),
    ).toBe(true);
    expect(matches(row(), '', new Set(['problem'] as const), access(), label)).toBe(false);
    expect(
      matches(row(), '', new Set(['editable'] as const), access({ scope: 'read' }), label),
    ).toBe(false);
  });
});

describe('operation forms', () => {
  const descriptor = {
    params: {
      type: 'object',
      properties: {
        user: { type: 'string' },
        limit: { type: 'integer' },
        all: { type: 'boolean' },
      },
      required: ['user'],
    },
  };

  it('fields come from the schema, values are typed by it, empty ones left out', () => {
    expect(fieldsOf(descriptor).map((f) => [f.name, f.required])).toEqual([
      ['user', true],
      ['limit', false],
      ['all', false],
    ]);
    expect(paramsFrom(fieldsOf(descriptor), { user: 'ada', limit: '20', all: true })).toEqual({
      user: 'ada',
      limit: 20,
      all: true,
    });
    expect(paramsFrom(fieldsOf(descriptor), { user: 'ada', limit: '' })).toEqual({ user: 'ada' });
  });
});
