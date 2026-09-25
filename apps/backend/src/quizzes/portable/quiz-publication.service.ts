import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type MediaKind, QuizStatus } from '@prisma/client';
import { LANGUAGE_RE, isQuizLicense } from '@quiz-dock/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { collectMediaIds, EXPORT_INCLUDE, slugify } from './quiz-bundle';
import { slugSchema } from './quiz-bundle.schema';
import { QuizPortableService } from './quiz-portable.service';

/**
 * Largest bundle a store accepts, in bytes (`PUBLICATION_MAX_MB`, 20 by default:
 * under GitHub's 25 MB web-upload limit for one file). A store rule, not a
 * format rule: a closed store may set its own.
 */
export function publicationMaxBytes(): number {
  const mb = Number(process.env.PUBLICATION_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024;
}

/** What stops a quiz from being exported for publication, or deserves a look first. */
export type PublicationIssue =
  | { code: 'not_ready'; level: 'block' }
  | { code: 'license'; level: 'block' }
  | { code: 'language'; level: 'block' }
  | { code: 'tags'; level: 'block' }
  | { code: 'too_large'; level: 'block' }
  | { code: 'credit_missing'; level: 'warn'; count: number };

export interface PublicationMedia {
  id: string;
  kind: MediaKind;
  name: string | null;
  sizeBytes: number;
}

export interface PublicationReport {
  /** The slug to confirm: the quiz's own, else derived from its title. */
  slug: string;
  /** Whether the quiz already had a slug (changing it makes a new quiz for a store). */
  slugSet: boolean;
  language: string;
  license: string | null;
  tags: string[];
  /** Sum of the media and a margin for the manifest: what the zip will weigh, give or take. */
  estimatedBytes: number;
  maxBytes: number;
  issues: PublicationIssue[];
  /** The five heaviest media, heaviest first. */
  heaviest: PublicationMedia[];
  /** Media without a credit: the contributor's responsibility, listed as a reminder. */
  uncredited: PublicationMedia[];
}

/** Room for `quiz.json` and the zip structure on top of the media. */
const MANIFEST_MARGIN = 256 * 1024;

/**
 * The export meant for a community store (#21), next to the ordinary export
 * (which stays a neutral backup). It checks, before anything is downloaded,
 * what the store would refuse, so the author finds out here with a clear
 * message rather than from a robot's red cross.
 */
@Injectable()
export class QuizPublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portable: QuizPortableService,
  ) {}

  async report(id: string, ownerId: string): Promise<PublicationReport> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      include: EXPORT_INCLUDE,
    });
    if (!quiz) throw new NotFoundException('quiz.not_found');

    const ids = [...collectMediaIds(quiz)];
    const rows = ids.length
      ? await this.prisma.mediaAsset.findMany({
          where: { id: { in: ids } },
          select: { id: true, kind: true, name: true, credit: true, sizeBytes: true },
        })
      : [];
    const media = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      sizeBytes: Number(row.sizeBytes),
      credited: Boolean(row.credit?.trim()),
    }));
    const estimatedBytes = media.reduce((sum, m) => sum + m.sizeBytes, 0) + MANIFEST_MARGIN;
    const maxBytes = publicationMaxBytes();
    const strip = (m: (typeof media)[number]): PublicationMedia => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      sizeBytes: m.sizeBytes,
    });
    const uncredited = media.filter((m) => !m.credited).map(strip);

    const issues: PublicationIssue[] = [];
    if (quiz.status !== QuizStatus.ready) issues.push({ code: 'not_ready', level: 'block' });
    if (!isQuizLicense(quiz.license)) issues.push({ code: 'license', level: 'block' });
    if (!LANGUAGE_RE.test(quiz.language)) issues.push({ code: 'language', level: 'block' });
    if (quiz.tags.length === 0) issues.push({ code: 'tags', level: 'block' });
    if (estimatedBytes > maxBytes) issues.push({ code: 'too_large', level: 'block' });
    if (uncredited.length) {
      issues.push({ code: 'credit_missing', level: 'warn', count: uncredited.length });
    }

    return {
      slug: quiz.slug ?? (slugify(quiz.title) || 'quiz'),
      slugSet: quiz.slug !== null,
      language: quiz.language,
      license: quiz.license,
      tags: quiz.tags,
      estimatedBytes,
      maxBytes,
      issues,
      heaviest: [...media]
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 5)
        .map(strip),
      uncredited,
    };
  }

  /**
   * The bundle, named `<slug>.quizdock.zip`, once nothing blocks. The confirmed
   * slug becomes the quiz's: it is what a store knows the quiz by.
   */
  async export(
    id: string,
    ownerId: string,
    slug: string,
  ): Promise<{ filename: string; zip: Buffer }> {
    if (!slugSchema.safeParse(slug).success) {
      throw new BadRequestException('publication.slug_invalid');
    }
    const { issues, maxBytes } = await this.report(id, ownerId);
    const blocking = issues.find((issue) => issue.level === 'block');
    if (blocking) throw new BadRequestException(`publication.${blocking.code}`);

    await this.prisma.quiz.update({ where: { id }, data: { slug } });
    const bundle = await this.portable.exportZip(id, ownerId);
    // The estimate leaves room for the manifest; the zip itself has the last word.
    if (bundle.zip.length > maxBytes) throw new BadRequestException('publication.too_large');
    return bundle;
  }
}
