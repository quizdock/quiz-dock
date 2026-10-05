import { HttpException, HttpStatus } from '@nestjs/common';
import type { OperationOutcome, RefusalCode } from '@quiz-dock/contracts';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import type { CallActor } from '../operations/operation';

/** The HTTP status of a refusal. */
const STATUS: Record<RefusalCode, number> = {
  unknown_operation: HttpStatus.NOT_FOUND,
  forbidden: HttpStatus.FORBIDDEN,
  scope_read: HttpStatus.FORBIDDEN,
  local_mode_token: HttpStatus.FORBIDDEN,
  demo_read_only: HttpStatus.FORBIDDEN,
  locked: HttpStatus.FORBIDDEN,
  critical: HttpStatus.FORBIDDEN,
  invalid_params: HttpStatus.BAD_REQUEST,
  confirmation_invalid: HttpStatus.CONFLICT,
  dry_run_unsupported: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  timeout: HttpStatus.GATEWAY_TIMEOUT,
  failed: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** A refusal as the API answers it: a stable code (`admin.<code>`, ADR 0001), the message kept for the CLI. */
export function refusalError(
  outcome: Extract<OperationOutcome, { kind: 'refused' }>,
): HttpException {
  // A domain's own error, answered as the route outside the runner answered it.
  if (outcome.domain) {
    return new HttpException(
      {
        code: outcome.domain.code,
        ...(outcome.domain.params ? { params: outcome.domain.params } : {}),
      },
      outcome.domain.status,
    );
  }
  return new HttpException(
    { code: `admin.${outcome.code}`, params: { ...outcome.params, message: outcome.message } },
    STATUS[outcome.code],
  );
}

/**
 * For a route that predates the runner (the media page): its result's data, or
 * the refusal as an HTTP error. Such a route never asks to confirm: its page did.
 */
export function unwrap<T>(outcome: OperationOutcome): T {
  if (outcome.kind === 'refused') throw refusalError(outcome);
  if (outcome.kind === 'confirm') {
    throw new HttpException({ code: 'admin.confirmation_invalid' }, HttpStatus.CONFLICT);
  }
  return outcome.result.data as T;
}

/**
 * The caller's address as the audit keeps it: what the proxies say (`req.ip`),
 * and the connection's own peer when they differ.
 */
export function clientAddress(req: Request): string | null {
  const ip = req.ip ?? null;
  const peer = req.socket?.remoteAddress ?? null;
  return ip && peer && ip !== peer ? `${ip} via ${peer}` : (ip ?? peer);
}

/** Who calls, as the runner wants it: the account, its roles, its address, the local mode's token. */
export function apiActor(user: User, req: Request): CallActor {
  const token = req.headers['x-admin-token'];
  return {
    via: 'api',
    userId: user.id,
    name: user.displayName,
    roles: user.roles,
    address: clientAddress(req) ?? undefined,
    ...(typeof token === 'string' && token ? { adminToken: token } : {}),
  };
}
