import {
  DEPLOYMENT_VARIABLES,
  SETTING_LIST,
  type DeploymentVariable,
  type SettingCategory,
  type SettingDefinition,
} from '@quiz-dock/contracts';

/**
 * The documentation generated from the settings registry (administration spec
 * §3.1): the environment reference of the self-hosting guide, between markers
 * (the prose around it stays hand-written), and the development stack's
 * `.env.example`. `pnpm generate:settings-docs` writes them; a test fails when
 * the committed files differ.
 */

export const CONFIGURATION_FILE = 'docs/self-hosting/configuration.md';
export const ENV_EXAMPLE_FILE = '.env.example';
export const BEGIN =
  '<!-- BEGIN environment reference: generated from the settings registry (pnpm generate:settings-docs) -->';
export const END = '<!-- END environment reference -->';

interface Group {
  title: string;
  categories: SettingCategory[];
  /** Markdown under the table. */
  note?: string;
}

const GROUPS: Group[] = [
  {
    title: 'Identity & branding',
    categories: ['identity'],
    note: 'How to replace the logo and the stylesheet: **[branding](branding.md)**.',
  },
  {
    title: 'Access & authentication',
    categories: ['access'],
    note:
      'How the two modes behave, how to register the client on your IdP and what open access means:\n' +
      '**[authentication](auth.md)**. The public demo guards are described [below](#public-demo-instance).',
  },
  {
    title: 'Network & invitation',
    categories: ['network'],
    note:
      'Which setup offers which invitation address: [where participants connect](invitation-address.md).\n' +
      'The community catalogue, its formats and download checks: [community store](community-store.md).',
  },
  {
    title: 'Storage',
    categories: ['storage'],
    note: 'Back up `MEDIA_DIR` and `STORE_DIR` with the database: they are not in PostgreSQL.',
  },
  {
    title: 'Limits',
    categories: ['limits'],
    note:
      'Formats, conversion and playback: [audio & video](audio-video.md). **Behind a reverse proxy, raise its\n' +
      'request body limit to the largest of these sizes** — nginx refuses anything over 1 MB by default\n' +
      '(`client_max_body_size 50m;`).',
  },
  { title: 'Game pace', categories: ['pace'] },
  { title: 'Administration', categories: ['admin'] },
];

const LEVELS =
  'Level: **C1** critical (start-up, data, security — shown, never changed by the administration) · ' +
  '**C2** access and resources · **C3** behaviour · **C4** look and wording.';

/** A value as the documentation shows it. */
function shown(value: unknown): string {
  if (value === '' || value === null || (Array.isArray(value) && !value.length)) return '—';
  return `\`${Array.isArray(value) ? value.join(',') : String(value)}\``;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function settingRow(def: SettingDefinition): string {
  return `| \`${def.key}\` | ${cell(def.defaultText ?? shown(def.default))} | ${cell(def.accepts)} | ${def.criticality} | ${cell(def.description)} |`;
}

function deploymentRow(v: DeploymentVariable): string {
  return `| \`${v.key}\` | ${cell(v.defaultText ?? '—')} | ${v.criticality} | ${cell(v.description)} |`;
}

const visible = (def: SettingDefinition) => !def.internal && !def.deprecated;

/** The generated part of the self-hosting guide. */
export function environmentReference(): string {
  const parts: string[] = [LEVELS, ''];
  for (const group of GROUPS) {
    const defs = SETTING_LIST.filter((d) => group.categories.includes(d.category) && visible(d));
    parts.push(
      `### ${group.title}`,
      '',
      '| Variable | Default | Accepts | Level | Description |',
      '|---|---|---|---|---|',
      ...defs.map(settingRow),
      '',
    );
    if (group.note) parts.push(group.note, '');
  }
  const compose = DEPLOYMENT_VARIABLES.filter(
    (v) =>
      v.readBy === 'compose' && !v.internal && !['PUBLIC_HOST', 'PUBLIC_SCHEME'].includes(v.key),
  );
  parts.push(
    '### Deployment (Compose)',
    '',
    'Read by `docker-compose.prod.yml` and the `quizdock` script, never by the application.',
    '',
    '| Variable | Default | Level | Description |',
    '|---|---|---|---|',
    ...compose.map(deploymentRow),
    ...DEPLOYMENT_VARIABLES.filter((v) => v.key === 'QUIZDOCK_MODE').map(deploymentRow),
    '',
  );
  const keycloak = DEPLOYMENT_VARIABLES.filter(
    (v) =>
      (v.readBy === 'keycloak' || ['PUBLIC_HOST', 'PUBLIC_SCHEME'].includes(v.key)) && !v.internal,
  );
  parts.push(
    '### Bundled Keycloak (full preset)',
    '',
    '`quizdock init --full` fetches `docker-compose.full.yml`, used alongside the production',
    'Compose file. Only this overlay derives the app and OIDC URLs from `PUBLIC_HOST`.',
    'Other presets keep their existing defaults even when that variable is set.',
    '',
    '| Variable | Default | Level | Description |',
    '|---|---|---|---|',
    ...keycloak.map(deploymentRow),
    '',
    'Explicit `APP_PUBLIC_URL`, `OIDC_ISSUER` and `OIDC_INTERNAL_URL` override the full',
    "preset's derived defaults. Realm import creates accounts only on a fresh database;",
    'changing the initial passwords does not reset existing accounts.',
  );
  return parts.join('\n');
}

/** The self-hosting guide with its environment reference regenerated. */
export function configurationText(current: string): string {
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin < 0 || end < begin) throw new Error(`${CONFIGURATION_FILE}: markers missing`);
  return `${current.slice(0, begin + BEGIN.length)}\n\n${environmentReference()}\n\n${current.slice(end)}`;
}

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
const SET_BY_DEV_STACK = [
  'DATABASE_URL',
  'REDIS_URL',
  'MEDIA_DIR',
  'STORE_DIR',
  'SAMPLES_DIR',
  'PORT',
];

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
    '# described in docs/self-hosting/configuration.md.',
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
