import { z } from 'zod';
import { ANSWER_THEMES } from './answer-themes';

/**
 * The settings registry (administration spec §1, §3.1): every environment
 * variable QuizDock knows, declared once. The backend resolves the application's
 * values through it, the documentation and `.env.example` are generated from it,
 * and the administration will show it. Definitions only: no instance value, no
 * secret ever lives here.
 *
 * Each application setting has two checks:
 * - `schema` reads the raw text the way the backend always has — what it cannot
 *   read falls back to the default, with a warning;
 * - `bounds` is the range the administration allows. A value read but out of
 *   bounds is kept and reported (`qd doctor`, the start-up log) until the bounds
 *   are enforced.
 */

/** C1 critical (start-up, data, security) · C2 high (access, resources) · C3 normal · C4 cosmetic. */
export type Criticality = 'C1' | 'C2' | 'C3' | 'C4';

/** When a new value takes effect: on its next use, for rooms opened after it, or at the next start. */
export type Applies = 'live' | 'next-room' | 'restart';

export type SettingCategory =
  | 'identity'
  | 'access'
  | 'network'
  | 'storage'
  | 'limits'
  | 'pace'
  | 'admin'
  | 'internal';

/** A variable the backend reads. */
export interface SettingDefinition<T = unknown> {
  /** The environment variable. */
  key: string;
  /** What it does, for the documentation and the administration (Markdown). */
  description: string;
  category: SettingCategory;
  criticality: Criticality;
  /** Reads the raw text; a failure falls back to the default. */
  schema: z.ZodType<T, string>;
  /** The administration's range; out of it, a value read is kept and reported. */
  bounds?: z.ZodType<T>;
  /** What the variable accepts, in words (documentation, warnings). */
  accepts: string;
  /** Used when the variable is unset, empty (unless `allowEmpty`) or unreadable. */
  default: T;
  /** The default as the documentation shows it, when the value alone would mislead. */
  defaultText?: string;
  /** An empty value is a value (read by the schema), not the variable unset. */
  allowEmpty?: boolean;
  /** How the variable is written… */
  unit?: 'bytes' | 'MB' | 'ms' | 's';
  /** …and how the administration shows it. */
  display?: 'MB' | 's';
  applies: Applies;
  /** Whether the administration may override it (never a C1). */
  overridable: boolean;
  /** Never shown, never logged: only whether it is set. */
  secret?: boolean;
  /** A value as written in `.env`, for the examples. */
  example?: string;
  /** Read only to warn that it no longer does anything. */
  deprecated?: string;
  /** Not for operators: set by an image, a tool or the tests. Left out of `.env.example`. */
  internal?: boolean;
  /** Its axis of presets (§3.9), and its value at each level of it. */
  preset?: SettingPreset<T>;
}

// ── Presets (§3.9) ──────────────────────────────────────────────────────────

export type PresetAxisId = 'pace' | 'venue' | 'audience';

export interface PresetAxis {
  id: PresetAxisId;
  levels: readonly string[];
  /** The level equal to the defaults. */
  standard: string;
  /** Only where this holds (the audience: participants authenticate under OIDC only). */
  requires?: { key: 'AUTH_MODE'; value: string };
}

export interface SettingPreset<T> {
  axis: PresetAxisId;
  /** A value for every level of the axis. */
  levels: Record<string, T>;
}

export interface NamedPreset {
  id: 'party' | 'classroom' | 'event' | 'express' | 'accessible';
  /** An absent axis is left alone. */
  levels: Partial<Record<PresetAxisId, string>>;
}

export const PRESET_AXES: PresetAxis[] = [
  { id: 'pace', levels: ['fast', 'standard', 'comfortable'], standard: 'standard' },
  { id: 'venue', levels: ['standard', 'large', 'modest'], standard: 'standard' },
  {
    id: 'audience',
    levels: ['accounts', 'open'],
    standard: 'accounts',
    requires: { key: 'AUTH_MODE', value: 'oidc' },
  },
];

/** Shortcuts to levels of the axes, never to variables. */
export const NAMED_PRESETS: NamedPreset[] = [
  { id: 'party', levels: { pace: 'standard', venue: 'standard', audience: 'open' } },
  { id: 'classroom', levels: { pace: 'comfortable', venue: 'standard', audience: 'accounts' } },
  { id: 'event', levels: { pace: 'standard', venue: 'large', audience: 'open' } },
  { id: 'express', levels: { pace: 'fast', venue: 'standard', audience: 'open' } },
  { id: 'accessible', levels: { pace: 'comfortable', venue: 'modest' } },
];

/** Who reads a variable the backend never sees. */
export type DeploymentReader = 'compose' | 'keycloak' | 'script' | 'build' | 'dev' | 'image';

/** A variable read before or around the application (§1.8): shown, never changed by it. */
export interface DeploymentVariable {
  key: string;
  description: string;
  readBy: DeploymentReader;
  criticality: Criticality;
  /** The default, in words (it is not the application's to apply). */
  defaultText?: string;
  secret?: boolean;
  example?: string;
  /** Not for operators: left out of the documentation. */
  internal?: boolean;
}

// ── Raw-text readers ────────────────────────────────────────────────────────

const fail = (ctx: z.RefinementCtx<string>, message: string) => {
  ctx.addIssue({ code: 'custom', message });
  return z.NEVER;
};

/** The text as written. */
const text = (): z.ZodType<string, string> => z.string();

