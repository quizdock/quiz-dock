import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Quiz, QuizStatus } from '@prisma/client';
import { strToU8, zipSync } from 'fflate';
import { isDemoMode } from '../../demo/demo.config';
import { MediaService } from '../../media/media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizPortableService } from '../portable/quiz-portable.service';
import { loadSamples, type SampleBundle } from './samples';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../../admin/settings/settings.service';

/**
 * Owner of the samples' media in the instance's media: an account nobody signs in
 * to (no role; `system:` is no identity provider's subject). The admin page lists
 * instance media as global whoever owns them.
 */
const SAMPLES_OWNER = { oidcSubject: 'system:samples', displayName: 'QuizDock' };

/** In the media folder once the samples' media were offered to the instance. */
const MARKER = '.samples-media';

/** The file extension's MIME type, as the importer reads a bundle's media. */
const MIME: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  mp3: 'audio/mpeg',
};

/**
 * The shipped sample quizzes (samples.ts) outside the template catalogue: as
 * ready quizzes of one account, and as the instance's media.
 */
@Injectable()
export class SampleQuizzesService implements OnApplicationBootstrap {
  private readonly log = new Logger(SampleQuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly portable: QuizPortableService,
    private readonly media: MediaService,
  ) {}

  /** Creates the sample quizzes for `ownerId` (status `ready`), in folder order. */
  async createFor(ownerId: string): Promise<Quiz[]> {
    const created: Quiz[] = [];
    for (const sample of loadSamples()) {
      const draft = await this.portable.importBundle(
        ownerId,
        { buffer: Buffer.from(zipOf(sample)), mimetype: 'application/zip' },
        { seeding: true },
      );
      created.push(
        await this.prisma.quiz.update({
          where: { id: draft.id },
          data: { status: QuizStatus.ready },
        }),
      );
    }
    return created;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedInstanceMedia().catch((err: unknown) =>
      this.log.warn(`Sample media not added to the instance's media: ${String(err)}`),
    );
  }

  /**
   * A new instance offers the samples' pictures and sounds to every host, among
   * the instance's media — credited, free to reuse. Once: a marker in the media
   * folder remembers it, so an administrator who removed them does not see them
   * come back. An instance whose administrator already curates that library
   * does not get them either.
   */
  private async seedInstanceMedia(): Promise<void> {
    if (isDemoMode()) return;
    const marker = join(settings.path(SETTINGS.MEDIA_DIR), MARKER);
    if (existsSync(marker)) return;
    const curated = (await this.prisma.mediaAsset.count({ where: { instance: true } })) > 0;
    let added = 0;
    const owner = curated
      ? null
      : await this.prisma.user.upsert({
          where: { oidcSubject: SAMPLES_OWNER.oidcSubject },
          create: { ...SAMPLES_OWNER, roles: [] },
          update: {},
        });
    for (const sample of loadSamples()) {
      if (!owner) break;
      for (const [path, buffer] of Object.entries(sample.files)) {
        const mimetype = MIME[path.slice(path.lastIndexOf('.') + 1)];
        if (!mimetype) continue;
        const meta = sample.manifest.media?.[path] ?? {};
        const { mediaId } = await this.media.upload(
          owner.id,
          { buffer, mimetype, size: buffer.length, originalname: path.slice('media/'.length) },
          {
            durationMs: meta.durationMs,
            peaks: meta.peaks ? JSON.stringify(meta.peaks) : undefined,
            origin: meta.origin,
            loudnessLufs: meta.loudnessLufs,
            peakDbfs: meta.peakDbfs,
          },
          { instance: true, seeding: true },
        );
        if (meta.credit) await this.media.setInstanceCredit(mediaId, meta.credit);
        added++;
      }
    }
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, `${new Date().toISOString()}\n`, 'utf8');
    if (added) this.log.log(`Instance media: ${added} sample file(s) added`);
  }
}

/** A sample as the zip an export would give. */
function zipOf(sample: SampleBundle): Uint8Array {
  return zipSync({
    'quiz.json': strToU8(sample.manifestText),
    ...Object.fromEntries(Object.entries(sample.files).map(([p, b]) => [p, new Uint8Array(b)])),
  });
}
