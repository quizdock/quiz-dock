import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type MediaKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type LastSweep, MediaJanitor, type SweepResult } from './media-janitor.service';
import { USED_BY_QUIZ } from './media-library.service';
import { ORPHAN_GRACE_MS, MediaService } from './media.service';

/** What the editor stores today; anything else was stored before the converter. */
const CURRENT_MIMES = ['image/webp', 'video/mp4', 'audio/mp4'];
const TOP_OWNERS = 10;
const PAGE_MAX = 100;

/** A file on the volume: a blob, or a media from before sharing with a file of its own. */
const FILE_KEY = Prisma.sql`COALESCE(m.blob_sha256, m.id)`;

/** Whether the media `m` is used anywhere: a quiz (any owner) or an archived session. */
const USED_ANYWHERE = Prisma.sql`(
  EXISTS (SELECT 1 FROM quiz q WHERE ${USED_BY_QUIZ})
  OR EXISTS (SELECT 1 FROM game_session_log g WHERE g.quiz_snapshot::text LIKE '%' || m.id || '%')
)`;

export interface MediaOverview {
  files: number;
  bytes: number;
  byKind: Array<{ kind: MediaKind; files: number; bytes: number }>;
  /** The largest holders; a file shared by two authors counts for both. */
  byOwner: Array<{ ownerId: string; displayName: string; files: number; bytes: number }>;
  legacy: { files: number; bytes: number; mimes: string[] };
  cleanup: {
    /** Media nothing uses, the sweep deletes once they are a day old. */
    orphans: { count: number; bytes: number; waiting: number };
    /** Files on the volume nothing points to. */
    strayFiles: { count: number; bytes: number };
    /** What keeps stray files from being purged, if anything. */
    guard: 'empty_database' | 'database_older' | null;
    lastRun: LastSweep | null;
  };
}

export interface MediaFileRow {
  /** The most recent media on the file: what the page shows and deletes by. */
  id: string;
  url: string;
  kind: MediaKind;
  mime: string;
  name: string | null;
  sizeBytes: number;
  owners: string[];
  /** Media rows on the file (reuses, copies, other authors). */
  mediaCount: number;
  /** Quizzes of any owner using it. */
  quizCount: number;
  inHistory: boolean;
  legacy: boolean;
  createdAt: string;
}

export interface MediaFileFilter {
  kind?: MediaKind;
  ownerId?: string;
  legacy?: boolean;
  q?: string;
  sort?: 'size' | 'usage' | 'recent';
  offset?: number;
  limit?: number;
}

export interface MediaFileUsages {
  quizzes: Array<{ id: string; title: string; owner: string }>;
  archivedSessions: number;
  playing: boolean;
}

/**
 * The administration of the instance's media (#54): what the volume holds and
 * who fills it, what the clean-up has to do, and deleting any file — used or
 * not, an administrator's decision (moderation), refused only while a session
 * plays it.
 */