/** A number as `Number()` reads it (spaces, exponents and hex included), finite. */
const number = (opts: { positive?: boolean } = {}): z.ZodType<number, string> =>
  z.string().transform((raw, ctx) => {
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) return fail(ctx, 'not a number');
    if (opts.positive && n <= 0) return fail(ctx, 'not above 0');
    return n;
  });

/** One of a few words, compared after `normalize`. */
const oneOf = <const V extends string>(
  values: readonly V[],
  normalize: (raw: string) => string = (raw) => raw,
): z.ZodType<V, string> =>
  z.string().transform((raw, ctx) => {
    const v = normalize(raw);
    return (values as readonly string[]).includes(v)
      ? (v as V)
      : fail(ctx, `not one of ${values.join(', ')}`);
  });

/** `true` or `false`, exactly. */
const flag = (): z.ZodType<boolean, string> =>
  oneOf(['true', 'false'] as const).transform((v) => v === 'true');

/** Comma-separated items, trimmed, empty ones dropped. */
const list = (normalize: (item: string) => string = (s) => s): z.ZodType<string[], string> =>
  z.string().transform((raw) =>
    raw
      .split(',')
      .map((item) => normalize(item.trim()))
      .filter(Boolean),
  );

/** An absolute URL with one of `schemes` (a pattern: the package runs where `URL` may not exist). */
const isUrl = (value: string, schemes = ['http', 'https']) =>
  new RegExp(`^(${schemes.join('|')})://[^\\s/?#]+([/?#]\\S*)?$`, 'i').test(value);

/** The same, without a path, query or fragment. */
const isOrigin = (value: string) => /^https?:\/\/[^\s/?#]+\/?$/i.test(value);

// ── Shared values ───────────────────────────────────────────────────────────

/** The languages the interface speaks (`APP_LANG`). */
export const UI_LANGUAGES = ['en', 'fr', 'es', 'zh', 'zh-TW', 'tr'] as const;

export type MediaLibraryKind = 'image' | 'video' | 'audio';
export const MEDIA_LIBRARY_KINDS: MediaLibraryKind[] = ['image', 'video', 'audio'];

export interface MediaLibraryLink {
  name: string;
  url: string;
  kinds: MediaLibraryKind[];
}

/**
 * Free libraries under open licences (Creative Commons, public domain), several for
 * each kind: images, videos, sounds and music. Content free of charge but under a
 * site's own licence (Pexels, Pixabay…) is left out: an author can add it.
 */
export const DEFAULT_MEDIA_LIBRARY_LINKS: MediaLibraryLink[] = [
  { name: 'OpenSoundLibrary', url: 'https://opensoundlibrary.com/', kinds: ['audio'] },
  { name: 'Freesound', url: 'https://freesound.org/', kinds: ['audio'] },
  { name: 'ccMixter', url: 'https://ccmixter.org/', kinds: ['audio'] },
  { name: 'Openverse', url: 'https://openverse.org/', kinds: ['image', 'audio'] },
  {
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/',
    kinds: ['image', 'video', 'audio'],
  },
  {
    name: 'NASA Image and Video Library',
    url: 'https://images.nasa.gov/',
    kinds: ['image', 'video', 'audio'],
  },
  { name: 'Internet Archive', url: 'https://archive.org/', kinds: ['image', 'video', 'audio'] },
];

/** `none`, or a JSON list whose readable entries are kept (kinds filtered, all three when absent). */
const mediaLibraryLinks = (): z.ZodType<MediaLibraryLink[], string> =>
  z.string().transform((raw, ctx) => {
    const value = raw.trim();
    if (value === 'none') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      return fail(ctx, (err as Error).message);
    }
    if (!Array.isArray(parsed)) return fail(ctx, 'not a list');
    return parsed.flatMap((l: Partial<MediaLibraryLink> | null) =>
      typeof l?.name === 'string' && typeof l.url === 'string' && /^https?:\/\//.test(l.url)
        ? [
            {
              name: l.name,
              url: l.url,
              kinds: Array.isArray(l.kinds)
                ? l.kinds.filter((k) => MEDIA_LIBRARY_KINDS.includes(k))
                : MEDIA_LIBRARY_KINDS,
            },
          ]
        : [],
    );
  });

const MB = 1024 * 1024;
const megabytes = (min: number, max: number) => z.number().min(min).max(max);
const milliseconds = (min: number, max: number) => z.number().min(min).max(max);

// ── The registry ────────────────────────────────────────────────────────────

function define<T>(def: SettingDefinition<T>): SettingDefinition<T> {
  return def;
}

