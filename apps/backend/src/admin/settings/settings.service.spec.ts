import { SETTINGS, SETTING_LIST } from '@quiz-dock/contracts';
import { OverrideStore, SettingsService, recordSource, settingsFrom } from './settings.service';

describe('the settings registry', () => {
  it.each(SETTING_LIST.map((def) => [def.key, def]))(
    '%s is declared under its own name',
    (key, def) => {
      expect(SETTINGS[key as keyof typeof SETTINGS]).toBe(def);
    },
  );

  it.each(SETTING_LIST.filter((d) => d.bounds).map((def) => [def.key, def]))(
    "%s's default is within its bounds",
    (_key, def) => {
      if (def.default === '' || (Array.isArray(def.default) && !def.default.length)) return;
      expect(def.bounds!.safeParse(def.default).success).toBe(true);
    },
  );

  it.each(SETTING_LIST.filter((d) => d.criticality === 'C1').map((d) => [d.key, d]))(
    '%s, critical, cannot be overridden',
    (_key, def) => expect(def.overridable).toBe(false),
  );

  it('a secret is never critical below C1', () => {
    expect(SETTING_LIST.filter((d) => d.secret).every((d) => d.criticality === 'C1')).toBe(true);
  });
});

describe('SettingsService', () => {
  it('unset, the default; set, the value read', () => {
    expect(settingsFrom({}).describe(SETTINGS.GAME_READ_DELAY_MS)).toEqual({
      key: 'GAME_READ_DELAY_MS',
      value: 3000,
      source: 'default',
      issues: [],
    });
    expect(
      settingsFrom({ GAME_READ_DELAY_MS: '1500' }).describe(SETTINGS.GAME_READ_DELAY_MS),
    ).toMatchObject({
      value: 1500,
      source: 'env',
    });
  });

  it('empty is unset, unless the setting takes an empty value', () => {
    const s = settingsFrom({ APP_LANG: '', APP_NAME: '' });
    expect(s.describe(SETTINGS.APP_LANG)).toMatchObject({ value: 'en', source: 'default' });
    expect(s.describe(SETTINGS.APP_NAME)).toMatchObject({ value: '', source: 'env' });
  });

  it('unreadable: the default, and a warning naming the value and what it accepts', () => {
    const { value, issues } = settingsFrom({ MEDIA_MAX_VIDEO_MB: 'lots' }).describe(
      SETTINGS.MEDIA_MAX_VIDEO_MB,
    );
    expect(value).toBe(50);
    expect(issues).toEqual([
      {
        key: 'MEDIA_MAX_VIDEO_MB',
        code: 'unreadable',
        message:
          'MEDIA_MAX_VIDEO_MB="lots" cannot be read (not a number; accepts 1 to 500 (MB)): 50 is used instead.',
      },
    ]);
  });

  it('a critical value unreadable announces the refusal to come with v1', () => {
    const [issue] = settingsFrom({ AUTH_MODE: 'OIDC' }).describe(SETTINGS.AUTH_MODE).issues;
    expect(issue.message).toBe(
      'AUTH_MODE="OIDC" cannot be read (not one of none, oidc; accepts `none` · `oidc`): "none" is used instead. From v1, the instance will refuse to start.',
    );
  });

  it('out of bounds: kept as is, and reported', () => {
    const { value, issues } = settingsFrom({ GAME_READ_DELAY_MS: '-500' }).describe(
      SETTINGS.GAME_READ_DELAY_MS,
    );
    expect(value).toBe(-500);
    expect(issues).toMatchObject([{ code: 'out-of-bounds' }]);
  });

  it('a secret is never quoted', () => {
    const s = settingsFrom({
      DATABASE_URL: 'postgresql://u:hunter2@db/x',
      OIDC_CLIENT_SECRET: 'hunter2',
    });
    const messages = [
      ...s.describe(SETTINGS.DATABASE_URL).issues,
      ...s.describe(SETTINGS.OIDC_CLIENT_SECRET).issues,
    ].map((i) => i.message);
    expect(messages.join(' ')).not.toContain('hunter2');
  });

  it('a deprecated variable is reported when set', () => {
    expect(settingsFrom({ OIDC_SESSION_SCOPE: 'x' }).issues()).toMatchObject([
      { key: 'OIDC_SESSION_SCOPE', code: 'deprecated' },
    ]);
  });

  it('reads the source again on each call, parsing a raw text once', () => {
    const env: Record<string, string | undefined> = { MEDIA_LIBRARY_LINKS: 'none' };
    const s = new SettingsService([recordSource(env)]);
    const parse = jest.spyOn(SETTINGS.MEDIA_LIBRARY_LINKS.schema, 'safeParse');
    expect(s.get(SETTINGS.MEDIA_LIBRARY_LINKS)).toEqual([]);
    expect(s.get(SETTINGS.MEDIA_LIBRARY_LINKS)).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(1);
    env.MEDIA_LIBRARY_LINKS = undefined;
    expect(s.get(SETTINGS.MEDIA_LIBRARY_LINKS)).toHaveLength(7);
    parse.mockRestore();
  });

  describe('rules between variables', () => {
    const rules = (env: Record<string, string>) =>
      settingsFrom(env)
        .issues()
        .filter((i) => i.code === 'rule')
        .map((i) => i.key);

    it('nothing to say about an empty environment', () => {
      expect(settingsFrom({}).issues()).toEqual([]);
    });

    it('anonymous participants need OIDC', () => {
      expect(rules({ ALLOW_ANONYMOUS_PARTICIPANTS: 'true' })).toEqual([
        'ALLOW_ANONYMOUS_PARTICIPANTS',
      ]);
      expect(
        rules({
          ALLOW_ANONYMOUS_PARTICIPANTS: 'true',
          AUTH_MODE: 'oidc',
          OIDC_ISSUER: 'https://id.example.org',
        }),
      ).toEqual([]);
    });

    it('an upload limit above the proxy of the two-container setup is flagged', () => {
      expect(rules({ MEDIA_MAX_VIDEO_MB: '64' })).toEqual([]);
      expect(rules({ MEDIA_MAX_VIDEO_MB: '65' })).toEqual(['MEDIA_MAX_VIDEO_MB']);
      expect(rules({ IMPORT_MAX_BYTES: String(100 * 1024 * 1024) })).toEqual([
        'MEDIA_MAX_VIDEO_MB',
      ]);
    });
  });

  describe('overrides', () => {
    const store = () => {
      const s = new OverrideStore();
      s.replace([
        ['GAME_READ_DELAY_MS', '1500'],
        ['AUTH_MODE', 'oidc'],
      ]);
      return s;
    };

    it('win over .env, which stays known', () => {
      const s = settingsFrom({ GAME_READ_DELAY_MS: '2000' }, store());
      expect(s.describe(SETTINGS.GAME_READ_DELAY_MS)).toMatchObject({
        value: 1500,
        source: 'override',
        envValue: 2000,
      });
      expect(settingsFrom({}, store()).describe(SETTINGS.GAME_READ_DELAY_MS).envValue).toBe(3000);
    });

    it('never reach a critical variable', () => {
      expect(settingsFrom({}, store()).get(SETTINGS.AUTH_MODE)).toBe('none');
    });

    it('safe mode: kept, not applied', () => {
      expect(
        settingsFrom({ ADMIN_OVERRIDES: 'ignore' }, store()).describe(SETTINGS.GAME_READ_DELAY_MS),
      ).toMatchObject({ value: 3000, source: 'default' });
    });

    it('a candidate change is seen with the rules, without touching the settings', () => {
      const s = settingsFrom({ AUTH_MODE: 'none' }, new OverrideStore());
      const candidate = s.withOverrides({ ALLOW_ANONYMOUS_PARTICIPANTS: 'true' });
      expect(candidate.issues().map((i) => i.key)).toContain('ALLOW_ANONYMOUS_PARTICIPANTS');
      expect(s.issues()).toEqual([]);
    });
  });
});
