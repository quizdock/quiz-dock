import { type ArgumentsHost, Catch, ForbiddenException, Inject, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import type { AuditRepository } from '../audit/audit.repository';
import { clientAddress } from './outcome-http';

/**
 * The administration's routes refuse an account without the admin role at the
 * guard, before the runner: that refusal is audited here (§3.10, refusals of
 * rights are kept), then answered as everywhere else.
 */
@Catch(ForbiddenException)
export class RefusalAuditFilter extends HttpExceptionFilter {
  private readonly audit_log = new Logger('Administration');

  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {
    super();
  }

  override catch(exception: ForbiddenException, host: ArgumentsHost): void {
    if (host.getType() === 'http' && exception.message === 'auth.admin_required') {
      const req = host.switchToHttp().getRequest<Request & { user?: User }>();
      void this.audit
        .append({
          via: 'api',
          actor: req.user?.displayName ?? 'unknown',
          userId: req.user?.id ?? null,
          address: clientAddress(req),
          operation: `${req.method} ${req.path}`.slice(0, 64),
          params: {},
          outcome: 'refused',
          code: 'forbidden',
          durationMs: 0,
        })
        .catch((err: Error) => this.audit_log.error(`A refusal not audited: ${err.message}`));
    }
    super.catch(exception, host);
  }
}
