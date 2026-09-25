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
