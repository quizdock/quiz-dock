import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from './locales/fr/common.json';
import dashboard from './locales/fr/dashboard.json';
import editor from './locales/fr/editor.json';
import live from './locales/fr/live.json';
import join from './locales/fr/join.json';
import sessions from './locales/fr/sessions.json';
import auth from './locales/fr/auth.json';
import errors from './locales/fr/errors.json';
import validation from './locales/fr/validation.json';

/**
 * i18n — dictionnaire 100 % côté front (le backend n'émet que des codes, cf.
 * ADR 0001). Ressources **bundlées en synchrone** (pas de backend HTTP) : `t()`
 * renvoie le texte immédiatement, ce qui garde l'app ET les tests déterministes.
 *
 * FR seul livré, mais structure multi-langue prête : ajouter `locales/en/` et
 * l'enregistrer dans `resources` suffit.
 */
export const resources = {
  fr: { common, dashboard, editor, live, join, sessions, auth, errors, validation },
} as const;

export const defaultNS = 'common';

void i18next.use(initReactI18next).init({
  resources,
  lng: 'fr',
  fallbackLng: 'fr',
  defaultNS,
  ns: Object.keys(resources.fr),
  interpolation: { escapeValue: false }, // React échappe déjà
  react: { useSuspense: false }, // ressources synchrones → pas de Suspense
});

export default i18next;
