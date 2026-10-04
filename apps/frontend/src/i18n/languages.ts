// The languages and namespaces, apart from `index.ts`: importing them does not
// initialise i18next again.

import { appConfig } from '../config';

/** The namespaces, one file each per language. */
export const namespaces = [
  'common',
  'dashboard',
  'editor',
  'live',
  'join',
  'sessions',
  'store',
  'auth',
  'errors',
  'validation',
  'admin',
] as const;

export const supportedLngs = ['en', 'fr', 'es', 'zh', 'zh-TW', 'tr'] as const;
export type AppLang = (typeof supportedLngs)[number];
export type Namespace = (typeof namespaces)[number];

/** A language's name in the interface's language (`fr` → "French" in English), for a menu. */
export function languageName(tag: string, interfaceLang: string): string {
  try {
    return new Intl.DisplayNames([interfaceLang], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag; // not a tag Intl knows
  }
}

const DEFAULT_LANG: AppLang = 'en';

/**
 * Langue de l'instance : valeur d'`APP_LANG` (via `appConfig.lang`) si supportée,
 * sinon repli `en`. **En test, on épingle `fr`** (les assertions existantes sont
 * rédigées en français) pour rester déterministe.
 */
export function resolveLang(): AppLang {
  if (import.meta.env.MODE === 'test') return 'fr';
  const configured = appConfig.lang;
  return (supportedLngs as readonly string[]).includes(configured)
    ? (configured as AppLang)
    : DEFAULT_LANG;
}
