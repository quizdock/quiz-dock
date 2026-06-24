import i18next from 'i18next';

/**
 * Résout un **code d'erreur backend** (token, ex. `session.not_found`) en texte
 * lisible via le dictionnaire i18n `errors` (ADR 0001). `params` couvre les codes
 * interpolés (`quiz.transition_forbidden` → `{ from, target }`). Code inconnu →
 * message générique.
 */
export function errorText(code: string, params?: Record<string, unknown>): string {
  return i18next.t(`errors:${code}`, { ...params, defaultValue: i18next.t('errors:error') });
}
