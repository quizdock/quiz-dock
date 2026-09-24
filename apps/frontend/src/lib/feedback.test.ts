import { describe, expect, it } from 'vitest';
import { describeBrowser, feedbackLinks } from './feedback';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const context = { version: '0.7.1', lang: 'fr', userAgent: CHROME };

describe('feedback links', () => {
  it('names the browser and the system', () => {
    expect(describeBrowser(CHROME)).toBe('Chrome 143 on Windows');
    expect(describeBrowser(SAFARI_IPHONE)).toBe('Safari 18 on iOS');
    expect(describeBrowser('curl/8')).toBe('');
  });

  it('fills the QuizDock issue forms by default', () => {
    const links = feedbackLinks('', context);
    expect(links.map((l) => l.kind)).toEqual(['bug', 'feature', 'translation', 'question']);
    const bug = new URL(links[0].href);
    expect(bug.origin + bug.pathname).toBe('https://github.com/quizdock/quiz-dock/issues/new');
    expect(Object.fromEntries(bug.searchParams)).toEqual({
      template: 'bug.yml',
      version: '0.7.1',
      browser: 'Chrome 143 on Windows',
    });
    expect(new URL(links[2].href).searchParams.get('language')).toBe('Français (fr)');
    expect(links[3].href).toBe(
      'https://github.com/quizdock/quiz-dock/discussions/new?category=q-a',
    );
  });

  it("leads to the operator's GitHub repository, or to any other address as one link", () => {
    expect(feedbackLinks('https://github.com/acme/quiz/', context)[0].href).toMatch(
      /^https:\/\/github\.com\/acme\/quiz\/issues\/new\?template=bug\.yml/,
    );
    expect(feedbackLinks('https://support.acme.org/quiz', context)).toEqual([
      { kind: 'bug', href: 'https://support.acme.org/quiz' },
    ]);
  });

  it('shows nothing when the operator turned them off', () => {
    expect(feedbackLinks('none', context)).toEqual([]);
    expect(feedbackLinks(' none ', context)).toEqual([]);
  });
});
