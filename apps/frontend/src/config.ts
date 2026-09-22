import defaultLogoUrl from '@/assets/default-logo.svg';

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
  /**
   * Explicit logo URL (`APP_LOGO_URL`), for a logo served from elsewhere — a CDN, a
   * path outside `branding/`. Empty or unset by default, which is the normal setup: the
   * header then looks in the mounted branding folder instead (see `LOGO_CANDIDATES`).
   */
  logoUrl?: string;
  /** Feuille de style d'override (fichier remplaçable par volume). */
  overrideCssUrl: string;
  /** Langue de l'UI pour cette instance (`APP_LANG`). Une seule par déploiement. */
  lang: string;
}

const DEFAULTS: AppConfig = {
  appName: 'QuizDock',
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

/**
 * Formats tried for `/branding/logo.<ext>`, best first: vector, then the modern codecs,
 * then the universal raster formats, then the legacy ones. An operator normally drops a
 * single file, so the order only decides which one wins if several are present.
 */
export const LOGO_EXTENSIONS = ['svg', 'avif', 'webp', 'png', 'jpg', 'jpeg', 'gif'] as const;

/**
 * Logo URLs to try in order, until one decodes. `APP_LOGO_URL` short-circuits the lookup;
 * otherwise the mounted branding folder is searched, format by format. The bundled
 * default closes the list: it ships inside the build, so a branding volume with no
 * `logo.*` in it leaves the app with a logo rather than a hole in the header.
 */
export const LOGO_CANDIDATES: readonly string[] = [
  ...(appConfig.logoUrl ? [appConfig.logoUrl] : LOGO_EXTENSIONS.map((e) => `/branding/logo.${e}`)),
  defaultLogoUrl,
];

/** Version of this build, shown to people (the release tag, or "dev"). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

/** Instance de démo publique (`DEMO_MODE`) : siège court, pas d'upload, reset horaire. */
export interface DemoConfig {
  seatMinutes: number;
}

let demo: DemoConfig | null = null;

/** Reçu de `GET /auth/config` avant le rendu (main.tsx) — le serveur impose le reste. */
export function configureDemo(value: DemoConfig | null): void {
  demo = value;
}

/** Démo publique en cours, ou `null` : lu au rendu, jamais mis en cache par un module. */
export function getDemo(): DemoConfig | null {
  return demo;
}
