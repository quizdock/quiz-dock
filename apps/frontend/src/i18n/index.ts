import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { appConfig } from '../config';
import { type AppLang, namespaces, supportedLngs } from './languages';
/**
 * i18n — dictionnaire 100 % côté front (le backend n'émet que des codes, cf.
 * ADR 0001).
 *
 * **Une seule langue par déploiement**, fixée via `APP_LANG` (.env → `config.js`
 * → `window.__APP_CONFIG__.lang`, comme `APP_NAME`). Pas de détection navigateur
 * ni de bascule par utilisateur : l'instance est self-hosted et le contenu des
 * quiz n'est pas multilingue, on évite donc toute incohérence langue UI / contenu.
 * Langues fournies : `en` (défaut), `fr`, `es`, `zh` (chinois simplifié),
 * `zh-TW` (chinois traditionnel), `tr` (turc). Vocabulaire et arbitrages : `GLOSSARY.md`.
 *
 * Chaque langue est un fichier à part, chargé à la demande (audit E16) : le
 * navigateur ne télécharge que celle de l'instance, et l'anglais pour une clé qui
 * manquerait, au lieu des six. `loadLanguages()` les charge avant le premier
 * rendu (`main.tsx`, et le setup des tests) : `t()` reste alors synchrone.
 */
const files = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');

export { namespaces, supportedLngs, type AppLang, type Namespace } from './languages';

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
  // Filled by `loadLanguages`, before the first render.
  resources: {},
  lng: resolveLang(),
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...supportedLngs],
  // `zh-TW` ne doit PAS retomber sur `zh` (simplifié) avant `en` : sans ceci
  // i18next résout zh-TW → zh → en, et une clé manquante s'affiche en simplifié.
  load: 'currentOnly',
  defaultNS,
  ns: [...namespaces],
  interpolation: { escapeValue: false }, // React échappe déjà
  react: { useSuspense: false }, // chargées avant le rendu → pas de Suspense
});

// The page says its language, for screen readers and the browser (index.html carries the default).
if (typeof document !== 'undefined') document.documentElement.lang = resolveLang();

/** Loads the instance's language, and English for a key it would miss, into i18next. */
export async function loadLanguages(): Promise<void> {
  const langs = [...new Set([resolveLang(), DEFAULT_LANG])];
  await Promise.all(
    langs.flatMap((lang) =>
      namespaces.map(async (ns) => {
        const { default: bundle } = await files[`./locales/${lang}/${ns}.json`]();
        i18next.addResourceBundle(lang, ns, bundle, true, true);
      }),
    ),
  );
}

export default i18next;
