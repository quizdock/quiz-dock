import { envLine } from './settings.operations';

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
