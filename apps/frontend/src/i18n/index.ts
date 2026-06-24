import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { appConfig } from '../config';
import commonFr from './locales/fr/common.json';
import dashboardFr from './locales/fr/dashboard.json';
import editorFr from './locales/fr/editor.json';
import liveFr from './locales/fr/live.json';
import joinFr from './locales/fr/join.json';
import sessionsFr from './locales/fr/sessions.json';
import authFr from './locales/fr/auth.json';
import errorsFr from './locales/fr/errors.json';
import validationFr from './locales/fr/validation.json';
import commonEn from './locales/en/common.json';
import dashboardEn from './locales/en/dashboard.json';
import editorEn from './locales/en/editor.json';
import liveEn from './locales/en/live.json';
import joinEn from './locales/en/join.json';
import sessionsEn from './locales/en/sessions.json';
import authEn from './locales/en/auth.json';
import errorsEn from './locales/en/errors.json';
import validationEn from './locales/en/validation.json';
import commonEs from './locales/es/common.json';
import dashboardEs from './locales/es/dashboard.json';
import editorEs from './locales/es/editor.json';
import liveEs from './locales/es/live.json';
import joinEs from './locales/es/join.json';
import sessionsEs from './locales/es/sessions.json';
import authEs from './locales/es/auth.json';
import errorsEs from './locales/es/errors.json';
import validationEs from './locales/es/validation.json';
import commonZh from './locales/zh/common.json';
import dashboardZh from './locales/zh/dashboard.json';
import editorZh from './locales/zh/editor.json';
import liveZh from './locales/zh/live.json';
import joinZh from './locales/zh/join.json';
import sessionsZh from './locales/zh/sessions.json';
import authZh from './locales/zh/auth.json';
import errorsZh from './locales/zh/errors.json';
import validationZh from './locales/zh/validation.json';

/**
 * i18n — dictionnaire 100 % côté front (le backend n'émet que des codes, cf.
 * ADR 0001). Ressources **bundlées en synchrone** (pas de backend HTTP) : `t()`
 * renvoie le texte immédiatement, ce qui garde l'app ET les tests déterministes.
 *
 * **Une seule langue par déploiement**, fixée via `APP_LANG` (.env → `config.js`
 * → `window.__APP_CONFIG__.lang`, comme `APP_NAME`). Pas de détection navigateur
 * ni de bascule par utilisateur : l'instance est self-hosted et le contenu des
 * quiz n'est pas multilingue, on évite donc toute incohérence langue UI / contenu.
 * Langues fournies : `en` (défaut), `fr`, `es`, `zh` (chinois simplifié).
 */
export const resources = {
  en: {
    common: commonEn,
    dashboard: dashboardEn,
    editor: editorEn,
    live: liveEn,
    join: joinEn,
    sessions: sessionsEn,
    auth: authEn,
    errors: errorsEn,
    validation: validationEn,
  },
  fr: {
    common: commonFr,
    dashboard: dashboardFr,
    editor: editorFr,
    live: liveFr,
    join: joinFr,
    sessions: sessionsFr,
    auth: authFr,
    errors: errorsFr,
    validation: validationFr,
  },
  es: {
    common: commonEs,
    dashboard: dashboardEs,
    editor: editorEs,
    live: liveEs,
    join: joinEs,
    sessions: sessionsEs,
    auth: authEs,
    errors: errorsEs,
    validation: validationEs,
  },
  zh: {
    common: commonZh,
    dashboard: dashboardZh,
    editor: editorZh,
    live: liveZh,
    join: joinZh,
    sessions: sessionsZh,
    auth: authZh,
    errors: errorsZh,
    validation: validationZh,
  },
} as const;

export const supportedLngs = ['en', 'fr', 'es', 'zh'] as const;
export type AppLang = (typeof supportedLngs)[number];

const DEFAULT_LANG: AppLang = 'en';
export const defaultNS = 'common';

/**
 * Langue de l'instance : valeur d'`APP_LANG` (via `appConfig.lang`) si supportée,
 * sinon repli `en`. **En test, on épingle `fr`** (les assertions existantes sont
 * rédigées en français) pour rester déterministe.
 */
function resolveLang(): AppLang {
  if (import.meta.env.MODE === 'test') return 'fr';
  const configured = appConfig.lang;
  return (supportedLngs as readonly string[]).includes(configured)
    ? (configured as AppLang)
    : DEFAULT_LANG;
}

void i18next.use(initReactI18next).init({
  resources,
  lng: resolveLang(),
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...supportedLngs],
  defaultNS,
  ns: Object.keys(resources.en),
  interpolation: { escapeValue: false }, // React échappe déjà
  react: { useSuspense: false }, // ressources synchrones → pas de Suspense
});

export default i18next;