@Injectable()
export class MediaAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly janitor: MediaJanitor,
  ) {}

  /**
   * The volume at a glance. `ownerIds` narrows the media counted to those
   * authors' (the stray files, which have no author, stay the whole volume's).
   */
  async overview(ownerIds?: string[]): Promise<MediaOverview> {
    const scope = ownerIds ? Prisma.sql`WHERE m.owner_id = ANY (${ownerIds})` : Prisma.empty;
    const files = Prisma.sql`
      SELECT ${FILE_KEY} AS k, MIN(m.kind::text) AS kind, MIN(m.mime) AS mime,
             MAX(m.size_bytes) AS bytes
      FROM media_asset m ${scope} GROUP BY 1`;
    const [kinds, owners, legacy, orphans, stray, lastRun] = await Promise.all([
      this.prisma.$queryRaw<Array<{ kind: MediaKind; files: number; bytes: bigint }>>`
        SELECT f.kind, COUNT(*)::int AS files, COALESCE(SUM(f.bytes), 0)::bigint AS bytes
        FROM (${files}) f GROUP BY f.kind ORDER BY f.kind`,
      this.prisma.$queryRaw<
        Array<{ ownerId: string; displayName: string; files: number; bytes: bigint }>
      >`
        SELECT o.owner_id AS "ownerId", u.display_name AS "displayName",
               COUNT(*)::int AS files, SUM(o.bytes)::bigint AS bytes
        FROM (SELECT m.owner_id, ${FILE_KEY} AS k, MAX(m.size_bytes) AS bytes
              FROM media_asset m ${scope} GROUP BY 1, 2) o
        JOIN "user" u ON u.id = o.owner_id
        GROUP BY 1, 2 ORDER BY bytes DESC LIMIT ${TOP_OWNERS}`,
      this.prisma.$queryRaw<Array<{ files: number; bytes: bigint; mimes: string[] }>>`
        SELECT COUNT(*)::int AS files, COALESCE(SUM(f.bytes), 0)::bigint AS bytes,
               COALESCE(ARRAY_AGG(DISTINCT f.mime) FILTER (WHERE f.mime IS NOT NULL), '{}') AS mimes
        FROM (${files}) f WHERE f.mime <> ALL (${CURRENT_MIMES})`,
      // Media rows nothing uses; the bytes are those of the files every media of which is
      // unused — what the sweep will actually free, a shared file counted once.
      this.prisma.$queryRaw<Array<{ count: number; bytes: bigint; waiting: number }>>`
        WITH m AS (
          SELECT m.*, ${FILE_KEY} AS k, NOT ${USED_ANYWHERE} AS unused FROM media_asset m ${scope}
        )
        SELECT COUNT(*) FILTER (WHERE unused)::int AS count,
               COUNT(*) FILTER (
                 WHERE unused AND created_at >= ${new Date(Date.now() - ORPHAN_GRACE_MS)})::int
                 AS waiting,
               COALESCE((SELECT SUM(b) FROM (SELECT MAX(size_bytes) AS b FROM m GROUP BY k
                                              HAVING BOOL_AND(unused)) f), 0)::bigint AS bytes
        FROM m`,
      this.media.strayFiles(),
      this.janitor.last(),
    ]);
    const byKind = kinds.map((k) => ({ ...k, bytes: Number(k.bytes) }));
    return {
      files: byKind.reduce((n, k) => n + k.files, 0),
      bytes: byKind.reduce((n, k) => n + k.bytes, 0),
      byKind,
      byOwner: owners.map((o) => ({ ...o, bytes: Number(o.bytes) })),
      legacy: { ...legacy[0], bytes: Number(legacy[0].bytes) },
      cleanup: {
        orphans: { ...orphans[0], bytes: Number(orphans[0].bytes) },
        strayFiles: {
          count: stray.files.length,
          bytes: stray.files.reduce((n, f) => n + f.bytes, 0),
        },
        guard: stray.guard,
        lastRun,
      },
    };
  }

  /** The instance's files, one row per file, filtered and sorted, a page at a time. */
  async files(filter: MediaFileFilter = {}): Promise<{ total: number; items: MediaFileRow[] }> {
    const where: Prisma.Sql[] = [];
    if (filter.kind) where.push(Prisma.sql`f.kind = ${filter.kind}`);
    if (filter.ownerId) where.push(Prisma.sql`${filter.ownerId} = ANY (f.owner_ids)`);
    if (filter.legacy) where.push(Prisma.sql`f.legacy`);
    if (filter.q?.trim()) {
      const q = `%${filter.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      where.push(Prisma.sql`f.name ILIKE ${q}`);
    }
    const filtered = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const order =
      filter.sort === 'usage'
        ? Prisma.sql`"quizCount" DESC, "mediaCount" DESC, f.bytes DESC`
        : filter.sort === 'recent'
          ? Prisma.sql`f.created_at DESC`
          : Prisma.sql`f.bytes DESC`;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), PAGE_MAX);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await this.prisma.$queryRaw<
      Array<
        Omit<MediaFileRow, 'sizeBytes' | 'createdAt'> & {
          bytes: bigint;
          created_at: Date;
          total: number;
        }
      >
    >`
      WITH f AS (
        SELECT ${FILE_KEY} AS k,
               (ARRAY_AGG(m.id ORDER BY m.created_at DESC))[1] AS id,
               (ARRAY_AGG(m.url ORDER BY m.created_at DESC))[1] AS url,
               (ARRAY_AGG(m.name ORDER BY m.created_at DESC) FILTER (WHERE m.name IS NOT NULL))[1] AS name,
               MIN(m.kind::text) AS kind, MIN(m.mime) AS mime, MAX(m.size_bytes) AS bytes,
               ARRAY_AGG(DISTINCT m.owner_id) AS owner_ids,
               ARRAY_AGG(DISTINCT u.display_name) AS owners,
               COUNT(*)::int AS "mediaCount",
               MIN(m.created_at) AS created_at,
               BOOL_OR(m.mime <> ALL (${CURRENT_MIMES})) AS legacy
        FROM media_asset m JOIN "user" u ON u.id = m.owner_id
        GROUP BY 1
      )
      SELECT f.id, f.url, f.kind, f.mime, f.name, f.bytes, f.owners, f."mediaCount", f.legacy,
             f.created_at,
             (SELECT COUNT(DISTINCT q.id)::int FROM media_asset m JOIN quiz q ON ${USED_BY_QUIZ}
              WHERE ${FILE_KEY} = f.k) AS "quizCount",
             EXISTS (SELECT 1 FROM media_asset m JOIN game_session_log g
                       ON g.quiz_snapshot::text LIKE '%' || m.id || '%'
                     WHERE ${FILE_KEY} = f.k) AS "inHistory",
             COUNT(*) OVER ()::int AS total
      FROM f ${filtered}
      ORDER BY ${order}
      LIMIT ${limit} OFFSET ${offset}`;
    return {
      total: rows[0]?.total ?? (offset > 0 ? await this.countFiles(filtered) : 0),
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        kind: r.kind,
        mime: r.mime,
        name: r.name,
        sizeBytes: Number(r.bytes),
        owners: r.owners,
        mediaCount: r.mediaCount,
        quizCount: r.quizCount,
        inHistory: r.inHistory,
        legacy: r.legacy,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /** What deleting a file would break: the quizzes (any owner), the archived sessions. */
  async usages(id: string): Promise<MediaFileUsages> {
    const ids = await this.sameFile(id);
    const [quizzes, archived, playing] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; title: string; owner: string }>>`
        SELECT DISTINCT q.id, q.title, u.display_name AS owner
        FROM media_asset m JOIN quiz q ON ${USED_BY_QUIZ} JOIN "user" u ON u.id = q.owner_id
        WHERE m.id = ANY (${ids}) ORDER BY q.title`,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(DISTINCT g.id)::int AS n FROM media_asset m
        JOIN game_session_log g ON g.quiz_snapshot::text LIKE '%' || m.id || '%'
        WHERE m.id = ANY (${ids})`,
      this.media.playing(ids),
    ]);
    return { quizzes, archivedSessions: archived[0]?.n ?? 0, playing };
  }

  /**
   * Deletes a file and every media on it, whoever owns them and whatever uses
   * them — refused only while a session plays it (a frozen game must not lose
   * a media mid-way).
   */
  async deleteFile(id: string): Promise<void> {
    const ids = await this.sameFile(id);
    if (await this.media.playing(ids)) throw new ConflictException('media.playing');
    await this.media.deleteForGood(ids);
  }

  /** The clean-up pass, now. `null` when another pass is running. */
  sweepNow(): Promise<SweepResult | null> {
    return this.janitor.run(true);
  }

  /** Every media on the same file as `id`. */
  private async sameFile(id: string): Promise<string[]> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, blobSha256: true },
    });
    if (!asset) throw new NotFoundException('media.not_found');
    if (!asset.blobSha256) return [asset.id];
    const group = await this.prisma.mediaAsset.findMany({
      where: { blobSha256: asset.blobSha256 },
      select: { id: true },
    });
    return group.map((m) => m.id);
  }

  private async countFiles(filtered: Prisma.Sql): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      WITH f AS (
        SELECT ${FILE_KEY} AS k, MIN(m.kind::text) AS kind, MIN(m.mime) AS mime,
               ARRAY_AGG(DISTINCT m.owner_id) AS owner_ids,
               (ARRAY_AGG(m.name ORDER BY m.created_at DESC) FILTER (WHERE m.name IS NOT NULL))[1] AS name,
               BOOL_OR(m.mime <> ALL (${CURRENT_MIMES})) AS legacy
        FROM media_asset m GROUP BY 1
      )
      SELECT COUNT(*)::int AS n FROM f ${filtered}`;
    return row?.n ?? 0;
  }
}
