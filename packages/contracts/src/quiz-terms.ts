// ─── Terms a quiz travels under ────────────────────────────────────────────

/**
 * Licences an author can put on a quiz (SPDX identifiers). The same three for
 * the internal store (#39) and the community store (#21): whatever is chosen
 * can always be published, and all three allow reuse.
 */
export const QUIZ_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'] as const;
export type QuizLicense = (typeof QUIZ_LICENSES)[number];

export function isQuizLicense(value: string | null | undefined): value is QuizLicense {
  return (QUIZ_LICENSES as readonly string[]).includes(value ?? '');
}

/** A tag: kebab-case, like the quiz slug. */
export const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TAG_MAX_LENGTH = 30;
export const QUIZ_MAX_TAGS = 5;

/** What an author typed, as a tag ("Pop Culture " → "pop-culture"); '' when nothing is left. */
export function toTag(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * A quiz's language, a BCP 47 tag ("en", "zh-TW"). A quiz is monolingual; the
 * settings offer the common ones below, and an imported quiz may carry another.
 */
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const QUIZ_LANGUAGES = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'pl',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'ar',
] as const;