export const SETTINGS = {
  // Identity & branding
  APP_NAME: define({
    key: 'APP_NAME',
    description: 'Brand name shown in the header, tab title and share text.',
    category: 'identity',
    criticality: 'C4',
    schema: text(),
    bounds: z.string().min(1).max(40),
    accepts: '1 to 40 characters',
    default: 'QuizDock',
    allowEmpty: true,
    applies: 'live',
    overridable: true,
  }),
  APP_LANG: define<string>({
    key: 'APP_LANG',
    description:
      'UI language for the instance. One per deployment (no browser detection). New quizzes start in this language; each quiz can be set to another in its settings.',
    category: 'identity',
    criticality: 'C4',
    schema: text(),
    bounds: z.enum(UI_LANGUAGES),
    accepts: UI_LANGUAGES.map((l) => `\`${l}\``).join(' · '),
    default: 'en',
    applies: 'live',
    overridable: true,
  }),
  APP_LOGO_URL: define({
    key: 'APP_LOGO_URL',
    description:
      'Logo served from somewhere else (a CDN, a path outside `branding/`). Empty by default, which is the usual setup: the logo is then looked up in the mounted `branding/` folder.',
    category: 'identity',
    criticality: 'C4',
    schema: text(),
    bounds: z.string().refine((v) => isUrl(v, ['https']), 'not an https:// URL'),
    accepts: 'an `https://` URL',
    default: '',
    applies: 'live',
    overridable: true,
  }),
  APP_FEEDBACK_URL: define({
    key: 'APP_FEEDBACK_URL',
    description:
      "Where the home page's *Report a bug · Suggest a feature · Fix a translation · Ask a question* links lead. Empty: the QuizDock repository, its forms filled in with the version, the browser and the language. Another GitHub repository (`https://github.com/owner/repo`): the same forms there — copy `.github/ISSUE_TEMPLATE/` into it. Any other address: a single *Send feedback* link. `none`: no links.",
    category: 'identity',
    criticality: 'C4',
    schema: text(),
    bounds: z.string().refine((v) => v === 'none' || isUrl(v), 'not a URL nor none'),
    accepts: 'an `http(s)://` URL, or `none`',
    default: '',
    applies: 'live',
    overridable: true,
  }),

  ANSWER_THEME: define<string>({
    key: 'ANSWER_THEME',
    description:
      "How the answers are drawn on the projection, the phones and the console — the quizzes keep their slots: `classic` (the application's colours, each answer's shape), `letters` (A, B, C…), `numbers` (1, 2, 3…), `colorblind` (colours told apart under every common colour vision deficiency, and the shapes).",
    category: 'identity',
    criticality: 'C4',
    schema: oneOf(ANSWER_THEMES.map((t) => t.id)),
    accepts: ANSWER_THEMES.map((t) => `\`${t.id}\``).join(' · '),
    default: 'classic',
    applies: 'live',
    overridable: true,
  }),

  // Access & authentication
  AUTH_MODE: define({
    key: 'AUTH_MODE',
    description:
      '`none` = local mode (no IdP, single host seat); `oidc` = sign-in with any OpenID Connect provider, the session held by the backend.',
    category: 'access',
    criticality: 'C1',
    schema: oneOf(['none', 'oidc'] as const),
    accepts: '`none` · `oidc`',
    default: 'none' as 'none' | 'oidc',
    applies: 'restart',
    overridable: false,
  }),
  DEMO_MODE: define({
    key: 'DEMO_MODE',
    description:
      '`true` = public demo guards: the host seat lasts 5 min (renewable), media uploads are refused, and everything is wiped every hour.',
    category: 'access',
    criticality: 'C1',
    schema: flag(),
    accepts: '`true` · `false`',
    default: false,
    applies: 'restart',
    overridable: false,
  }),
  ALLOW_ANONYMOUS_PARTICIPANTS: define({
    key: 'ALLOW_ANONYMOUS_PARTICIPANTS',
    description:
      '`AUTH_MODE=oidc` only: `true` lets hosts open a game to participants without an account, the PIN and a nickname alone — chosen at each launch.',
    category: 'access',
    criticality: 'C2',
    schema: flag(),
    accepts: '`true` · `false`',
    default: false,
    applies: 'live',
    overridable: true,
    preset: { axis: 'audience', levels: { accounts: false, open: true } },
  }),
  OIDC_ISSUER: define({
    key: 'OIDC_ISSUER',
    description:
      "`iss` expected in tokens (your provider's issuer URL). Required when `AUTH_MODE=oidc`.",
    category: 'access',
    criticality: 'C1',
    schema: text(),
    bounds: z.string().refine((v) => isUrl(v.trim()) && !/[?#]/.test(v), 'not an http(s) URL'),
    accepts: 'an `http(s)://` URL, without query or fragment',
    default: '',
    applies: 'restart',
    overridable: false,
    example: 'https://id.example.org/realms/quiz',
  }),
  OIDC_CLIENT_ID: define({
    key: 'OIDC_CLIENT_ID',
    description: 'The client registered with your provider.',
    category: 'access',
    criticality: 'C1',
    schema: text(),
    accepts: 'text',
    default: 'quiz-dock-frontend',
    applies: 'restart',
    overridable: false,
  }),
  OIDC_CLIENT_SECRET: define({
    key: 'OIDC_CLIENT_SECRET',
    description:
      'Its secret, for a confidential client. Unset: a public client, protected by PKCE.',
    category: 'access',
    criticality: 'C1',
    schema: text(),
    accepts: 'text',
    default: '',
    applies: 'restart',
    overridable: false,
    secret: true,
  }),
  OIDC_INTERNAL_URL: define({
    key: 'OIDC_INTERNAL_URL',
    description:
      "Where the backend reaches the provider when the browser's address is not reachable from its network (Docker): discovery, tokens and keys go through it. Defaults to the host of `OIDC_JWKS_URI` when that one points elsewhere than the issuer.",
    category: 'access',
    criticality: 'C1',
    schema: text(),
    bounds: z.string().refine((v) => isUrl(v), 'not an http(s) URL'),
    accepts: 'an `http(s)://` URL',
    default: '',
    defaultText: '_(host of `OIDC_JWKS_URI`)_',
    applies: 'restart',
    overridable: false,
    example: 'http://keycloak:8080',
  }),
  OIDC_JWKS_URI: define({
    key: 'OIDC_JWKS_URI',
    description: "Key endpoint, when discovery's must not be used.",
    category: 'access',
    criticality: 'C1',
    schema: text(),
    bounds: z.string().refine((v) => isUrl(v), 'not an http(s) URL'),
    accepts: 'an `http(s)://` URL',
    default: '',
    defaultText: '_(discovery)_',
    applies: 'restart',
    overridable: false,
  }),
  OIDC_AUDIENCE: define({
    key: 'OIDC_AUDIENCE',
    description: 'Expected `aud`. Left unset = audience check skipped.',
    category: 'access',
    criticality: 'C1',
    schema: text(),
    accepts: 'text',
    default: '',
    applies: 'restart',
    overridable: false,
  }),
  OIDC_ROLES_CLAIM: define({
    key: 'OIDC_ROLES_CLAIM',
    description:
      'Dotted path to the roles array in the JWT (e.g. `groups`, `realm_access.roles`). A typo locks every administrator out.',
    category: 'access',
    criticality: 'C1',
    schema: text(),
    accepts: 'a dotted path',
    default: 'roles',
    applies: 'restart',
    overridable: false,
  }),
  OIDC_NAME_CLAIM: define({
    key: 'OIDC_NAME_CLAIM',
    description:
      'Dotted path to the display-name claim (e.g. the standard `nickname`). Unset, or absent from a token: `preferred_username`, then `name`, then `email`.',
    category: 'access',
    criticality: 'C3',
    schema: text(),
    accepts: 'a dotted path',
    default: '',
    applies: 'live',
    overridable: true,
  }),
  OIDC_SESSION_SCOPE: define({
    key: 'OIDC_SESSION_SCOPE',
    description: 'Ignored: the session is a cookie the tabs share, the tokens stay on the server.',
    category: 'access',
    criticality: 'C3',
    schema: text(),
    accepts: 'anything (ignored)',
    default: '',
    applies: 'restart',
    overridable: false,
    deprecated:
      'OIDC_SESSION_SCOPE is ignored: the session is a cookie the tabs share, the tokens stay on the server.',
    internal: true,
  }),

  // Network & invitation
  PORT: define({
    key: 'PORT',
    description: 'In-container HTTP port. Map it to a host port (`-p 18080:3000`).',
    category: 'network',
    criticality: 'C1',
    schema: number(),
    bounds: z.number().int().min(0).max(65535),
    accepts: 'a port',
    default: 3000,
    applies: 'restart',
    overridable: false,
  }),
  TRUST_PROXY: define({
    key: 'TRUST_PROXY',
    description:
      'Which hops may speak for the client through `X-Forwarded-For` / `X-Forwarded-Proto` (client address of the wrong-PIN limit, `Secure` session cookie). Default: a peer on a private address.',
    category: 'network',
    criticality: 'C1',
    schema: text(),
    accepts: '`false`, `true`, a number of proxies, or addresses and CIDR ranges',
    default: '',
    defaultText: '_(private addresses)_',
    applies: 'restart',
    overridable: false,
  }),
  APP_PUBLIC_URL: define({
    key: 'APP_PUBLIC_URL',
    description:
      'Public address of the instance. Offered first as the invitation address (QR code, join link) on the host console.',
    category: 'network',
    criticality: 'C3',
    schema: z.string().transform((raw) => raw.trim().replace(/\/+$/, '')),
    bounds: z.string().refine(isOrigin, 'not an http(s) URL without path'),
    accepts: 'an `http(s)://` URL, without path',
    default: '',
    applies: 'live',
    overridable: true,
    example: 'https://quiz.example.org',
  }),
  HOST_LAN_IPS: define({
    key: 'HOST_LAN_IPS',
    description:
      "Comma-separated LAN IPs of the machine (bare IPs), for setups where the container cannot see the host's interfaces (Docker Desktop, bridge network). Offered as invitation addresses with the scheme and port of the page.",
    category: 'network',
    criticality: 'C3',
    schema: list(),
    bounds: z
      .array(z.string())
      .refine((ips) => ips.every((ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)), 'not IPv4 addresses'),
    accepts: 'comma-separated IPv4 addresses',
    default: [],
    applies: 'live',
    overridable: true,
    example: '192.168.1.103',
  }),
  QUIZ_STORE_URL: define({
    key: 'QUIZ_STORE_URL',
    description:
      'Comma-separated registry URLs of the community catalogue. Leave unset or empty to hide the community page and prevent all outgoing store requests. Enabling contacts the listed services from the server: its IP is visible, no user data is sent.',
    category: 'network',
    criticality: 'C2',
    schema: list(),
    bounds: z
      .array(z.string())
      .max(5)
      .refine((urls) => urls.every((u) => isUrl(u)), 'not http(s) URLs'),
    accepts: 'up to five comma-separated `http(s)://` URLs',
    default: [],
    defaultText: '_(disabled)_',
    applies: 'live',
    overridable: true,
    example: 'https://raw.githubusercontent.com/quizdock/quiz-store/main/registry.json',
  }),
  QUIZ_STORE_HOSTS: define({
    key: 'QUIZ_STORE_HOSTS',
    description:
      'Additional exact host names allowed for source indexes, artifacts and redirects. Registry hosts are allowed automatically. Empty: the registry hosts only.',
    category: 'network',
    criticality: 'C2',
    schema: list((h) => h.toLowerCase()),
    accepts: 'comma-separated host names',
    default: ['github.com', 'release-assets.githubusercontent.com'],
    allowEmpty: true,
    applies: 'live',
    overridable: true,
  }),

  // Storage
  DATABASE_URL: define({
    key: 'DATABASE_URL',
    description:
      'PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/quizdock`. **Required** (provided by Compose; baked into `:standalone`).',
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a PostgreSQL URL',
    default: '',
    defaultText: '— (required)',
    applies: 'restart',
    overridable: false,
    secret: true,
  }),
  REDIS_URL: define({
    key: 'REDIS_URL',
    description: 'Redis connection string, e.g. `redis://host:6379`. Live-game state only.',
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a Redis URL',
    default: 'redis://localhost:16379',
    defaultText: '— (provided by Compose)',
    applies: 'restart',
    overridable: false,
  }),
  MEDIA_DIR: define({
    key: 'MEDIA_DIR',
    description:
      'Where uploaded images, videos and sounds are stored. Mount a volume here to persist.',
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a path',
    default: '.media',
    defaultText: '`/data/media` (images)',
    allowEmpty: true,
    applies: 'restart',
    overridable: false,
  }),
  STORE_DIR: define({
    key: 'STORE_DIR',
    description:
      'Where the **catalogue of shared templates** lives: `index.json` plus one folder per template, in the bundle format. Its own volume, like `MEDIA_DIR` — **back it up with the database**, it is not in PostgreSQL. The sample quizzes are seeded here at start.',
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a path',
    default: '.store',
    defaultText: '`/data/store` (images)',
    allowEmpty: true,
    applies: 'restart',
    overridable: false,
  }),
  SAMPLES_DIR: define({
    key: 'SAMPLES_DIR',
    description:
      "Where the image keeps the **sample quizzes** it ships: one bundle folder each, with their media. At its first start an instance also adds those media to the **instance's media**, unless an administrator already curates that library; a `.samples-media` marker in `MEDIA_DIR` keeps them from coming back once removed.",
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a path',
    default: 'samples',
    defaultText: '`/app/samples` (images)',
    allowEmpty: true,
    applies: 'restart',
    overridable: false,
  }),
  CLIENT_DIR: define({
    key: 'CLIENT_DIR',
    description:
      'Where the built web application is, when the backend serves it (the single-container images set it).',
    category: 'storage',
    criticality: 'C1',
    schema: text(),
    accepts: 'a path',
    default: '',
    applies: 'restart',
    overridable: false,
    internal: true,
  }),

  // Limits
  MEDIA_MAX_BYTES: define({
    key: 'MEDIA_MAX_BYTES',
    description: 'Max size of an uploaded **image**, in bytes. Default 10 MiB.',
    category: 'limits',
    criticality: 'C2',
    schema: number({ positive: true }),
    bounds: z
      .number()
      .min(1 * MB)
      .max(50 * MB),
    accepts: 'bytes, 1 to 50 MB',
    default: 10 * MB,
    unit: 'bytes',
    display: 'MB',
    applies: 'live',
    overridable: true,
  }),
  MEDIA_MAX_VIDEO_MB: define({
    key: 'MEDIA_MAX_VIDEO_MB',
    description:
      'Max size of an uploaded **video**, in MB. The editor converts to MP4 H.264 + AAC and compresses a long video to fit.',
    category: 'limits',
    criticality: 'C2',
    schema: number({ positive: true }),
    bounds: megabytes(1, 500),
    accepts: '1 to 500 (MB)',
    default: 50,
    unit: 'MB',
    display: 'MB',
    applies: 'live',
    overridable: true,
    preset: { axis: 'venue', levels: { standard: 50, large: 50, modest: 20 } },
  }),
  MEDIA_MAX_AUDIO_MB: define({
    key: 'MEDIA_MAX_AUDIO_MB',
    description: 'Max size of an uploaded **sound**, in MB. The editor converts to M4A (AAC).',
    category: 'limits',
    criticality: 'C2',
    schema: number({ positive: true }),
    bounds: megabytes(1, 100),
    accepts: '1 to 100 (MB)',
    default: 10,
    unit: 'MB',
    display: 'MB',
    applies: 'live',
    overridable: true,
  }),
  IMPORT_MAX_BYTES: define({
    key: 'IMPORT_MAX_BYTES',
    description: 'Max size of an imported quiz bundle (zip), in bytes. Default 50 MiB.',
    category: 'limits',
    criticality: 'C2',
    schema: number(),
    bounds: z
      .number()
      .min(1 * MB)
      .max(500 * MB),
    accepts: 'bytes, 1 to 500 MB',
    default: 50 * MB,
    unit: 'bytes',
    display: 'MB',
    applies: 'restart',
    overridable: true,
  }),
  PUBLICATION_MAX_MB: define({
    key: 'PUBLICATION_MAX_MB',
    description:
      "Largest bundle the editor's *Export for publication* allows, in MB: the limit of the community store, kept under GitHub's 25 MB web-upload limit. An organisation running its own store may set another.",
    category: 'limits',
    criticality: 'C3',
    schema: number({ positive: true }),
    bounds: megabytes(1, 100),
    accepts: '1 to 100 (MB)',
    default: 20,
    unit: 'MB',
    display: 'MB',
    applies: 'live',
    overridable: true,
  }),
  MEDIA_LIBRARY_LINKS: define({
    key: 'MEDIA_LIBRARY_LINKS',
    description:
      'The free media libraries the editor links to: a JSON list of `{"name", "url", "kinds"}` (`kinds` among `image`, `video`, `audio`), or `none` to hide them (an instance without Internet). Default, open licences only and several per kind: OpenSoundLibrary, Freesound, ccMixter, Openverse, Wikimedia Commons, NASA Image and Video Library, Internet Archive.',
    category: 'limits',
    criticality: 'C4',
    schema: mediaLibraryLinks(),
    accepts: 'a JSON list, or `none`',
    default: DEFAULT_MEDIA_LIBRARY_LINKS,
    defaultText: '_(seven free libraries)_',
    applies: 'live',
    overridable: true,
  }),

  // Game pace
  GAME_READ_DELAY_MS: define({
    key: 'GAME_READ_DELAY_MS',
    description: "Reading window shown before a question's timer starts, in milliseconds.",
    category: 'pace',
    criticality: 'C3',
    schema: number(),
    bounds: milliseconds(0, 10_000),
    accepts: '0 to 10000 (ms)',
    default: 3000,
    unit: 'ms',
    display: 's',
    applies: 'live',
    overridable: true,
    preset: { axis: 'pace', levels: { fast: 1500, standard: 3000, comfortable: 6000 } },
  }),
  GAME_ALL_ANSWERED_DELAY_MS: define({
    key: 'GAME_ALL_ANSWERED_DELAY_MS',
    description:
      'Once every participant has answered, how long the question stays before its answer is revealed, in milliseconds.',
    category: 'pace',
    criticality: 'C3',
    schema: number(),
    bounds: milliseconds(0, 5000),
    accepts: '0 to 5000 (ms)',
    default: 1000,
    unit: 'ms',
    display: 's',
    applies: 'live',
    overridable: true,
    preset: { axis: 'pace', levels: { fast: 500, standard: 1000, comfortable: 2000 } },
  }),
  GAME_AUTO_ADVANCE_MS: define({
    key: 'GAME_AUTO_ADVANCE_MS',
    description:
      'Automatic mode: time spent on a reveal or a content slide before moving on, unless the question or slide sets its own, in milliseconds.',
    category: 'pace',
    criticality: 'C3',
    schema: number(),
    bounds: milliseconds(1000, 60_000),
    accepts: '1000 to 60000 (ms)',
    default: 5000,
    unit: 'ms',
    display: 's',
    applies: 'live',
    overridable: true,
    preset: { axis: 'pace', levels: { fast: 3000, standard: 5000, comfortable: 8000 } },
  }),
  GAME_MEDIA_WAIT_S: define({
    key: 'GAME_MEDIA_WAIT_S',
    description:
      'How long the room waits at most, before a question, for the devices that play its sound or video to load it (the host can start anyway), in seconds. `0` never waits.',
    category: 'pace',
    criticality: 'C3',
    schema: number(),
    bounds: z.number().min(0).max(60),
    accepts: '0 to 60 (s)',
    default: 10,
    unit: 's',
    display: 's',
    applies: 'live',
    overridable: true,
    preset: { axis: 'venue', levels: { standard: 10, large: 20, modest: 30 } },
  }),
  LIVE_MOTION: define({
    key: 'LIVE_MOTION',
    description:
      'Transitions between steps on the projection and the phones, as a new room starts: the previous background fades out, the step comes in, the standings slide. `off` for old projectors or low-end devices. The host switches it for their room at any time (console, *Animations*); a device asking the system to reduce motion keeps fades only.',
    category: 'pace',
    criticality: 'C4',
    schema: oneOf(['on', 'off'] as const, (raw) => raw.trim().toLowerCase()),
    accepts: '`on` · `off`',
    default: 'on' as 'on' | 'off',
    applies: 'next-room',
    overridable: true,
    preset: { axis: 'venue', levels: { standard: 'on', large: 'on', modest: 'off' } },
  }),
  GAME_HOST_GRACE_MS: define({
    key: 'GAME_HOST_GRACE_MS',
    description: 'How long a disconnected host may come back before the room is told, in ms.',
    category: 'internal',
    criticality: 'C3',
    schema: number(),
    accepts: 'milliseconds',
    default: 5000,
    unit: 'ms',
    applies: 'live',
    overridable: false,
    internal: true,
  }),
  GAME_HOST_WINDOW_MS: define({
    key: 'GAME_HOST_WINDOW_MS',
    description: 'How long a room waits for its host to come back, in ms.',
    category: 'internal',
    criticality: 'C3',
    schema: number(),
    accepts: 'milliseconds',
    default: 120_000,
    unit: 'ms',
    applies: 'live',
    overridable: false,
    internal: true,
  }),

  // Administration
  ADMIN_WEB_SCOPE: define({
    key: 'ADMIN_WEB_SCOPE',
    description:
      'What the web administration may change in the Instance domain (settings, presets, accounts, host seat): `read` shows everything and changes nothing; `write` lets administrators change the C2–C4 settings and run the instance operations, each critical one confirmed. Media and quizzes are not concerned.',
    category: 'admin',
    criticality: 'C1',
    schema: oneOf(['read', 'write'] as const),
    accepts: '`read` · `write`',
    default: 'read' as 'read' | 'write',
    applies: 'restart',
    overridable: false,
  }),
  ADMIN_LOCK: define({
    key: 'ADMIN_LOCK',
    description:
      'Variables the web administration may never change, whatever `ADMIN_WEB_SCOPE` says: comma-separated names (e.g. `APP_NAME,MEDIA_MAX_VIDEO_MB`). The CLI is not concerned.',
    category: 'admin',
    criticality: 'C1',
    schema: list((key) => key.toUpperCase()),
    accepts: 'comma-separated variable names',
    default: [] as string[],
    applies: 'restart',
    overridable: false,
    example: 'APP_NAME,MEDIA_MAX_VIDEO_MB',
  }),
  ADMIN_TOKEN: define({
    key: 'ADMIN_TOKEN',
    description:
      'Local mode (`AUTH_MODE=none`) has no accounts, so whoever reaches the instance could administer it: the web administration changes nothing there unless this token is set, and asks for it before any change. At least 32 characters.',
    category: 'admin',
    criticality: 'C1',
    schema: text(),
    bounds: z.string().min(32),
    accepts: 'text, 32 characters or more',
    default: '',
    applies: 'restart',
    overridable: false,
    secret: true,
  }),
  ADMIN_OVERRIDES: define({
    key: 'ADMIN_OVERRIDES',
    description:
      '`ignore` starts the instance on its environment alone: every value changed from the web administration is ignored (kept, not deleted) — the way back when one of them went wrong.',
    category: 'admin',
    criticality: 'C1',
    schema: oneOf(['apply', 'ignore'] as const),
    accepts: '`apply` · `ignore`',
    default: 'apply' as 'apply' | 'ignore',
    applies: 'restart',
    overridable: false,
  }),

  // Internal
  QUIZDOCK_FLAVOR: define({
    key: 'QUIZDOCK_FLAVOR',
    description: 'Set by the `:standalone` image, which announces itself through it.',
    category: 'internal',
    criticality: 'C1',
    schema: oneOf(['standalone'] as const),
    accepts: '`standalone`',
    default: null as 'standalone' | null,
    applies: 'restart',
    overridable: false,
    internal: true,
  }),
  PRISMA_SKIP_CONNECT: define({
    key: 'PRISMA_SKIP_CONNECT',
    description: 'Set by the OpenAPI generation: the backend starts without a database.',
    category: 'internal',
    criticality: 'C1',
    schema: oneOf(['1'] as const).transform(() => true),
    accepts: '`1`',
    default: false,
    applies: 'restart',
    overridable: false,
    internal: true,
  }),
};

export type SettingKey = keyof typeof SETTINGS;

/** Every application setting, in declaration order. */
export const SETTING_LIST: SettingDefinition[] = Object.values(SETTINGS) as SettingDefinition[];

/** The variables read before or around the application (§1.8). */
export const DEPLOYMENT_VARIABLES: DeploymentVariable[] = [
  // Compose (production)
  {
    key: 'HTTP_PORT',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`18080`',
    description: 'Host port mapped to the app.',
  },
  {
    key: 'QUIZDOCK_TAG',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`latest`',
    description: 'Image tag to run (`0.4.0` to pin).',
  },
  {
    key: 'QUIZDOCK_MODE',
    readBy: 'script',
    criticality: 'C1',
    defaultText: '`compose`',
    description: 'What the `quizdock` script runs: `compose`, `standalone` or `full`.',
  },
  {
    key: 'POSTGRES_USER',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`live`',
    description: 'Bundled PostgreSQL user (builds `DATABASE_URL`).',
  },
  {
    key: 'POSTGRES_PASSWORD',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`live`',
    description: 'Its password.',
    secret: true,
  },
  {
    key: 'POSTGRES_DB',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`quizdock`',
    description: 'Its database.',
  },
  {
    key: 'PGHOST',
    readBy: 'compose',
    criticality: 'C1',
    description: 'Backup connection (`pg_dump`), derived from the above.',
    internal: true,
  },
  {
    key: 'PGUSER',
    readBy: 'compose',
    criticality: 'C1',
    description: 'Backup connection, derived.',
    internal: true,
  },
  {
    key: 'PGPASSWORD',
    readBy: 'compose',
    criticality: 'C1',
    description: 'Backup connection, derived.',
    secret: true,
    internal: true,
  },
  {
    key: 'NODE_ENV',
    readBy: 'image',
    criticality: 'C1',
    defaultText: '`production`',
    description: 'Node mode, set by the images.',
    internal: true,
  },
  // Full preset, bundled Keycloak
  {
    key: 'PUBLIC_HOST',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`localhost`',
    description: 'Full preset: browser-facing hostname or LAN IP for both services.',
  },
  {
    key: 'PUBLIC_SCHEME',
    readBy: 'compose',
    criticality: 'C1',
    defaultText: '`http`',
    description: 'Full preset: URL scheme; use `https` behind a TLS reverse proxy.',
  },
  {
    key: 'KEYCLOAK_PORT',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: '`18081` (full), `18080` (dev)',
    description: "Keycloak's published HTTP port.",
  },
  {
    key: 'KEYCLOAK_PUBLIC_URL',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: 'Scheme, host and Keycloak port',
    description: 'Full preset: override the browser-facing Keycloak URL, including a proxy path.',
  },
  {
    key: 'KEYCLOAK_APP_URL',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: 'Scheme, host and app port (full)',
    description:
      'Override the app URL allowed for browser redirects. Dev also allows `localhost:15173`, and defaults to `localhost:18081`.',
  },
  {
    key: 'KEYCLOAK_DEV_URL',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: '`http://localhost:15173` (dev)',
    description:
      'Additional dev frontend redirect, alongside `KEYCLOAK_APP_URL`. The full preset uses only `KEYCLOAK_APP_URL`.',
  },
  {
    key: 'KEYCLOAK_ADMIN',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: '`admin`',
    description: 'Keycloak bootstrap administrator.',
  },
  {
    key: 'KEYCLOAK_ADMIN_PASSWORD',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: 'Generated by `init --full`',
    description: 'Bootstrap administrator password; replace the manual example before first start.',
    secret: true,
  },
  {
    key: 'KEYCLOAK_HOST_PASSWORD',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: 'Generated by `init --full`',
    description: 'Initial temporary full-preset host password; dev always uses `animateur`.',
    secret: true,
  },
  {
    key: 'KEYCLOAK_PLAYER_PASSWORD',
    readBy: 'keycloak',
    criticality: 'C1',
    defaultText: 'Generated by `init --full`',
    description: 'Initial temporary full-preset player password; dev always uses `participant`.',
    secret: true,
  },
  // Host script
  {
    key: 'QUIZDOCK_IMAGE',
    readBy: 'script',
    criticality: 'C1',
    defaultText: '`fchaussin/quizdock`',
    description: 'Image the `quizdock` script pulls.',
  },
  {
    key: 'QUIZDOCK_COMPOSE_FILE',
    readBy: 'script',
    criticality: 'C1',
    defaultText: '`docker-compose.prod.yml`',
    description: 'Compose file the `quizdock` script uses.',
  },
  {
    key: 'QUIZDOCK_ENV_FILE',
    readBy: 'script',
    criticality: 'C1',
    defaultText: '`.env`',
    description: 'Env file the `quizdock` script uses.',
  },
  {
    key: 'QUIZDOCK_BACKUP_DIR',
    readBy: 'script',
    criticality: 'C2',
    defaultText: '`./backups`',
    description: 'Where `quizdock backup` writes.',
  },
  {
    key: 'QUIZDOCK_CONTAINER',
    readBy: 'script',
    criticality: 'C1',
    defaultText: '`quizdock`',
    description: "The standalone container's name.",
  },
  {
    key: 'QUIZDOCK_RAW',
    readBy: 'script',
    criticality: 'C1',
    defaultText: "the repository's `main`",
    description: 'Where `quizdock init` fetches its files.',
  },
  // Build
  {
    key: 'APP_VERSION',
    readBy: 'build',
    criticality: 'C4',
    defaultText: '`dev`',
    description: 'Version shown in the app.',
    internal: true,
  },
  {
    key: 'APP_IMAGE_TAG',
    readBy: 'build',
    criticality: 'C4',
    description: "The standalone image's tag.",
    internal: true,
  },
  // Development stack
  {
    key: 'BACKEND_PORT',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`13000`',
    description: 'Host port of the dev backend.',
  },
  {
    key: 'FRONTEND_PORT',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`18081`',
    description: 'Host port of the built frontend.',
  },
  {
    key: 'VITE_PORT',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`15173`',
    description: 'Host port of the Vite dev server.',
  },
  {
    key: 'POSTGRES_PORT',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`15432`',
    description: 'Host port of the dev database.',
  },
  {
    key: 'REDIS_PORT',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`16379`',
    description: 'Host port of the dev Redis.',
  },
  {
    key: 'KC_DB',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: the bundled Keycloak database type.',
    internal: true,
  },
  {
    key: 'KC_DB_URL',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: its database URL.',
    internal: true,
  },
  {
    key: 'KC_DB_USERNAME',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: its database user.',
    internal: true,
  },
  {
    key: 'KC_DB_PASSWORD',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: its database password.',
    secret: true,
    internal: true,
  },
  {
    key: 'KC_HOSTNAME',
    readBy: 'keycloak',
    criticality: 'C1',
    description: "Set by Compose from the variables above: Keycloak's public URL.",
    internal: true,
  },
  {
    key: 'KC_HOSTNAME_BACKCHANNEL_DYNAMIC',
    readBy: 'keycloak',
    criticality: 'C1',
    description:
      'Set by Compose from the variables above: whether the back channel follows the request.',
    internal: true,
  },
  {
    key: 'KC_HEALTH_ENABLED',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: its health endpoints.',
    internal: true,
  },
  {
    key: 'KC_BOOTSTRAP_ADMIN_USERNAME',
    readBy: 'keycloak',
    criticality: 'C1',
    description: 'Set by Compose from the variables above: its bootstrap administrator.',
    internal: true,
  },
  {
    key: 'KC_BOOTSTRAP_ADMIN_PASSWORD',
    readBy: 'keycloak',
    criticality: 'C1',
    description: "Set by Compose from the variables above: that administrator's password.",
    secret: true,
    internal: true,
  },
  {
    key: 'VITE_API_URL',
    readBy: 'dev',
    criticality: 'C4',
    defaultText: '`http://localhost:3000`',
    description: 'Where Vite proxies the API.',
  },
];

/** Whether a variable is declared, by the application or around it. */
export function isDeclaredVariable(key: string): boolean {
  return key in SETTINGS || DEPLOYMENT_VARIABLES.some((v) => v.key === key);
}
