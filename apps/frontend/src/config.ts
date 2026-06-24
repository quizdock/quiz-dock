/**
 * Config de marque **runtime** (white-label). Surchargée sans rebuild via
 * `window.__APP_CONFIG__`, injecté par `/config.js` que le conteneur génère
 * depuis l'env au démarrage (cf. docker entrypoint + `APP_NAME`). Logo et CSS
 * sont des fichiers servis à chemin fixe, remplaçables par un volume Docker
 * monté sur `branding/`.
 */
export interface AppConfig {
  /** Nom affiché de l'app (header, titre d'onglet, partage). */
  appName: string;
  /** URL du logo (fichier remplaçable par volume). */
  logoUrl: string;
  /** Feuille de style d'override (fichier remplaçable par volume). */
  overrideCssUrl: string;
  /** Langue de l'UI pour cette instance (`APP_LANG`). Une seule par déploiement. */
  lang: string;
}

const DEFAULTS: AppConfig = {
  appName: 'QuizDock',
  logoUrl: '/branding/logo.svg',
  overrideCssUrl: '/branding/override.css',
  lang: 'en',
};

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

export const appConfig: AppConfig = {
  ...DEFAULTS,
  ...(typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined),
};

/** Raccourci du nom d'app (le plus utilisé). */
export const APP_NAME = appConfig.appName;
