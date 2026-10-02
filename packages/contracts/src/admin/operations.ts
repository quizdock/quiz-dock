/**
 * Administrative operations (administration spec §3.2–3.4): the shapes every
 * access shares — the in-image CLI `qd`, the admin API and the web
 * administration. The operations themselves live in the backend.
 */

/** The three domains of the administration (§0.1); `ADMIN_WEB_SCOPE` gates `instance` only. */
export type OperationDomain = 'media' | 'quizzes' | 'instance';

export type OperationCategory =
  | 'health'
  | 'users'
  | 'quizzes'
  | 'sessions'
  | 'settings'
  | 'presets'
  | 'setup'
  | 'media'
  | 'audit'
  | 'stats';

/** What an operation does to the instance: reading, changing, or destroying. */
export type OperationEffect = 'read' | 'write' | 'destructive';

/** Who calls, and through what. */
export interface Actor {
  via: 'cli' | 'api';
  /** API: the signed-in account. */
  userId?: string;
  /** CLI: the container's user, or `--as`; API: the account's display name. */
  name: string;
  /** API: the client's address. */
  address?: string;
}

export interface OperationNote {
  level: 'info' | 'warn';
  /** Stable, translated by the web (`admin.notes.<code>`). */
  code: string;
  /** Plain English, for the CLI and the logs. */
  text: string;
  params?: Record<string, unknown>;
}

export interface OperationResult<R = unknown> {
  outcome: 'done' | 'nothing-to-do' | 'partial';
  notes: OperationNote[];
  /** Rows or an object: each access renders it. */
  data?: R;
  /** What the operation replaced (§3.11, memento): kept in the audit, for going back. */
  memento?: Record<string, unknown>;
}

/** Why the runner did not run an operation. Stable: the web translates them. */
export type RefusalCode =
  | 'unknown_operation'
  | 'forbidden'
  | 'scope_read'
  | 'local_mode_token'
  | 'locked'
  | 'critical'
  | 'invalid_params'
  | 'confirmation_invalid'
  | 'dry_run_unsupported'
  | 'not_found'
  | 'conflict'
  | 'timeout'
  | 'failed';

export type OperationOutcome =
  | { kind: 'result'; result: OperationResult }
  /** Ask, then call again with the token. */
  | { kind: 'confirm'; token: string; summary: string }
  | { kind: 'refused'; code: RefusalCode; message: string; params?: Record<string, unknown> };

/** An operation as the catalogue lists it. */
export interface OperationDescriptor {
  id: string;
  domain: OperationDomain;
  category: OperationCategory;
  effect: OperationEffect;
  /** What it does, one sentence (English; the web has its own wording by id). */
  summary: string;
  /** Its parameters, as a JSON Schema (forms, CLI help). */
  params: Record<string, unknown>;
  dryRun: boolean;
  /** Whether this caller may run it, and if not, why. */
  reachable: boolean;
  refusal?: RefusalCode;
}

/** A line of the audit log. Parameters are stored with secrets masked. */
export interface AuditEntry {
  id: string;
  at: string;
  via: Actor['via'];
  actor: string;
  userId: string | null;
  address: string | null;
  operation: string;
  params: Record<string, unknown>;
  outcome: OperationResult['outcome'] | 'refused' | 'failed';
  code: string | null;
  durationMs: number;
}
