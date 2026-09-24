/** The project's repository: where feedback goes unless the operator says otherwise. */
export const QUIZDOCK_REPOSITORY = 'https://github.com/quizdock/quiz-dock';

export type FeedbackKind = 'bug' | 'feature' | 'translation' | 'question';

export interface FeedbackLink {
  kind: FeedbackKind;
  href: string;
}

/** The interface languages, as the translation form lists them. */
const LANGUAGE_OPTION: Record<string, string> = {
  en: 'English (en)',
  fr: 'Français (fr)',
  es: 'Español (es)',
  zh: '简体中文 (zh)',
  'zh-TW': '繁體中文 (zh-TW)',
};

/** Browsers, most specific first (Edge and Chrome both say "Chrome"; Chrome says "Safari"). */
const BROWSERS: Array<[string, RegExp]> = [
  ['Edge', /Edg\/(\d+)/],
  ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /Chrome\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari/],
];
const SYSTEMS: Array<[string, RegExp]> = [
  ['iOS', /iPhone|iPad/],
  ['Android', /Android/],
  ['Windows', /Windows/],
  ['macOS', /Mac OS X/],
  ['Linux', /Linux/],
];

/** "Chrome 143 on Windows", from the user agent: enough to start a bug report, easy to correct. */
export function describeBrowser(ua: string): string {
  const browser = BROWSERS.map(([name, re]) => [name, re.exec(ua)?.[1]] as const).find(
    ([, version]) => version,
  );
  const system = SYSTEMS.find(([, re]) => re.test(ua))?.[0];
  return [browser && `${browser[0]} ${browser[1]}`, system].filter(Boolean).join(' on ');
}

/**
 * The home page's feedback links (`APP_FEEDBACK_URL`): none when it is `none`;
 * GitHub issue forms filled in with the version, browser and language for a
 * GitHub repository (the QuizDock one by default); a single link to any other
 * address, whose forms we know nothing of.
 */
export function feedbackLinks(
  configured: string | undefined,
  context: { version: string; lang: string; userAgent: string },
): FeedbackLink[] {
  const url = configured?.trim() || QUIZDOCK_REPOSITORY;
  if (url === 'none') return [];
  const repository = /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+/.exec(url)?.[0];
  if (!repository) return [{ kind: 'bug', href: url }];
  const issue = (template: string, fields: Record<string, string>) =>
    `${repository}/issues/new?${new URLSearchParams({ template, ...fields }).toString()}`;
  const version = context.version;
  return [
    {
      kind: 'bug',
      href: issue('bug.yml', { version, browser: describeBrowser(context.userAgent) }),
    },
    { kind: 'feature', href: issue('feature.yml', { version }) },
    {
      kind: 'translation',
      href: issue('translation.yml', {
        version,
        ...(LANGUAGE_OPTION[context.lang] ? { language: LANGUAGE_OPTION[context.lang] } : {}),
      }),
    },
    { kind: 'question', href: `${repository}/discussions/new?category=q-a` },
  ];
}
