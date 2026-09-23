import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Quiz, QuizStatus } from '@prisma/client';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MediaService } from '../../media/media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeAnswer } from '../../questions/dto/question-content.schema';
import {
  BundleContentError,
  collectMediaIds,
  collectMediaPaths,
  EXPORT_INCLUDE,
  fromBundle,
  slugify,
  slugOf,
  toBundle,
} from './quiz-bundle';
import { type QuizBundle, quizBundleSchema } from './quiz-bundle.schema';

export { slugify };

const MANIFEST = 'quiz.json';

/** Media types a bundle may carry, by file extension (the zip has no mime). */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  // Audio is not accepted for now (#42): a bundle carrying a sound file is
  // refused as a whole, naming it, rather than importing a quiz whose media
  // would never be heard.
};
/** Reverse map; the first extension listed for a mime wins (`jpg` over `jpeg`). */
const EXT_BY_MIME: Record<string, string> = {};
for (const [ext, mime] of Object.entries(MIME_BY_EXT)) EXT_BY_MIME[mime] ??= ext;
// Sound files stored before audio was suspended still leave under their own name,
// so a backup keeps meaningful files; only the way back in is closed (#42).
Object.assign(EXT_BY_MIME, {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
});

export interface BundleFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/**
 * Quiz import / export (#19) as a portable bundle: `quiz.json` + `media/`,
 * zipped. Importing always creates a new draft owned by the caller, with its
 * own copies of the media — nothing is merged or overwritten.
 */
