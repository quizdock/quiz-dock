import {
  DEPLOYMENT_VARIABLES,
  SETTING_LIST,
  type DeploymentVariable,
  type SettingCategory,
  type SettingDefinition,
} from '@quiz-dock/contracts';

/**
 * What is generated from the settings registry (administration spec §3.1):
 * the environment reference as data, which the website reads at each release
 * to render its configuration page, and the development stack's
 * `.env.example`. `pnpm generate:settings-docs` writes them; a test fails when
 * the committed files differ.
 */

export const SETTINGS_DATA_FILE = 'schema/settings.json';
export const ENV_EXAMPLE_FILE = '.env.example';
/** The page of the website that renders the reference. */
export const CONFIGURATION_URL = 'https://quizdock.github.io/docs/operator/configuration/';

/** The reference's sections, in the order the page shows them. */
const GROUPS: { id: SettingCategory; title: string }[] = [
  { id: 'identity', title: 'Identity & branding' },
  { id: 'access', title: 'Access & authentication' },
  { id: 'network', title: 'Network & invitation' },
  { id: 'storage', title: 'Storage' },
  { id: 'limits', title: 'Limits' },
  { id: 'pace', title: 'Game pace' },
  { id: 'admin', title: 'Administration' },
];

/** A value as the documentation shows it. */
function shown(value: unknown): string {
  if (value === '' || value === null || (Array.isArray(value) && !value.length)) return '—';
  return `\`${Array.isArray(value) ? value.join(',') : String(value)}\``;
}

const visible = (def: SettingDefinition) => !def.internal && !def.deprecated;

/** A variable as the reference shows it; texts are Markdown. */
export interface ReferenceEntry {
  key: string;
  default: string;
  level: string;
  description: string;
  /** Application settings only. */
  accepts?: string;
  applies?: SettingDefinition['applies'];
  /** Whether the web administration may change it. */
  administration?: boolean;
  /** The quick setup's question that sets it. */
  preset?: string;
}

export interface SettingsData {
  groups: { id: string; title: string; settings: ReferenceEntry[] }[];
  /** Read by `docker-compose.prod.yml` and the `quizdock` script, never by the application. */
  compose: ReferenceEntry[];
  /** The `full` setup's bundled Keycloak. */
  keycloak: ReferenceEntry[];
}

const settingEntry = (def: SettingDefinition): ReferenceEntry => ({
  key: def.key,
  default: def.defaultText ?? shown(def.default),
  level: def.criticality,
  description: def.description,
  accepts: def.accepts,
  applies: def.applies,
  administration: def.overridable,
  ...(def.preset ? { preset: def.preset.axis } : {}),
});

const deploymentEntry = (v: DeploymentVariable): ReferenceEntry => ({
  key: v.key,
  default: v.defaultText ?? '—',
  level: v.criticality,
  description: v.description,
});

/** The environment reference, as data. */
export function settingsData(): SettingsData {
  const own = ['PUBLIC_HOST', 'PUBLIC_SCHEME'];
  return {
    groups: GROUPS.map((group) => ({
      ...group,
      settings: SETTING_LIST.filter((d) => d.category === group.id && visible(d)).map(settingEntry),
    })),
    compose: [
      ...DEPLOYMENT_VARIABLES.filter(
        (v) => v.readBy === 'compose' && !v.internal && !own.includes(v.key),
      ),
      ...DEPLOYMENT_VARIABLES.filter((v) => v.key === 'QUIZDOCK_MODE'),
    ].map(deploymentEntry),
    keycloak: DEPLOYMENT_VARIABLES.filter(
      (v) => (v.readBy === 'keycloak' || own.includes(v.key)) && !v.internal,
    ).map(deploymentEntry),
  };
}

/** The committed file. */
export const settingsDataText = (): string => `${JSON.stringify(settingsData(), null, 2)}\n`;

// ── .env.example (the development stack) ───────────────────────────────────

