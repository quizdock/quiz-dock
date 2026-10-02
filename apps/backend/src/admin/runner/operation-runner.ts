import { timingSafeEqual } from 'node:crypto';
import {
  type OperationDescriptor,
  type OperationDomain,
  type OperationOutcome,
  type RefusalCode,
  SETTINGS,
} from '@quiz-dock/contracts';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { isManager } from '../../auth/roles';
import type { AuditRepository } from '../audit/audit.repository';
import type { AdminOperation, CallActor } from '../operations/operation';
import { OperationError } from '../operations/operation';
import type { SettingsService } from '../settings/settings.service';
import type { ConfirmationStore } from './confirmations';

/** One call of an operation, whatever the access (§3.4). */
export interface OperationCall {
  /** `presets.apply`. */
  id: string;
  /** Raw parameters, validated by the runner. */
  raw: unknown;
  actor: CallActor;
  dryRun?: boolean;
  /** The token a `confirm` outcome handed out. */
  confirmation?: string;
  /** A closed request. */
  signal?: AbortSignal;
  /**
   * What an access hands over beside the parameters and cannot serialize — an
   * uploaded file. Neither validated nor audited: the operation checks it.
   */
  attachments?: Record<string, unknown>;
  /**
   * The access already asked (a page with its own confirmation dialog, a command
   * of old that never asked): the confirmation step lets it through.
   */
  preconfirmed?: boolean;
}

/** What the steps pass along: the call, then what they learnt about it. */
export interface RunState {
  call: OperationCall;
  op?: AdminOperation;
  params?: unknown;
}

/** A cross-cutting step (§3.3): does its part, then hands over to the next one — or does not. */
export interface OperationStep {
  readonly name: string;
  handle(state: RunState, next: () => Promise<OperationOutcome>): Promise<OperationOutcome>;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

type Refusal = Extract<OperationOutcome, { kind: 'refused' }>;

const refused = (
  code: RefusalCode,
  message: string,
  params?: Record<string, unknown>,
): Refusal => ({
  kind: 'refused',
  code,
  message,
  ...(params ? { params } : {}),
});

/** Who may run what from the API (§3.11, policy objects): deny by default. */
export const POLICIES: Record<OperationDomain, (actor: CallActor) => boolean> = {
  media: (actor) => isManager(actor.roles ?? []),
  quizzes: (actor) => isManager(actor.roles ?? []),
  instance: (actor) => isManager(actor.roles ?? []),
};

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Parameters as the audit keeps them: secrets masked, long values summed up. */
export function maskParams(value: unknown): Record<string, unknown> {
  const mask = (v: unknown, key = ''): unknown => {
    if (/token|password|secret/i.test(key)) return v === undefined || v === '' ? v : '***';
    if (typeof v === 'string' && v.length > 256) return `[${v.length} characters]`;
    if (Array.isArray(v)) return v.slice(0, 50).map((item) => mask(item));
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, mask(item, k)]));
    return v;
  };
  const masked = mask(value);
  return masked && typeof masked === 'object' && !Array.isArray(masked)
    ? (masked as Record<string, unknown>)
    : { value: masked };
}

/** What a confirmation token is bound to: this operation, these parameters, this caller. */
const fingerprint = (state: RunState) =>
  JSON.stringify([
    state.call.id,
    state.params ?? null,
    state.call.actor.via,
    state.call.actor.userId ?? null,
    state.call.actor.name,
  ]);

/**
 * The one port every access drives (§3.3–3.4): resolves the operation, then
 * hands the call through the steps in their fixed order — audit, errors,
 * rights, validation, gate, dry run, confirmation, execution.
 */
export class OperationRunner {
  private readonly byId: Map<string, AdminOperation>;
  readonly steps: OperationStep[];

  constructor(
    operations: AdminOperation[],
    private readonly settings: SettingsService,
    private readonly audit: AuditRepository,
    private readonly confirmations: ConfirmationStore,
  ) {
    this.byId = new Map();
    for (const op of operations) {
      if (this.byId.has(op.id)) throw new Error(`Operation ${op.id} declared twice`);
      this.byId.set(op.id, op);
    }
    this.steps = [
      this.auditStep(),
      this.errorsStep(),
      this.lookupStep(),
      this.rightsStep(),
      this.validationStep(),
      this.gateStep(),
      this.dryRunStep(),
      this.confirmationStep(),
      this.executionStep(),
    ];
  }

