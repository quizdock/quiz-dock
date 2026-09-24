import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type MediaKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
export interface MediaLibraryLink {
  name: string;
  url: string;
  kinds: MediaKind[];
}

const DEFAULT_LINKS: MediaLibraryLink[] = [
  { name: 'OpenSoundLibrary', url: 'https://opensoundlibrary.com/', kinds: ['audio'] },
  { name: 'Freesound', url: 'https://freesound.org/', kinds: ['audio'] },
  { name: 'Openverse', url: 'https://openverse.org/', kinds: ['image', 'audio'] },
  {
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/',
    kinds: ['image', 'video', 'audio'],
  },
];

const KINDS: MediaKind[] = ['image', 'video', 'audio'];
const LIST_MAX = 300;

/**
 * Where a media is used, as SQL: the quiz `q` refers to the media `m` through a
 * slot, an option, a slide, or as text (a Markdown image, a slide's image block).
 * The same places `MediaService.isReferenced` looks, per quiz.
 */
export const USED_BY_QUIZ = Prisma.sql`(
  q.cover_media_id = m.id
  OR q.description LIKE '%' || m.id || '%'
  OR EXISTS (SELECT 1 FROM question x WHERE x.quiz_id = q.id AND (
       x.visual_media_id = m.id OR x.audio_media_id = m.id OR x.background_media_id = m.id
       OR x.prompt LIKE '%' || m.id || '%' OR x.answer_explanation LIKE '%' || m.id || '%'))
  OR EXISTS (SELECT 1 FROM answer_option o JOIN question x ON x.id = o.question_id
             WHERE x.quiz_id = q.id AND (o.media_id = m.id OR o.text LIKE '%' || m.id || '%'))
  OR EXISTS (SELECT 1 FROM slide s WHERE s.quiz_id = q.id AND (
       s.media_id = m.id OR s.blocks::text LIKE '%' || m.id || '%'))
)`;

/**
 * The author's side of the media library (#53): what they uploaded, to reuse
 * or delete; the credits a quiz owes; and the free libraries to look in.
 */
@Injectable()
export class MediaLibraryService {
  private readonly log = new Logger(MediaLibraryService.name);

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
        SELECT m.file, COUNT(DISTINCT q.id)::int AS n
        FROM mine m JOIN quiz q ON q.owner_id = ${ownerId} AND ${USED_BY_QUIZ}
        GROUP BY m.file
      ),
      latest AS (
        SELECT DISTINCT ON (file) * FROM mine ORDER BY file, created_at DESC
      )
      SELECT l.id, l.url, l.kind, l.name, l.alt, l.credit, l.duration_ms AS "durationMs",
             l.peaks, l.width, l.height, l.size_bytes AS "sizeBytes", l.created_at AS "createdAt",
             COALESCE(u.n, 0) AS "usedIn",
             EXISTS (
               SELECT 1 FROM mine m JOIN game_session_log g
                 ON g.quiz_snapshot::text LIKE '%' || m.id || '%'
               WHERE m.file = l.file
             ) AS "inHistory"
      FROM latest l LEFT JOIN used u ON u.file = l.file
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
    return rows.map((m) => ({
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
    }));
  }

  /**
   * The credits of the media a quiz uses, each once, in no particular order of
   * importance: what the preview page lists and the podium shows (a CC-BY
   * licence asks for an attribution the audience sees).
   */
  /** `creditsOf` for the quiz's owner only: someone else's quiz is not found. */
  async creditsOfOwned(ownerId: string, quizId: string): Promise<string[]> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ownerId },
      select: { id: true },
    });
    if (!quiz) throw new NotFoundException('quiz.not_found');
    return this.creditsOf(quizId);
  }

  async creditsOf(quizId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ credit: string }>>`
      SELECT DISTINCT m.credit
      FROM media_asset m JOIN quiz q ON q.id = ${quizId}
      WHERE m.credit IS NOT NULL AND m.credit <> '' AND ${USED_BY_QUIZ}
      ORDER BY m.credit`;
    return rows.map((r) => r.credit);
  }

  /**
   * The free libraries the editor points to: `MEDIA_LIBRARY_LINKS` as a JSON
   * list of `{ name, url, kinds }`, `none` for an instance without Internet,
   * the defaults otherwise (or when the variable cannot be read).
   */
  links(): MediaLibraryLink[] {
    const raw = process.env.MEDIA_LIBRARY_LINKS?.trim();
    if (!raw) return DEFAULT_LINKS;
    if (raw === 'none') return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not a list');
      return parsed.flatMap((l: Partial<MediaLibraryLink>) =>
        typeof l?.name === 'string' && typeof l.url === 'string' && /^https?:\/\//.test(l.url)
          ? [
              {
                name: l.name,
                url: l.url,
                kinds: Array.isArray(l.kinds) ? l.kinds.filter((k) => KINDS.includes(k)) : KINDS,
              },
            ]
          : [],
      );
    } catch (err) {
      this.log.warn(`MEDIA_LIBRARY_LINKS unreadable (${(err as Error).message}): defaults used`);
      return DEFAULT_LINKS;
    }
  }
}
