import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { type Quiz, QuizStatus } from '@prisma/client';
import { strFromU8, strToU8, type Zippable, zipSync } from 'fflate';
import { MediaService } from '../../media/media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { questionCreateData, questionMediaIds } from '../../questions/question-data';
import { slideData } from '../../slides/slide-data';
import { archiveLimits, readArchive } from './bundle-archive';
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
import { type BundleMediaMeta, type QuizBundle, quizBundleSchema } from './quiz-bundle.schema';
import { mediaUrl } from '../../media/media.config';

import { kahootSpreadsheet, type KahootImportReport } from './kahoot-spreadsheet';

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
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
};
/** Reverse map; the first extension listed for a mime wins (`jpg` over `jpeg`). */
const EXT_BY_MIME: Record<string, string> = {};
for (const [ext, mime] of Object.entries(MIME_BY_EXT)) EXT_BY_MIME[mime] ??= ext;

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

    // Media go in stored, not deflated: they are compressed already (WebP, MP4, MP3…),
    // and deflating them ran for seconds on the event loop, every live room waiting.
    const files: Zippable = {};
    const pathById = new Map<string, string>();
    const metaByPath: Record<string, BundleMediaMeta> = {};
    for (const mediaId of collectMediaIds(quiz)) {
      const asset = await this.media.readAsset(mediaId);
      if (!asset) continue; // dangling reference: the export simply drops it
      const path = `media/${mediaId}.${EXT_BY_MIME[asset.mime] ?? 'bin'}`;
      pathById.set(mediaId, path);
      files[path] = [new Uint8Array(asset.buffer), { level: 0 }];
      const row = asset.asset;
      metaByPath[path] = {
        alt: row.alt,
        ...(row.credit ? { credit: row.credit } : {}),
        ...(row.name ? { name: row.name } : {}),
        durationMs: row.durationMs ?? undefined,
        peaks: row.kind === 'audio' ? row.peaks : undefined,
        origin: row.audioOrigin ?? undefined,
        loudnessLufs: row.loudnessLufs ?? undefined,
        peakDbfs: row.peakDbfs ?? undefined,
      };
    }
    // A media that could not be read keeps its route: harmless on re-import (rejected as missing).
    const bundle = toBundle(
      quiz,
      (mediaId) => pathById.get(mediaId) ?? mediaUrl(mediaId),
      metaByPath,
    );
    files[MANIFEST] = strToU8(JSON.stringify(bundle, null, 2));
    const zip = Buffer.from(zipSync(files, { level: 6 }));
    return { filename: `${slugOf(quiz)}.quizdock.zip`, zip };
  }

  /** Imports a zip bundle or a bare `quiz.json`, as a new draft of `ownerId`. */
  async importBundle(
    ownerId: string,
    file: BundleFile | undefined,
    /** The application's own bundle (a sample): its media are taken on a demo too. */
    options: { seeding?: boolean } = {},
  ): Promise<Quiz & { importReport?: KahootImportReport }> {
    if (!file) throw new BadRequestException('import.file_missing');
    const kahoot = kahootSpreadsheet(file.buffer, file.originalname);
    const unpacked = kahoot
      ? { manifest: '', files: {} as Record<string, Uint8Array> }
      : this.unpack(file);
    const { files } = unpacked;
    const bundle = kahoot?.bundle ?? this.parseManifest(unpacked.manifest);

    // Media first: everything referenced must be in the zip and of a known type.
    const idByPath = new Map<string, string>();
    const kindByPath = new Map<string, 'image' | 'video' | 'audio'>();
    for (const path of collectMediaPaths(bundle)) {
      const bytes = files[path];
      if (!bytes) throw new BadRequestException({ code: 'import.media_missing', params: { path } });
      const mimetype = MIME_BY_EXT[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
      if (!mimetype) {
        throw new BadRequestException({ code: 'import.media_unsupported', params: { path } });
      }
      const buffer = Buffer.from(bytes);
      const meta = bundle.media?.[path];
      let uploaded;
      try {
        // Checked by content like any upload; a sound brings its measures (version 3).
        uploaded = await this.media.upload(
          ownerId,
          { buffer, mimetype, size: buffer.length, originalname: meta?.name ?? undefined },
          {
            durationMs: meta?.durationMs,
            peaks: meta?.peaks ? JSON.stringify(meta.peaks) : undefined,
            origin: meta?.origin,
            loudnessLufs: meta?.loudnessLufs,
            peakDbfs: meta?.peakDbfs,
          },
          { seeding: options.seeding },
        );
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof PayloadTooLargeException) {
          throw new BadRequestException({ code: 'import.media_unsupported', params: { path } });
        }
        throw err;
      }
      // The alternative text travels with the file (#43, bundle version 2).
      if (meta?.alt) await this.media.setAlt(ownerId, uploaded.mediaId, meta.alt);
      // So does its credit (#53): a CC-BY licence follows the quiz wherever it is shared.
      if (meta?.credit) await this.media.setCredit(ownerId, uploaded.mediaId, meta.credit);
      idByPath.set(path, uploaded.mediaId);
      kindByPath.set(path, uploaded.kind);
    }

    let imported;
    try {
      imported = fromBundle(
        bundle,
        (path) => idByPath.get(path) as string,
        (path) => kindByPath.get(path) ?? 'image',
      );
    } catch (err) {
      if (err instanceof BundleContentError) {
        throw new BadRequestException({
          code: 'import.invalid_item',
          params: { item: err.item + 1, field: err.issues[0]?.field ?? '_' },
        });
      }
      throw err;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          ownerId,
          title: imported.title,
          description: imported.description,
          language: imported.language,
          feedbackEnabled: imported.feedbackEnabled,
          mediaTailS: imported.mediaTailS,
          loudnessTargetLufs: imported.loudnessTargetLufs,
          audioTarget: imported.audioTarget,
          coverMediaId: imported.coverMediaId,
          // A copy carries nothing of its origin (#39), its slug included: the new
          // owner's first export fixes one, or a republished copy would share it (#21).
          slug: null,
          namespace: null,
          // The copy has never been shared: its publication counter starts at zero,
          // and the bundle's number stays what it always was — the origin's (#39).
          revision: 0,
          domain: imported.domain,
          tags: imported.tags,
          license: imported.license,
          status: QuizStatus.draft,
          questionCount: imported.questions.length,
          questions: {
            create: imported.questions.map((dto, orderIndex) =>
              questionCreateData(dto, orderIndex, questionMediaIds(dto)),
            ),
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
            ...slideData(s.content),
          })),
        });
      }
      return quiz;
    });
    return kahoot ? { ...result, importReport: kahoot.report } : result;
  }

  /** A zip (manifest + media) or a bare JSON manifest. */
  private unpack(file: BundleFile): { manifest: string; files: Record<string, Uint8Array> } {
    const isZip = file.buffer.length >= 4 && file.buffer.readUInt32LE(0) === 0x04034b50;
    if (!isZip) return { manifest: file.buffer.toString('utf8'), files: {} };
    // Only the manifest and flat `media/*` entries are kept, each within the upload limit.
    const files = readArchive(
      new Uint8Array(file.buffer),
      (name) => name === MANIFEST || /^media\/[^/]+$/.test(name),
      archiveLimits(this.media.maxUploadBytes),
    );
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
