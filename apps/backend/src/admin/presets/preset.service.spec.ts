import { PRESET_AXES, SETTING_LIST } from '@quiz-dock/contracts';
import type { OverridesService } from '../settings/overrides.service';
import { OverrideStore, settingsFrom } from '../settings/settings.service';
import { PresetService } from './preset.service';

describe('the questions of the quick setup (§3.9)', () => {
  const inAxis = SETTING_LIST.filter((d) => d.preset);

  it.each(inAxis.map((d) => [d.key, d]))(
    '%s has a value within its bounds for every answer, the standard one its default',
    (_k, def) => {
      const axis = PRESET_AXES.find((a) => a.id === def.preset!.axis)!;
      expect(Object.keys(def.preset!.levels).sort()).toEqual([...axis.levels].sort());
      for (const value of Object.values(def.preset!.levels)) {
        if (def.bounds) expect(def.bounds.safeParse(value).success).toBe(true);
      }
      expect(def.preset!.levels[axis.standard]).toEqual(def.default);
    },
  );

  it('no critical variable answers a question', () => {
    expect(inAxis.filter((d) => d.criticality === 'C1')).toEqual([]);
  });
});

describe('PresetService', () => {
  function service(env: Record<string, string> = {}, overrides: [string, string][] = []) {
    const store = new OverrideStore();
    store.replace(overrides);
    const applied: unknown[] = [];
    const svc = new PresetService(
      {
        apply: (changes: unknown) => {
          applied.push(changes);
          return Promise.resolve();
        },
      } as unknown as OverridesService,
      settingsFrom(env, store),
    );
    return { svc, applied };
  }
  const api = { via: 'api' as const, name: 'ada' };

  it("the defaults are each question's standard answer; a stray value is custom", () => {
    expect(service().svc.current()).toEqual({
      internet: 'connected',
      audience: 'colleagues',
      accessibility: 'standard',
    });
    expect(service({}, [['GAME_READ_DELAY_MS', '4000']]).svc.current().accessibility).toBe(
      'custom',
    );
  });

  it('plans each variable from what it is to what it becomes, leaving a locked one alone', () => {
    const { svc } = service({ ADMIN_LOCK: 'LIVE_MOTION' });
    expect(svc.plan(svc.resolve({ accessibility: 'adapted' }), api).changes).toEqual([
      { key: 'GAME_READ_DELAY_MS', from: { value: 3000, source: 'default' }, to: 6000 },
      { key: 'GAME_ALL_ANSWERED_DELAY_MS', from: { value: 1000, source: 'default' }, to: 2000 },
      {
        key: 'LIVE_MOTION',
        from: { value: 'on', source: 'default' },
        to: 'off',
        skipped: 'locked',
      },
    ]);
  });

  it('open access only with OIDC: in local mode, left alone and said so', () => {
    const { svc } = service();
    expect(svc.plan(svc.resolve({ audience: 'public' }), api).changes).toEqual([
      {
        key: 'ALLOW_ANONYMOUS_PARTICIPANTS',
        from: { value: false, source: 'default' },
        to: true,
        skipped: 'not-applicable',
      },
      { key: 'GAME_MEDIA_WAIT_S', from: { value: 10, source: 'default' }, to: 20 },
    ]);
    const oidc = service({ AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://id.example.org' }).svc;
    expect(oidc.plan(oidc.resolve({ audience: 'public' }), api).changes[0].skipped).toBeUndefined();
  });

  it('applies every change at once; offline, no media library', async () => {
    const { svc, applied } = service();
    await svc.apply(svc.plan(svc.resolve({ internet: 'offline' }), api), api);
    expect(applied).toEqual([[{ key: 'MEDIA_LIBRARY_LINKS', value: 'none' }]]);
  });

  it('refuses an unknown answer', () => {
    expect(() => service().svc.resolve({ internet: 'satellite' })).toThrow('No answer');
  });
});