/** What the development stack sets; every other variable is shown commented out. */
const DEV_VALUES: Record<string, string> = {
  APP_NAME: 'QuizDock',
  APP_LANG: 'en',
  AUTH_MODE: 'none',
  DEMO_MODE: 'false',
  ALLOW_ANONYMOUS_PARTICIPANTS: 'false',
  OIDC_ISSUER: 'http://localhost:18080/realms/quiz-dock',
  OIDC_INTERNAL_URL: 'http://keycloak:8080',
  OIDC_CLIENT_ID: 'quiz-dock-frontend',
  OIDC_CLIENT_SECRET: '',
  OIDC_AUDIENCE: '',
  OIDC_ROLES_CLAIM: 'realm_access.roles',
  OIDC_NAME_CLAIM: '',
  MEDIA_MAX_BYTES: '10485760',
  MEDIA_MAX_VIDEO_MB: '50',
  MEDIA_MAX_AUDIO_MB: '10',
  IMPORT_MAX_BYTES: '52428800',
  BACKEND_PORT: '13000',
  FRONTEND_PORT: '18081',
  VITE_PORT: '15173',
  POSTGRES_PORT: '15432',
  REDIS_PORT: '16379',
  KEYCLOAK_PORT: '18080',
  POSTGRES_USER: 'live',
  POSTGRES_PASSWORD: 'live',
  POSTGRES_DB: 'quizdock',
  KEYCLOAK_ADMIN: 'admin',
  KEYCLOAK_ADMIN_PASSWORD: 'admin',
};

/** Set by the development Compose file itself: not for the `.env`. */
const SET_BY_DEV_STACK = ['DATABASE_URL', 'REDIS_URL', 'MEDIA_DIR', 'STORE_DIR', 'PORT'];

/** Markdown to plain text, wrapped as `# ` comment lines. */
function comment(markdown: string, width = 78): string[] {
  const words = markdown
    .replace(/\*\*|\*|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = '#';
  for (const word of words) {
    if (line.length + 1 + word.length > width && line !== '#') {
      lines.push(line);
      line = '#';
    }
    line += ` ${word}`;
  }
  if (line !== '#') lines.push(line);
  return lines;
}

function entry(key: string, description: string, example: string | undefined): string[] {
  const value = DEV_VALUES[key];
  return [
    ...comment(description),
    value !== undefined ? `${key}=${value}` : `# ${key}=${example ?? ''}`,
    '',
  ];
}

const SECTIONS: { title: string; categories: SettingCategory[] }[] = [
  { title: 'Identity & branding', categories: ['identity'] },
  {
    title: 'Access & authentication (OIDC_* used only with AUTH_MODE=oidc)',
    categories: ['access'],
  },
  { title: 'Network & invitation', categories: ['network'] },
  { title: 'Limits', categories: ['limits'] },
  { title: 'Game pace', categories: ['pace'] },
  { title: 'Administration', categories: ['admin'] },
];

/** The development stack's `.env.example`. */
export function envExampleText(): string {
  const out: string[] = [
    '# Development stack (docker-compose.yml + override): copy to `.env` and adjust.',
    '# Never commit the real `.env`.',
    '# Deploying QuizDock? Start from env/standalone.env.example, env/local.env.example',
    '# or env/oidc.env.example instead; env/full.env.example bundles Keycloak.',
    '#',
    '# Generated from the settings registry (pnpm generate:settings-docs): edit',
    '# packages/contracts/src/admin/settings.ts, not this file. Every variable is',
    `# described in ${CONFIGURATION_URL}`,
    '',
  ];
  for (const section of SECTIONS) {
    out.push(`# ── ${section.title} ${'─'.repeat(Math.max(3, 74 - section.title.length))}`, '');
    for (const def of SETTING_LIST.filter(
      (d) =>
        section.categories.includes(d.category) && visible(d) && !SET_BY_DEV_STACK.includes(d.key),
    )) {
      const accepts = def.accepts === 'text' ? '' : ` Accepts ${def.accepts}.`;
      out.push(...entry(def.key, `${def.description}${accepts}`, def.example ?? exampleOf(def)));
    }
  }
  const deployment: [string, (v: DeploymentVariable) => boolean][] = [
    ['Development stack: host ports', (v) => v.readBy === 'dev' && v.key !== 'VITE_API_URL'],
    ['Bundled PostgreSQL', (v) => /^POSTGRES_(USER|PASSWORD|DB)$/.test(v.key)],
    [
      'Example OIDC provider (Keycloak, started with --profile keycloak)',
      (v) => v.readBy === 'keycloak' && !v.internal,
    ],
  ];
  for (const [title, pick] of deployment) {
    out.push(`# ── ${title} ${'─'.repeat(Math.max(3, 74 - title.length))}`, '');
    for (const v of DEPLOYMENT_VARIABLES.filter(pick)) {
      out.push(...entry(v.key, v.description, v.example ?? plain(v.defaultText)));
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** A default as written in `.env`, when it is a plain value. */
function exampleOf(def: SettingDefinition): string {
  const value = def.default;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(',');
  if (value === null || value === '' || typeof value === 'object') return '';
  return String(value);
}

function plain(text: string | undefined): string {
  const m = text?.match(/^`([^`]*)`$/);
  return m ? m[1] : '';
}
