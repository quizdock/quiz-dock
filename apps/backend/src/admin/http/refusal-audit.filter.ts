import { type ArgumentsHost, Catch, ForbiddenException, Inject, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { RedisService } from '../../redis/redis.service';
import { clientAddress } from './outcome-http';

/** Refusals kept per account (or address) in a window: enough to see, not to fill the disk. */
export const REFUSALS_AUDITED = 5;
export const REFUSALS_WINDOW_S = 600;

/**
 * The administration's routes refuse an account without the admin role at the
 * guard, before the runner: that refusal is audited here (§3.10, refusals of
 * rights are kept), then answered as everywhere else. A few per account and
 * window: anyone can ask (a public demo's visitors), and each kept is a row.
 */
@Catch(ForbiddenException)
export class RefusalAuditFilter extends HttpExceptionFilter {
  private readonly audit_log = new Logger('Administration');

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly redis: RedisService,
  ) {
    super();
  }

  override catch(exception: ForbiddenException, host: ArgumentsHost): void {
    if (host.getType() === 'http' && exception.message === 'auth.admin_required') {
      const req = host.switchToHttp().getRequest<Request & { user?: User }>();
      void this.record(req).catch((err: Error) =>
        this.audit_log.error(`A refusal not audited: ${err.message}`),
      );
    }
    super.catch(exception, host);
  }

  private async record(req: Request & { user?: User }): Promise<void> {
    const who = `admin:refusals:${req.user?.id ?? clientAddress(req)}`;
    const [, [, count]] = (await this.redis
      .multi()
      .set(who, '0', 'EX', REFUSALS_WINDOW_S, 'NX')
      .incr(who)
      .exec()) as [unknown, [unknown, number]];
    if (count > REFUSALS_AUDITED) return;
    await this.audit.append({
      via: 'api',
      actor: (req.user?.displayName ?? 'unknown').slice(0, 120),
      userId: req.user?.id ?? null,
      address: clientAddress(req),
      operation: `${req.method} ${req.path}`.slice(0, 64),
      params: {},
      outcome: 'refused',
      code: 'forbidden',
      durationMs: 0,
    });
  }
}
