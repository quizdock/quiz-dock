import { AppConfigController } from './app-config.controller';

describe('AppConfigController — config.js', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it('carries where the feedback links lead, empty by default', () => {
    process.env = { ...env };
    delete process.env.APP_FEEDBACK_URL;
    expect(new AppConfigController().configJs()).toContain('feedbackUrl: ""');
  });

  it('carries `none` or an address, escaped for a JS string', () => {
    process.env = { ...env, APP_FEEDBACK_URL: 'none' };
    expect(new AppConfigController().configJs()).toContain('feedbackUrl: "none"');
    process.env = { ...env, APP_FEEDBACK_URL: 'https://x.org/"a"' };
    expect(new AppConfigController().configJs()).toContain('feedbackUrl: "https://x.org/\\"a\\""');
  });
});
