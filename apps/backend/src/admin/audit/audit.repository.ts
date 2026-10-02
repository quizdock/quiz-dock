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
  constructor(private readonly prisma: Pick<PrismaService, 'adminAudit' | '$queryRaw'>) {}

  async append(entry: NewAuditEntry): Promise<void> {
    await this.prisma.adminAudit.create({
      data: { ...entry, params: entry.params as Prisma.InputJsonValue },
    });
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const where: Prisma.AdminAuditWhereInput = {};
    if (query.operation) where.operation = query.operation;
    if (query.setting) where.id = { in: await this.touching(query.setting) };
    if (query.before) where.id = { ...(where.id as object), lt: query.before };
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

  /**
   * The entries that changed a setting: one at a time (`settings.set`/`reset`,
   * its `key`), several at once (`presets.apply`, its `before` by key), or all
   * taken back (`settings.reset --all`, `before.overrides` by key).
   */
  private async touching(key: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM admin_audit
      WHERE params->>'key' = ${key}
         OR jsonb_exists(params->'before', ${key})
         OR jsonb_exists(params->'before'->'overrides', ${key})
      ORDER BY id DESC LIMIT ${AUDIT_PAGE_MAX}`;
    return rows.map((r) => r.id);
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
        .filter((e) => !query.setting || touches(e.params, query.setting))
        .filter((e) => !query.before || e.id < query.before)
        .slice(0, Math.min(query.limit ?? 50, AUDIT_PAGE_MAX)),
    );
  }
}

/** Whether an entry's parameters changed a setting (see `PrismaAuditRepository.touching`). */
function touches(params: Record<string, unknown>, key: string): boolean {
  const before = (params.before ?? {}) as Record<string, unknown>;
  const overrides = (before.overrides ?? {}) as Record<string, unknown>;
  return params.key === key || key in before || key in overrides;
}
