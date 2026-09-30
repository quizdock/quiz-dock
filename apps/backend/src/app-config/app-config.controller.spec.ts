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