  operation(id: string): AdminOperation | undefined {
    return this.byId.get(id);
  }

  /** Every operation, and whether this caller may run it (§3.4 `catalogue`). */
  catalogue(actor: CallActor): OperationDescriptor[] {
    return [...this.byId.values()].map((op) => {
      const refusal = this.rights(op, actor) ?? this.scope(op, actor);
      return {
        id: op.id,
        domain: op.domain,
        category: op.category,
        effect: op.effect,
        summary: op.summary,
        params: z.toJSONSchema(op.params, { io: 'input', unrepresentable: 'any' }) as Record<
          string,
          unknown
        >,
        dryRun: !!op.dryRun,
        reachable: !refusal,
        ...(refusal ? { refusal: refusal.code } : {}),
      };
    });
  }

  async run(call: OperationCall): Promise<OperationOutcome> {
    const state: RunState = { call };
    const at = (i: number): Promise<OperationOutcome> =>
      i < this.steps.length
        ? this.steps[i].handle(state, () => at(i + 1))
        : Promise.resolve(refused('failed', 'No step ran the operation.'));
    return at(0);
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  /** 7 — every change and every refusal, kept: who, through what, what, the outcome, how long. */
  private auditStep(): OperationStep {
    return {
      name: 'audit',
      handle: async (state, next) => {
        const started = Date.now();
        const outcome = await next();
        const { op, call } = state;
        const changes = op && op.effect !== 'read' && !call.dryRun;
        if (outcome.kind === 'confirm' || !(changes || outcome.kind === 'refused')) return outcome;
        await this.audit.append({
          via: call.actor.via,
          actor: call.actor.name,
          userId: call.actor.userId ?? null,
          address: call.actor.address ?? null,
          operation: call.id.slice(0, 64),
          params: maskParams({
            ...((state.params ?? call.raw ?? {}) as Record<string, unknown>),
            ...(outcome.kind === 'result' && outcome.result.memento
              ? { before: outcome.result.memento }
              : {}),
          }),
          outcome: outcome.kind === 'result' ? outcome.result.outcome : 'refused',
          code: outcome.kind === 'refused' ? outcome.code : null,
          durationMs: Date.now() - started,
        });
        return outcome;
      },
    };
  }

  /** 8 — whatever goes wrong becomes a stable code; no stack, no internal value. */
  private errorsStep(): OperationStep {
    return {
      name: 'errors',
      handle: async (_state, next) => {
        try {
          return await next();
        } catch (err) {
          if (err instanceof OperationError) return refused(err.code, err.message, err.params);
          if (err instanceof HttpException) {
            const status = err.getStatus();
            const code: RefusalCode =
              status === 404
                ? 'not_found'
                : status === 409
                  ? 'conflict'
                  : status === 403
                    ? 'forbidden'
                    : status < 500
                      ? 'invalid_params'
                      : 'failed';
            return refused(code, err.message);
          }
          return refused('failed', (err as Error)?.message ?? 'The operation failed.');
        }
      },
    };
  }

  private lookupStep(): OperationStep {
    return {
      name: 'lookup',
      handle: (state, next) => {
        state.op = this.byId.get(state.call.id);
        if (!state.op) {
          return Promise.resolve(
            refused('unknown_operation', `Unknown operation "${state.call.id}".`),
          );
        }
        return next();
      },
    };
  }

  private rights(op: AdminOperation, actor: CallActor): Refusal | null {
    // A shell in the container already holds every right.
    if (actor.via === 'cli') return null;
    if (op.access === 'cli') return refused('forbidden', `${op.id} runs from a shell only.`);
    // The wizard, under its token: its own operations, nothing else.
    if (actor.setup) {
      return op.wizard ? null : refused('forbidden', `The setup wizard cannot run ${op.id}.`);
    }
    const policy = POLICIES[op.domain];
    return policy && policy(actor)
      ? null
      : refused('forbidden', 'The administrator role is required.');
  }

  /** 2 — the API needs the administrator role; the CLI is trusted. */
  private rightsStep(): OperationStep {
    return {
      name: 'rights',
      handle: (state, next) => {
        const refusal = this.rights(state.op!, state.call.actor);
        return refusal ? Promise.resolve(refusal) : next();
      },
    };
  }

  /** 3 — the parameters through the operation's schema, one error shape. */
  private validationStep(): OperationStep {
    return {
      name: 'validation',
      handle: (state, next) => {
        const parsed = state.op!.params.safeParse(state.call.raw ?? {});
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const path = issue?.path.join('.') || 'params';
          return Promise.resolve(
            refused('invalid_params', `${path}: ${issue?.message ?? 'invalid'}`, { path }),
          );
        }
        state.params = parsed.data;
        return Promise.resolve(state.op!.validate?.(parsed.data)).then(() => next());
      },
    };
  }

