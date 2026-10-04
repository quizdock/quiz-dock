// The languages and namespaces, apart from `index.ts`: importing them does not
// initialise i18next again.

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
