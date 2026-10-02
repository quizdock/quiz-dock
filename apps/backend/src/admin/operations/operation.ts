import type {
  Actor,
  OperationCategory,
  OperationDomain,
  OperationEffect,
  OperationResult,
  RefusalCode,
} from '@quiz-dock/contracts';
import type { RoleSet } from '../../auth/roles';
import type { z } from 'zod';
import { CliError } from '../../cli/output';

/** The caller as the runner sees it: the API adds the account's roles. */
export interface CallActor extends Actor {
  roles?: RoleSet;
  /** API, local mode: the `ADMIN_TOKEN` the request carried. */
  adminToken?: string;
}

export interface OperationContext {
  actor: CallActor;
  /** Say what would be done, change nothing (operations that declare `dryRun`). */
  dryRun: boolean;
  /** A timeout, a closed request. */
  signal: AbortSignal;
}

/**
 * An administrative action (administration spec §3.2, command pattern): its
 * parameters, its domain and effect, its handler. Every access — `qd`, the
 * admin API, the web — runs it the same way, through the `OperationRunner`.
 */
export interface AdminOperation<P = unknown, R = unknown> {
  /** `seat.release`, `users.set-role`, `settings.set`… */
  id: string;
  domain: OperationDomain;
  category: OperationCategory;
  effect: OperationEffect;
  /** What it does, one sentence. */
  summary: string;
  params: z.ZodType<P>;
  /** Can say what it would do without doing it. */
  dryRun?: boolean;
  /**
   * What the caller is asked to confirm, when the operation needs it beyond
   * being destructive (a critical setting, say); `null` when it does not.
   */
  confirmation?(params: P): string | null;
  /** How the confirmation of a destructive operation reads. */
  describe?(params: P): string;
  /** The settings it changes: the gate checks `ADMIN_LOCK` against them. */
  settings?(params: P): string[];
  /** Longer than the runner's default, for a long purge or an import. */
  timeoutMs?: number;
  run(ctx: OperationContext, params: P): Promise<OperationResult<R>>;
}

/** Declares an operation, its parameter type inferred from its schema. */
export function defineOperation<S extends z.ZodType, R>(
  op: Omit<AdminOperation<z.infer<S>, R>, 'params'> & { params: S },
): AdminOperation<z.infer<S>, R> {
  return op as AdminOperation<z.infer<S>, R>;
}

/**
 * A refusal with a stable code, thrown by an operation or a step. Also a
 * `CliError`, so the commands that predate the runner keep their exit codes.
 */
export class OperationError extends CliError {
  constructor(
    readonly code: RefusalCode,
    message: string,
    readonly params?: Record<string, unknown>,
  ) {
    super(message, code === 'invalid_params' ? 2 : 1);
    this.name = 'OperationError';
  }
}

/** A plain result. */
export const done = <R>(data?: R, notes: OperationResult['notes'] = []): OperationResult<R> => ({
  outcome: 'done',
  notes,
  data,
});

export const nothingToDo = <R>(text: string, code: string, data?: R): OperationResult<R> => ({
  outcome: 'nothing-to-do',
  notes: [{ level: 'info', code, text }],
  data,
});
