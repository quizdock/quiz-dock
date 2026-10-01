import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigController } from './app-config.controller';

/** What the page reads: the script run as the browser would, and the config it sets. */
function served(): Record<string, unknown> {
  const window: { __APP_CONFIG__?: Record<string, unknown> } = {};
  new Function('window', new AppConfigController().configJs())(window);
  return window.__APP_CONFIG__!;
}

describe('AppConfigController — config.js', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it('carries where the feedback links lead, empty by default', () => {
    process.env = { ...env };
    delete process.env.APP_FEEDBACK_URL;
    expect(served().feedbackUrl).toBe('');
  });

  it('carries `none` or an address, whatever it holds', () => {
    process.env = { ...env, APP_FEEDBACK_URL: 'none' };
    expect(served().feedbackUrl).toBe('none');
    process.env = { ...env, APP_FEEDBACK_URL: 'https://x.org/"a"\\b' };
    expect(served().feedbackUrl).toBe('https://x.org/"a"\\b');
  });

  it('says whether a new room’s screens move between steps: yes, unless LIVE_MOTION=off', () => {
    process.env = { ...env };
    delete process.env.LIVE_MOTION;
    expect(served().liveMotion).toBe(true);
    process.env = { ...env, LIVE_MOTION: ' OFF ' };
    expect(served().liveMotion).toBe(false);
  });

  it('keeps a valid script when a value holds a line break (audit B15)', () => {
    process.env = { ...env, APP_NAME: 'Quiz\nNight' };
    expect(served().appName).toBe('Quiz\nNight');
  });
});

describe('AppConfigController — the installed app (PWA)', () => {
  const env = process.env;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'client-'));
    mkdirSync(join(dir, 'icons'));
    mkdirSync(join(dir, 'branding'));
    writeFileSync(join(dir, 'icons', 'quizdock.png'), 'quizdock');
    writeFileSync(
      join(dir, 'manifest.webmanifest'),
      JSON.stringify({
        name: 'QuizDock',
        short_name: 'QuizDock',
        lang: 'en',
        display: 'standalone',
      }),
    );
  });
  afterEach(() => {
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  });

  it('names the manifest after the instance, in its language', async () => {
    process.env = { ...env, CLIENT_DIR: dir, APP_NAME: 'Quiz "Night"', APP_LANG: 'fr' };
    const manifest = JSON.parse(await new AppConfigController().manifest()) as Record<
      string,
      string
    >;
    expect(manifest).toMatchObject({
      name: 'Quiz "Night"',
      short_name: 'Quiz "Night"',
      lang: 'fr',
      display: 'standalone',
    });
  });

  it('serves the operator’s favicon when given, QuizDock’s otherwise', async () => {
    process.env = { ...env, CLIENT_DIR: dir };
    const sent = async (icon: string) => {
      const res = { sendFile: jest.fn() };
      await new AppConfigController().icon({ path: `/${icon}` } as never, res as never);
      return res.sendFile.mock.calls[0][0] as string;
    };
    expect(await sent('favicon.png')).toBe(join(dir, 'icons', 'quizdock.png'));
    writeFileSync(join(dir, 'branding', 'favicon.png'), 'operator');
    expect(await sent('favicon.png')).toBe(join(dir, 'branding', 'favicon.png'));
  });
});
