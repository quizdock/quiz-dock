import type { AuditEntry } from '@quiz-dock/contracts';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export type NewAuditEntry = Omit<AuditEntry, 'id' | 'at'>;

export interface AuditQuery {
  limit?: number;
  /** Entries older than this one (the id of the last entry of the previous page). */
  before?: string;
  operation?: string;
  /** Entries concerning a setting: `settings.set` / `settings.reset` of this key. */
  setting?: string;
}

/**
 * The audit log (§3.3 step 7, §3.11): appended to and read — the code has no
 * way to change or remove an entry.
 */
export interface AuditRepository {
  append(entry: NewAuditEntry): Promise<void>;
  list(query?: AuditQuery): Promise<AuditEntry[]>;
}

export const AUDIT_PAGE_MAX = 200;

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: Pick<PrismaService, 'adminAudit'>) {}

  async append(entry: NewAuditEntry): Promise<void> {
    await this.prisma.adminAudit.create({
      data: { ...entry, params: entry.params as Prisma.InputJsonValue },
    });
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const where: Prisma.AdminAuditWhereInput = {};
    if (query.operation) where.operation = query.operation;
    if (query.setting) where.params = { path: ['key'], equals: query.setting };
    if (query.before) where.id = { lt: query.before };
    const rows = await this.prisma.adminAudit.findMany({
      where,
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(query.limit ?? 50, 1), AUDIT_PAGE_MAX),
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      via: r.via as AuditEntry['via'],
      actor: r.actor,
      userId: r.userId,
      address: r.address,
      operation: r.operation,
      params: (r.params ?? {}) as Record<string, unknown>,
      outcome: r.outcome as AuditEntry['outcome'],
      code: r.code,
      durationMs: r.durationMs,
    }));
  }
}

/** For the tests. */
export class MemoryAuditRepository implements AuditRepository {
  readonly entries: AuditEntry[] = [];
  private seq = 0;

  async append(entry: NewAuditEntry): Promise<void> {
    this.seq += 1;
    this.entries.push({
      ...entry,
      id: String(this.seq).padStart(26, '0'),
      at: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    return Promise.resolve(
      [...this.entries]
        .reverse()
        .filter((e) => !query.operation || e.operation === query.operation)
        .filter((e) => !query.setting || e.params.key === query.setting)
        .filter((e) => !query.before || e.id < query.before)
        .slice(0, Math.min(query.limit ?? 50, AUDIT_PAGE_MAX)),
    );
  }
}
