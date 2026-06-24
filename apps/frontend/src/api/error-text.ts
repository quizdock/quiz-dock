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

/** Une erreur de validation par champ : code Zod générique résolu via `validation`. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Traduit chaque issue de validation `{ field, code }` (codes Zod génériques émis
 * par le backend, ADR 0001) en message via le dictionnaire `validation`.
 */
export function validationFieldErrors(errors: { field: string; code: string }[]): FieldError[] {
  return errors.map((e) => ({
    field: e.field,
    message: i18next.t(`validation:${e.code}`, { defaultValue: i18next.t('validation:_default') }),
  }));
}
