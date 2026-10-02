import { describe, expect, it } from 'vitest';
import { fieldsOf, paramsFrom } from './operation-panel';
import {
  type SettingRow,
  type SettingsAccess,
  controlOf,
  definitionOf,
  draftOf,
  problemOf,
  rawOf,
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

describe('editing a setting', () => {
  const def = (key: string) => definitionOf(key)!;

  it('picks the control from the definition', () => {
    expect(controlOf(def('ALLOW_ANONYMOUS_PARTICIPANTS'))).toEqual({ kind: 'flag' });
    expect(controlOf(def('LIVE_MOTION'))).toEqual({ kind: 'choice', options: ['on', 'off'] });
    expect(controlOf(def('APP_LANG'))).toMatchObject({
      kind: 'choice',
      options: expect.arrayContaining(['fr', 'zh-TW']),
    });
    expect(controlOf(def('GAME_READ_DELAY_MS'))).toEqual({
      kind: 'number',
      min: 0,
      max: 10,
      step: 0.5,
      unit: 's',
    });
    expect(controlOf(def('MEDIA_MAX_BYTES'))).toEqual({
      kind: 'number',
      min: 1,
      max: 50,
      step: 1,
      unit: 'MB',
    });
    expect(controlOf(def('HOST_LAN_IPS'))).toEqual({ kind: 'list' });
    expect(controlOf(def('MEDIA_LIBRARY_LINKS'))).toEqual({ kind: 'links' });
    expect(controlOf(def('APP_NAME'))).toEqual({ kind: 'text' });
  });

  it('writes the value back in the variable own unit', () => {
    expect(rawOf(def('GAME_READ_DELAY_MS'), 1.5)).toBe('1500');
    expect(rawOf(def('MEDIA_MAX_BYTES'), 12)).toBe(String(12 * 1024 * 1024));
    expect(rawOf(def('MEDIA_MAX_VIDEO_MB'), 80)).toBe('80');
    expect(rawOf(def('HOST_LAN_IPS'), ['10.0.0.2', ' ', '10.0.0.3'])).toBe('10.0.0.2,10.0.0.3');
    expect(rawOf(def('MEDIA_LIBRARY_LINKS'), [])).toBe('none');
    expect(draftOf(def('GAME_READ_DELAY_MS'), 3000)).toBe(3);
  });

  it('checks as typed, as the server will', () => {
    expect(problemOf(def('GAME_READ_DELAY_MS'), '1500')).toBeNull();
    expect(problemOf(def('GAME_READ_DELAY_MS'), '20000')).toContain('10000');
    expect(problemOf(def('APP_LANG'), 'xx')).not.toBeNull();
    expect(problemOf(def('APP_NAME'), '')).not.toBeNull();
  });
});
