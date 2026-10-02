import { NAMED_PRESETS, PRESET_AXES, SETTING_LIST } from '@quiz-dock/contracts';
import type { OverridesService } from '../settings/overrides.service';
import { OverrideStore, settingsFrom } from '../settings/settings.service';
import { PresetService } from './preset.service';

describe('the presets of the registry (§3.9)', () => {
  const inAxis = SETTING_LIST.filter((d) => d.preset);

  it.each(inAxis.map((d) => [d.key, d]))(
    '%s has a value within its bounds at every level of its axis',
    (_k, def) => {
      const axis = PRESET_AXES.find((a) => a.id === def.preset!.axis)!;
      expect(Object.keys(def.preset!.levels).sort()).toEqual([...axis.levels].sort());
      for (const value of Object.values(def.preset!.levels)) {
        if (def.bounds) expect(def.bounds.safeParse(value).success).toBe(true);
      }
      expect(def.preset!.levels[axis.standard]).toEqual(def.default);
    },
  );

  it('no critical variable has an axis', () => {
    expect(inAxis.filter((d) => d.criticality === 'C1')).toEqual([]);
  });

  it('a named preset only names axes and levels that exist', () => {
    for (const preset of NAMED_PRESETS) {
      for (const [axis, level] of Object.entries(preset.levels)) {
        expect(PRESET_AXES.find((a) => a.id === axis)?.levels).toContain(level);
      }
    }
  });
});

describe('PresetService', () => {
  function service(env: Record<string, string> = {}, overrides: [string, string][] = []) {
    const store = new OverrideStore();
    store.replace(overrides);
    const applied: unknown[] = [];
    const svc = new PresetService({
      apply: (changes: unknown) => {
        applied.push(changes);
        return Promise.resolve();
      },
    } as unknown as OverridesService);
    svc.settings = settingsFrom(env, store);
    return { svc, applied };
  }
  const api = { via: 'api' as const, name: 'ada' };

  it('the defaults stand at each axis standard; a stray value is custom', () => {
    expect(service().svc.current()).toEqual({
      pace: 'standard',
      venue: 'standard',
      audience: 'accounts',
    });
    expect(service({}, [['GAME_READ_DELAY_MS', '4000']]).svc.current().pace).toBe('custom');
    expect(
      service({}, [
        ['GAME_READ_DELAY_MS', '6000'],
        ['GAME_AUTO_ADVANCE_MS', '8000'],
        ['GAME_ALL_ANSWERED_DELAY_MS', '2000'],
      ]).svc.current().pace,
    ).toBe('comfortable');
  });

  it('plans each variable from what it is to what it becomes, leaving a locked one and an axis that does not apply', () => {
    const { svc } = service({ ADMIN_LOCK: 'LIVE_MOTION' });
    const plan = svc.plan(svc.resolve({ preset: 'accessible' }), api);
    expect(plan.changes).toEqual([
      { key: 'GAME_READ_DELAY_MS', from: { value: 3000, source: 'default' }, to: 6000 },
      { key: 'GAME_ALL_ANSWERED_DELAY_MS', from: { value: 1000, source: 'default' }, to: 2000 },
      { key: 'GAME_AUTO_ADVANCE_MS', from: { value: 5000, source: 'default' }, to: 8000 },
      { key: 'MEDIA_MAX_VIDEO_MB', from: { value: 50, source: 'default' }, to: 20 },
      { key: 'GAME_MEDIA_WAIT_S', from: { value: 10, source: 'default' }, to: 30 },
      {
        key: 'LIVE_MOTION',
        from: { value: 'on', source: 'default' },
        to: 'off',
        skipped: 'locked',
      },
    ]);
    // Local mode: no participant authenticates, the audience does not apply.
    const party = svc.plan(svc.resolve({ preset: 'party' }), api);
    expect(party.changes).toContainEqual(
      expect.objectContaining({ key: 'ALLOW_ANONYMOUS_PARTICIPANTS', skipped: 'not-applicable' }),
    );
  });

  it('applies every change at once, as overrides, skipping what it must', async () => {
    const { svc, applied } = service({ ADMIN_LOCK: 'LIVE_MOTION' });
    await svc.apply(svc.plan(svc.resolve({ axes: { venue: 'modest' } }), api), api);
    expect(applied).toEqual([
      [
        { key: 'MEDIA_MAX_VIDEO_MB', value: '20' },
        { key: 'GAME_MEDIA_WAIT_S', value: '30' },
      ],
    ]);
  });

  it('refuses an unknown preset or level', () => {
    const { svc } = service();
    expect(() => svc.resolve({ preset: 'rave' })).toThrow('No preset');
    expect(() => svc.resolve({ axes: { pace: 'warp' } })).toThrow('No level');
  });
});