@Injectable()
export class QuizPortableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /**
   * Zips a quiz, scoped to `ownerId` from the API (any quiz when omitted: the
   * operator CLI). An export fixes the `slug` (derived from the title the first
   * time) so the bundle and the row agree, and the filename mirrors it. It does
   * **not** move `revision`: that counter belongs to sharing (#39), and a backup
   * export must not announce a new version of a template.
   */
  async exportZip(id: string, ownerId?: string): Promise<{ filename: string; zip: Buffer }> {
    const found = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      include: EXPORT_INCLUDE,
    });
    if (!found) throw new NotFoundException('quiz.not_found');
    const stamped = await this.prisma.quiz.update({
      where: { id: found.id },
      data: { slug: slugOf(found) },
      select: { slug: true, revision: true, updatedAt: true },
    });
    const quiz = { ...found, ...stamped };

    const files: Record<string, Uint8Array> = {};
    const pathById = new Map<string, string>();
    const altByPath: Record<string, string | null> = {};
    for (const mediaId of collectMediaIds(quiz)) {
      const asset = await this.media.readAsset(mediaId);
      if (!asset) continue; // dangling reference: the export simply drops it
      const path = `media/${mediaId}.${EXT_BY_MIME[asset.mime] ?? 'bin'}`;
      pathById.set(mediaId, path);
      files[path] = new Uint8Array(asset.buffer);
      altByPath[path] = asset.alt;
    }
    // A media that could not be read keeps its route: harmless on re-import (rejected as missing).
    const bundle = toBundle(
      quiz,
      (mediaId) => pathById.get(mediaId) ?? `/api/v1/media/${mediaId}`,
      altByPath,
    );
    files[MANIFEST] = strToU8(JSON.stringify(bundle, null, 2));
    const zip = Buffer.from(zipSync(files, { level: 6 }));
    return { filename: `${slugOf(quiz)}.quizdock.zip`, zip };
  }

  /** Imports a zip bundle or a bare `quiz.json`, as a new draft of `ownerId`. */
  async importBundle(ownerId: string, file: BundleFile | undefined): Promise<Quiz> {
    if (!file) throw new BadRequestException('import.file_missing');
    const { manifest, files } = this.unpack(file);
    const bundle = this.parseManifest(manifest);

    // Media first: everything referenced must be in the zip and of a known type.
    const idByPath = new Map<string, string>();
    for (const path of collectMediaPaths(bundle)) {
      const bytes = files[path];
      if (!bytes) throw new BadRequestException({ code: 'import.media_missing', params: { path } });
      const mimetype = MIME_BY_EXT[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
      if (!mimetype) {
        throw new BadRequestException({ code: 'import.media_unsupported', params: { path } });
      }
      const buffer = Buffer.from(bytes);
      const { mediaId } = await this.media.upload(ownerId, {
        buffer,
        mimetype,
        size: buffer.length,
      });
      // The alternative text travels with the file (#43, bundle version 2).
      const alt = bundle.media?.[path]?.alt;
      if (alt) await this.media.setAlt(ownerId, mediaId, alt);
      idByPath.set(path, mediaId);
    }

    let imported;
    try {
      imported = fromBundle(bundle, (path) => idByPath.get(path) as string);
    } catch (err) {
      if (err instanceof BundleContentError) {
        throw new BadRequestException({
          code: 'import.invalid_item',
          params: { item: err.item + 1, field: err.issues[0]?.field ?? '_' },
        });
      }
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          ownerId,
          title: imported.title,
          description: imported.description,
          language: imported.language,
          feedbackEnabled: imported.feedbackEnabled,
          coverMediaId: imported.coverMediaId,
          slug: imported.slug,
          namespace: imported.namespace,
          // The copy has never been shared: its publication counter starts at zero,
          // and the bundle's number stays what it always was — the origin's (#39).
          revision: 0,
          domain: imported.domain,
          tags: imported.tags,
          license: imported.license,
          status: QuizStatus.draft,
          questionCount: imported.questions.length,
          questions: {
            create: imported.questions.map((dto, orderIndex) => {
              const isNumeric = dto.type === 'numeric';
              return {
                orderIndex,
                type: dto.type,
                prompt: dto.prompt,
                visualMediaId:
                  dto.media?.visual && 'assetId' in dto.media.visual
                    ? dto.media.visual.assetId
                    : null,
                audioMediaId: dto.media?.audio?.assetId ?? null,
                answerExplanation: dto.answerExplanation || null,
                backgroundMediaId: dto.backgroundMediaId || null,
                backgroundGradient: dto.backgroundGradient ?? Prisma.JsonNull,
                textTone: dto.textTone,
                textOutline: dto.textOutline,
                timeLimitS: dto.timeLimitS,
                revealDelayS: dto.revealDelayS ?? null,
                pointsMode: dto.type === 'poll' ? 'none' : dto.pointsMode,
                scoring: dto.scoring,
                numericValue: isNumeric ? dto.numericValue : null,
                numericTolerance: isNumeric ? dto.numericTolerance : null,
                options: {
                  create: dto.options.map((o, i) => ({
                    orderIndex: i,
                    text: o.text,
                    mediaId: o.mediaId,
                    color: o.color,
                    shape: o.shape,
                    isCorrect: o.isCorrect,
                    correctOrderIndex: o.correctOrderIndex,
                  })),
                },
                acceptedAnswers: {
                  create: dto.acceptedAnswers.map((a) => ({
                    text: a.text,
                    normalized: normalizeAnswer(a.text),
                  })),
                },
              };
            }),
          },
        },
        include: { questions: { select: { id: true, orderIndex: true } } },
      });
      if (imported.slides.length > 0) {
        const idByIndex = new Map(quiz.questions.map((q) => [q.orderIndex, q.id]));
        await tx.slide.createMany({
          data: imported.slides.map((s) => ({
            quizId: quiz.id,
            beforeQuestionId:
              s.beforeQuestion === null ? null : (idByIndex.get(s.beforeQuestion) ?? null),
            orderIndex: s.orderIndex,
            blocks: s.content.blocks as Prisma.InputJsonValue,
            mediaId: s.content.mediaId || null,
            gradient: s.content.gradient ?? Prisma.JsonNull,
            displayDelayS: s.content.displayDelayS ?? null,
            textTone: s.content.textTone,
            textOutline: s.content.textOutline,
          })),
        });
      }
      return quiz;
    });
  }

  /** A zip (manifest + media) or a bare JSON manifest. */
  private unpack(file: BundleFile): { manifest: string; files: Record<string, Uint8Array> } {
    const isZip = file.buffer.length >= 4 && file.buffer.readUInt32LE(0) === 0x04034b50;
    if (!isZip) return { manifest: file.buffer.toString('utf8'), files: {} };
    let files: Record<string, Uint8Array>;
    try {
      // Only the manifest and flat `media/*` entries are inflated, each capped at the upload limit.
      files = unzipSync(new Uint8Array(file.buffer), {
        filter: (f) =>
          (f.name === MANIFEST || /^media\/[^/]+$/.test(f.name)) &&
          f.originalSize <= this.media.maxUploadBytes,
      });
    } catch {
      throw new BadRequestException('import.invalid_bundle');
    }
    const manifest = files[MANIFEST];
    if (!manifest) throw new BadRequestException('import.invalid_bundle');
    return { manifest: strFromU8(manifest), files };
  }

  private parseManifest(text: string): QuizBundle {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BadRequestException('import.invalid_bundle');
    }
    const parsed = quizBundleSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException({
        code: 'import.invalid_bundle',
        params: { field: issue?.path.join('.') || '_' },
      });
    }
    return parsed.data;
  }
}
