/**
 * What the administration's operations answer (`OperationResult.data`), shared
 * by the backend that builds it and the pages that show it — one declaration,
 * so a change on one side does not compile on the other until both agree.
 */
import type { AuditEntry } from './operations';
import type { PresetAxis, PresetAxisId, SettingDefinition } from './settings';

/**
 * A line a command printed, as data: for any access to render. `code` and
 * `params` say it in a way a page translates (`doctor.redis_ok`); `text` is
 * the English the shell prints, and the page's fallback.
 */
export type OutputEntry =
  | {
      level: 'line' | 'ok' | 'warn' | 'fail';
      text: string;
      code?: string;
      params?: Record<string, unknown>;
    }
  | { level: 'table'; rows: Record<string, unknown>[] };

/** A line's code and parameters, for a page to translate it. */
export interface Said {
  code: string;
  params?: Record<string, unknown>;
}

// ── Settings (§3.1, §3.7) ────────────────────────────────────────────────────

/** Something to tell the operator about a value: logged at start, listed by `qd doctor`. */
export interface SettingIssue {
  key: string;
  code: 'unreadable' | 'out-of-bounds' | 'deprecated' | 'rule';
  message: string;
}

/** A setting as the administration shows it: never a secret's value. */
export interface SettingRow {
  key: string;
  category: SettingDefinition['category'];
  criticality: SettingDefinition['criticality'];
  applies: SettingDefinition['applies'];
  overridable: boolean;
  secret: boolean;
  /** The value in use; for a secret, whether it is set. */
  value: unknown;
  source: 'default' | 'env' | 'override';
  /** The value `.env` gives, when an override replaces it. */
  envValue?: unknown;
  default: unknown;
  /** Named by `ADMIN_LOCK`: the web never changes it. */
  locked: boolean;
  issues: SettingIssue[];
}

/** What the web may do with the settings (§3.7): shown above them. */
export interface SettingsAccess {
  scope: 'read' | 'write';
  locks: string[];
  authMode: 'none' | 'oidc';
  /** Local mode: a change needs `ADMIN_TOKEN`, and whether it is set at all. */
  tokenRequired: boolean;
  tokenSet: boolean;
  /** `ADMIN_OVERRIDES=ignore`: the values changed from the web are not applied. */
  safeMode: boolean;
}

export interface SettingsList {
  rows: SettingRow[];
  /** Settings that contradict each other. */
  rules: SettingIssue[];
  access: SettingsAccess;
}

// ── The quick setup (§3.9) ───────────────────────────────────────────────────

export type AxisLevels = Partial<Record<PresetAxisId, string>>;

export interface PresetChange {
  key: string;
  from: { value: unknown; source: 'default' | 'env' | 'override' };
  to: unknown;
  /** Left alone, and why: locked by `ADMIN_LOCK`, or an axis that does not apply here. */
  skipped?: 'locked' | 'not-applicable';
}

export interface PresetPlan {
  axes: AxisLevels;
  changes: PresetChange[];
}

export interface PresetsList {
  axes: Array<PresetAxis & { settings: { key: string; levels: Record<string, unknown> }[] }>;
  /** The instance's answer to each question; `custom` when it matches none. */
  current: Record<PresetAxisId, string>;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface MigrationsStatus {
  applied: string[];
  pending: string[];
  failed: string[];
  output: OutputEntry[];
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface AccountItem {
  id: string;
  name: string;
  subject: string;
  email: string | null;
  /** What it holds now: the identity provider's claims, the seat, and what was granted. */
  roles: string[];
  /** What an administrator granted (`users.set-role`): kept whatever the provider says. */
  granted: string[];
  quizzes: number;
  /** Games it hosted that the history still holds. */
  games: number;
  createdAt: string;
}

export interface AccountsPage {
  total: number;
  items: AccountItem[];
  /** Local mode only: who holds the host seat; null elsewhere or when free. */
  seat: { holder: string; subject: string; since: string; expiresAt: string | null } | null;
  localMode: boolean;
}

// ── Quizzes ──────────────────────────────────────────────────────────────────

export interface QuizSearchItem {
  id: string;
  title: string;
  status: 'draft' | 'ready' | 'archived';
  questionCount: number;
  updatedAt: string;
  /** `reachable`: an account not deleted, with the host role, can still open it. */
  owner: { id: string; name: string; subject: string; reachable: boolean };
  /** Played right now: not handed over nor deleted until the session ends. */
  livePin: string | null;
}

export interface QuizSearchPage {
  total: number;
  items: QuizSearchItem[];
  owners: { id: string; name: string; subject: string; quizzes: number }[];
}

// ── Statistics ───────────────────────────────────────────────────────────────

/** A game being played right now. */
export interface LiveGame {
  pin: string;
  title: string;
  host: string;
  phase: 'lobby' | 'playing';
  /** Players connected right now. */
  players: number;
  /** When its host opened it (ISO). */
  since: string;
  /** The question on screen, from 1, out of how many; null in the lobby. */
  question: { index: number; total: number } | null;
}

export interface LiveStats {
  at: string;
  games: LiveGame[];
  totals: { games: number; lobby: number; playing: number; players: number };
  instance: {
    accounts: { total: number; hosts: number; admins: number };
    quizzes: Record<'draft' | 'ready' | 'archived', number>;
    media: { files: number; bytes: number };
    /** The games kept in the history, and when the last one ended (ISO). */
    history: { sessions: number; lastEndedAt: string | null };
  };
}

/** One month of the history (UTC), as `YYYY-MM`. */
export interface HistoryMonth {
  month: string;
  games: number;
  players: number;
  /** Right answers out of the answers given, weighted by players; null without answers. */
  successRate: number | null;
}

/** A quiz or a host, ranked by the games played. */
export interface HistoryRank {
  id: string;
  name: string;
  /** A quiz's owner: copies of one quiz share its title. Null for a host. */
  owner: string | null;
  games: number;
  players: number;
}

export interface HistoryStats {
  /** The months read, from `from` (the first of a month, UTC) on. */
  from: string;
  months: HistoryMonth[];
  totals: {
    games: number;
    players: number;
    successRate: number | null;
    /** Among the games that kept each participant's result: with an account, or as a guest. */
    participants: { withAccount: number; guests: number };
  };
  quizzes: HistoryRank[];
  hosts: HistoryRank[];
  /** The oldest game the history still holds (ISO): older ones are purged. */
  oldest: string | null;
}

// ── Each reading operation, and what it answers ──────────────────────────────

/**
 * The data each operation the pages read answers: `useReadOperation('stats.live')`
 * is typed by it, and the backend's handlers declare the same types.
 */
export interface OperationResults {
  'settings.list': SettingsList;
  'settings.export': { env: string; count: number };
  'presets.list': PresetsList;
  'presets.plan': { plan: PresetPlan };
  'health.doctor': { output: OutputEntry[] };
  'migrations.status': MigrationsStatus;
  'users.search': AccountsPage;
  'quizzes.search': QuizSearchPage;
  'stats.live': LiveStats;
  'stats.history': HistoryStats;
  'audit.list': { entries: AuditEntry[] };
}
