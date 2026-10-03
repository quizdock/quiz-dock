import { settingsFrom } from '../settings/settings.service';
import { checkOverride, envLine } from './settings.operations';

describe('settings.export, a value as a .env line', () => {
  it('bare when nothing in it is special', () => {
    expect(envLine('APP_NAME', 'QuizDock')).toBe('APP_NAME=QuizDock');
  });

  it('single-quoted otherwise: Compose reads it literally, a ${…} stays text', () => {
    expect(envLine('APP_LOGO_URL', 'https://x.example/l.png?${ADMIN_TOKEN}')).toBe(
      "APP_LOGO_URL='https://x.example/l.png?${ADMIN_TOKEN}'",
    );
    expect(envLine('APP_NAME', 'Quiz #1')).toBe("APP_NAME='Quiz #1'");
  });

  it('a single quote in it: double quotes, the $ escaped as $$', () => {
    expect(envLine('APP_NAME', "L'quiz ${X}")).toBe('APP_NAME="L\'quiz $${X}"');
  });
});

describe('an override and the rules between variables', () => {
  it('may not break a rule that holds', () => {
    const under = settingsFrom({ MEDIA_MAX_VIDEO_MB: '50' });
    expect(() => checkOverride(under, 'MEDIA_MAX_VIDEO_MB', '100')).toThrow(/above 64 MB/);
  });

  it('may move a value a broken rule already names: lowering 100 MB to 80 is no new break', () => {
    const above = settingsFrom({ MEDIA_MAX_VIDEO_MB: '100' });
    expect(() => checkOverride(above, 'MEDIA_MAX_VIDEO_MB', '80')).not.toThrow();
  });
});