  /** What the web may change (§3.7, §3.10): the scope, local mode's token. */
  private scope(op: AdminOperation, actor: CallActor): Refusal | null {
    if (actor.via === 'cli' || op.effect === 'read' || actor.setup) return null;
    if (this.settings.get(SETTINGS.AUTH_MODE) === 'none' && op.domain !== 'media') {
      const token = this.settings.get(SETTINGS.ADMIN_TOKEN);
      if (!token || !actor.adminToken || !sameSecret(token, actor.adminToken)) {
        return refused(
          'local_mode_token',
          token
            ? 'Local mode: give the administration token (ADMIN_TOKEN) to change anything.'
            : 'Local mode: the web changes nothing unless ADMIN_TOKEN is set in .env.',
        );
      }
    }
    if (op.domain === 'instance' && this.settings.get(SETTINGS.ADMIN_WEB_SCOPE) !== 'write') {
      return refused(
        'scope_read',
        'ADMIN_WEB_SCOPE=read: the web shows the instance and changes nothing in it.',
      );
    }
    return null;
  }

  /** 1 — the scope and the locks, for the API (the CLI is never gated). */
  private gateStep(): OperationStep {
    return {
      name: 'gate',
      handle: (state, next) => {
        const { op, call } = state;
        const scoped = this.scope(op!, call.actor);
        if (scoped) return Promise.resolve(scoped);
        if (call.actor.via === 'api' && op!.settings) {
          const locks = this.settings.get(SETTINGS.ADMIN_LOCK);
          const locked = op!.settings(state.params).filter((key) => locks.includes(key));
          if (locked.length) {
            return Promise.resolve(
              refused('locked', `Locked by ADMIN_LOCK: ${locked.join(', ')}.`, { keys: locked }),
            );
          }
        }
        return next();
      },
    };
  }

  /** 5 — a preview runs the operation with `dryRun`, without confirmation. */
  private dryRunStep(): OperationStep {
    return {
      name: 'dry-run',
      handle: (state, next) => {
        if (state.call.dryRun && !state.op!.dryRun) {
          return Promise.resolve(
            refused('dry_run_unsupported', `${state.op!.id} cannot say what it would do.`),
          );
        }
        return next();
      },
    };
  }

  /** 4 — a destructive operation, or a critical change, is confirmed: asked, then sent again with the token. */
  private confirmationStep(): OperationStep {
    return {
      name: 'confirmation',
      handle: async (state, next) => {
        const { op, call } = state;
        if (call.dryRun || call.preconfirmed) return next();
        const ask =
          (await op!.confirmation?.(state.params)) ??
          (op!.effect === 'destructive'
            ? ((await op!.describe?.(state.params)) ?? `${op!.summary} This cannot be undone.`)
            : null);
        if (!ask) return next();
        if (!call.confirmation) {
          return {
            kind: 'confirm',
            token: await this.confirmations.issue(fingerprint(state)),
            summary: ask,
          };
        }
        if (!(await this.confirmations.redeem(call.confirmation, fingerprint(state)))) {
          return refused(
            'confirmation_invalid',
            'The confirmation is not valid any more: ask again.',
          );
        }
        return next();
      },
    };
  }

  /** 6 — the handler, within its time. */
  private executionStep(): OperationStep {
    return {
      name: 'execution',
      handle: async (state) => {
        const { op, call } = state;
        const timeout = AbortSignal.timeout(op!.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
        const aborted = new Promise<never>((_, reject) => {
          const fail = () => reject(new OperationError('timeout', `${op!.id} took too long.`));
          if (signal.aborted) fail();
          signal.addEventListener('abort', fail, { once: true });
        });
        aborted.catch(() => undefined); // settled after the handler: nobody listens any more
        const result = await Promise.race([
          op!.run(
            {
              actor: call.actor,
              dryRun: !!call.dryRun,
              signal,
              attachments: call.attachments ?? {},
            },
            state.params,
          ),
          aborted,
        ]);
        return { kind: 'result', result };
      },
    };
  }
}
