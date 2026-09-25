/**
 * The instance's language (`APP_LANG`, `en` by default): the UI speaks it, and
 * a quiz starts in it unless told otherwise (#83). One per deployment.
 */
export function instanceLanguage(): string {
  return process.env.APP_LANG || 'en';
}
