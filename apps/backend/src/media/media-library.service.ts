import { Injectable, NotFoundException } from '@nestjs/common';
import { type MediaAsset, type MediaKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readableBy } from '../quizzes/quiz-access';
import { ARCHIVED_MEDIA_REFS, QUIZ_MEDIA_REFS } from './media-usage.sql';
import { type MediaLibraryLink, SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

/** One entry of an author's library: a file, whatever number of their media use it. */
export interface MediaLibraryItem {
  /** The most recent of the author's media on that file: what the editor shows and reuses. */
  id: string;
  url: string;
  kind: MediaKind;
  name: string | null;
  alt: string | null;
  credit: string | null;
  durationMs: number | null;
  peaks: number[];
  /** Displayed size of an image or a video; 0 × 0 when unknown, null not read yet. */
  width: number | null;
  height: number | null;
  sizeBytes: number;
  createdAt: string;
  /** How many of the author's quizzes use it. */
  usedIn: number;
  /** Shown in a past session's results: kept, even once no quiz uses it. */
  inHistory: boolean;
}

/** A free media library an author can look in, for the kinds it offers. */
const KINDS: MediaKind[] = ['image', 'video', 'audio'];
const LIST_MAX = 300;

/**
 * The author's side of the media library (#53): what they uploaded, to reuse
 * or delete; the credits a quiz owes; and the free libraries to look in.
 */
@Injectable()
export class MediaLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The author's media, one entry per file (a media reused is not listed twice),
   * newest first, narrowed to a kind and to a search on name, alt text and credit.
   */
  async list(
    ownerId: string,
    filter: { kind?: MediaKind; q?: string } = {},
  ): Promise<MediaLibraryItem[]> {
    const kind = filter.kind && KINDS.includes(filter.kind) ? filter.kind : null;
    const q = filter.q?.trim() ? `%${filter.q.trim().replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = await this.prisma.$queryRaw<
      Array<
        Omit<MediaLibraryItem, 'sizeBytes' | 'createdAt'> & { sizeBytes: bigint; createdAt: Date }
      >
    >`
      WITH mine AS (
        SELECT m.*, COALESCE(m.blob_sha256, m.id) AS file
        FROM media_asset m
        WHERE m.owner_id = ${ownerId} AND NOT m.instance
          ${kind ? Prisma.sql`AND m.kind = ${kind}::media_kind` : Prisma.empty}
      ),
      used AS (
        SELECT m.file, COUNT(DISTINCT r.quiz_id)::int AS n
        FROM mine m JOIN (${QUIZ_MEDIA_REFS}) r ON r.media_id = m.id
             JOIN quiz q ON q.id = r.quiz_id AND q.owner_id = ${ownerId}
        GROUP BY m.file
      ),
      shown AS (
        SELECT DISTINCT m.file FROM mine m JOIN (${ARCHIVED_MEDIA_REFS}) a ON a.media_id = m.id
      ),
      latest AS (
        SELECT DISTINCT ON (file) * FROM mine ORDER BY file, created_at DESC
      )
      SELECT l.id, l.url, l.kind, l.name, l.alt, l.credit, l.duration_ms AS "durationMs",
             l.peaks, l.width, l.height, l.size_bytes AS "sizeBytes", l.created_at AS "createdAt",
             COALESCE(u.n, 0) AS "usedIn", s.file IS NOT NULL AS "inHistory"
      FROM latest l LEFT JOIN used u ON u.file = l.file LEFT JOIN shown s ON s.file = l.file
      ${
        q
          ? Prisma.sql`WHERE l.name ILIKE ${q} OR l.alt ILIKE ${q} OR l.credit ILIKE ${q}`
          : Prisma.empty
      }
      ORDER BY l.created_at DESC
      LIMIT ${LIST_MAX}`;
    return rows.map((r) => ({
      ...r,
      sizeBytes: Number(r.sizeBytes),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * The instance's media (#62), for every host to reuse: newest first, narrowed
   * to a kind and to a search on name, alt text and credit.
   */
  async instanceMedia(filter: { kind?: MediaKind; q?: string } = {}): Promise<MediaLibraryItem[]> {
    const kind = filter.kind && KINDS.includes(filter.kind) ? filter.kind : null;
    const q = filter.q?.trim() || null;
    const rows = await this.prisma.mediaAsset.findMany({
      where: {
        instance: true,
        ...(kind ? { kind } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { alt: { contains: q, mode: 'insensitive' as const } },
                { credit: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX,
    });
    return rows.map(toItem);
  }

  /**
   * A media the author can reuse instead of uploading the same original again
   * (#62 follow-up): one of theirs, or one of the instance's, made from the file
   * whose SHA-256 the editor computed before converting it. Never another
   * author's: knowing a file's hash must not hand over their media.
   */
  async fromSource(
    ownerId: string,
    sourceSha256: string,
    kind?: MediaKind,
  ): Promise<MediaLibraryItem | null> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        sourceSha256,
        // A film in the sound slot keeps its sound only: the same original, another media.
        ...(kind && KINDS.includes(kind) ? { kind } : {}),
        blobSha256: { not: null },
        OR: [{ ownerId, instance: false }, { instance: true }],
      },
      // The author's own first (their alt text comes with it), the newest.
      orderBy: [{ instance: 'asc' }, { createdAt: 'desc' }],
    });
    return media ? toItem(media) : null;
  }

  /**
   * `creditsOf` for a quiz the caller reads: theirs, or one another host shares with
   * the instance (its preview owes the same attributions); any other is not found.
   */
  async creditsOfOwned(ownerId: string, quizId: string): Promise<string[]> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ...readableBy(ownerId) },
      select: { id: true },
    });
    if (!quiz) throw new NotFoundException('quiz.not_found');
    return this.creditsOf(quizId);
  }

  /**
   * The credits of the media a quiz uses, each once, in no particular order of
   * importance: what the preview page lists and the podium shows (a CC-BY
   * licence asks for an attribution the audience sees).
   */
  async creditsOf(quizId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ credit: string }>>`
      SELECT DISTINCT m.credit
      FROM (${QUIZ_MEDIA_REFS}) r JOIN media_asset m ON m.id = r.media_id
      WHERE r.quiz_id = ${quizId} AND m.credit IS NOT NULL AND m.credit <> ''
      ORDER BY m.credit`;
    return rows.map((r) => r.credit);
  }

  /**
   * The free libraries the editor points to: `MEDIA_LIBRARY_LINKS` as a JSON
   * list of `{ name, url, kinds }`, `none` for an instance without Internet,
   * the defaults otherwise (or when the variable cannot be read).
   */
  links(): MediaLibraryLink[] {
    return settings.get(SETTINGS.MEDIA_LIBRARY_LINKS);
  }
}

/** A media row as the library lists it (no usage counted: a single media, not a file). */
function toItem(m: MediaAsset): MediaLibraryItem {
  return {
    id: m.id,
    url: m.url,
    kind: m.kind,
    name: m.name,
    alt: m.alt,
    credit: m.credit,
    durationMs: m.durationMs,
    peaks: m.peaks,
    width: m.width,
    height: m.height,
    sizeBytes: Number(m.sizeBytes),
    createdAt: m.createdAt.toISOString(),
    usedIn: 0,
    inHistory: false,
  };
}
