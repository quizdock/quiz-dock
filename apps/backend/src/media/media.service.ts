import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { MediaAsset, MediaKind } from '@prisma/client';
import { GameState, type MediaRejection, sniffMedia } from '@quiz-dock/contracts';
import { isDemoMode } from '../demo/demo.config';
import { gameKeys } from '../game/game.keys';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { parseUploadMeta } from './dto/media-upload-meta';
import { mediaLimits, uploadCeiling } from './media.config';

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** How long an unused video or sound may wait for the form it was uploaded from. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Bornes du texte alternatif : une phrase, pas un paragraphe. */
const ALT_MAX = 300;

/** A rejection of the content check, as the error code the clients translate. */
const REJECTION_CODE: Record<MediaRejection, string> = {
  unsupported_type: 'media.unsupported_type',
  quicktime: 'media.quicktime',
  unsupported_video_codec: 'media.unsupported_video_codec',
  unsupported_audio_codec: 'media.unsupported_audio_codec',
  no_video_track: 'media.no_video_track',
  unreadable_mp3: 'media.unreadable_mp3',
};

/**
 * Médias stockés sur un **volume local** (MEDIA_DIR) et servis par le backend
 * (cf. décision self-hosted). Un fichier par `media_asset.id`.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private readonly dir = process.env.MEDIA_DIR ?? join(process.cwd(), '.media');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.logger.log(`Répertoire des médias : ${this.dir}`);
    // Whatever an earlier run left behind (a session that held a media, a crash).
    void this.sweepOrphans().catch((err: Error) =>
      this.logger.warn(`Media sweep skipped: ${err.message}`),
    );
  }

  /**
   * Enregistre un média uploadé (ligne + fichier) et renvoie son URL servie.
   *
   * What the file *is* comes from its bytes (`sniffMedia`), never from its name
   * or the type the browser declared: a raster image, an MP4 with H.264 video
   * and AAC or no audio, or an MP3. The type served later is the one found here.
   * A sound comes with what the editor measured while decoding it (duration,
   * waveform, loudness), which the players use without decoding it again.
   */
  async upload(
    ownerId: string,
    file: UploadFile | undefined,
    fields: Record<string, unknown> = {},
  ): Promise<{ mediaId: string; url: string; kind: MediaKind }> {
    if (isDemoMode()) {
      throw new ForbiddenException('media.demo_disabled');
    }
    if (!file) {
      throw new BadRequestException('media.file_missing');
    }
    const sniffed = sniffMedia(
      new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.size),
    );
    if (!sniffed.ok) {
      throw new BadRequestException(
        sniffed.codec
          ? { code: REJECTION_CODE[sniffed.reason], params: { codec: sniffed.codec } }
          : REJECTION_CODE[sniffed.reason],
      );
    }
    const max = mediaLimits()[sniffed.kind];
    if (file.size > max) {
      throw new PayloadTooLargeException({
        code: 'media.file_too_large',
        params: { max, maxMb: Math.floor(max / (1024 * 1024)) },
      });
    }
    const meta = parseUploadMeta(sniffed.kind, fields);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        url: '', // complété après obtention de l'id
        mime: sniffed.mime,
        sizeBytes: BigInt(file.size),
        kind: sniffed.kind,
        ...meta,
      },
    });
    const url = `/api/v1/media/${asset.id}`;
    try {
      await writeFile(join(this.dir, asset.id), file.buffer);
    } catch (err) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
      throw err;
    }
    await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { url } });
    return { mediaId: asset.id, url, kind: sniffed.kind };
  }

  /**
   * Flux d'un média pour le service HTTP (public — chargé aussi par les joueurs).
   * `span` narrows it to the bytes a `Range` request asked for.
   */
  async openStream(
    id: string,
    span?: { start: number; end: number },
  ): Promise<{ stream: ReadStream; mime: string; sizeBytes: number }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    const path = join(this.dir, id);
    const stream = createReadStream(path, span);
    return {
      stream,
      mime: asset.mime,
      sizeBytes: Number(asset.sizeBytes),
    };
  }

  /** Size of a stored media on disk — the truth a byte range is cut from. */
  async sizeOf(id: string): Promise<number> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id }, select: { id: true } });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    try {
      return (await stat(join(this.dir, id))).size;
    } catch {
      throw new NotFoundException('media.not_found');
    }
  }

  /** Bytes, mime and what else a stored media carries, for the quiz export (#19). */
  async readAsset(id: string): Promise<{ buffer: Buffer; mime: string; asset: MediaAsset } | null> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return null;
    try {
      // The row travels with the bytes: a bundle carries the alt (#43) and a sound's measures.
      return { buffer: await readFile(join(this.dir, id)), mime: asset.mime, asset };
    } catch {
      return null;
    }
  }

  /**
   * Texte alternatif d'un média possédé (#43). Une chaîne vide efface : pour une
   * image décorative, c'est la bonne réponse — un mauvais texte vaut moins que rien.
   */
  async setAlt(
    ownerId: string,
    id: string,
    alt: string,
  ): Promise<{ id: string; alt: string | null }> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, ownerId } });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    const trimmed = alt.trim().slice(0, ALT_MAX);
    const updated = await this.prisma.mediaAsset.update({
      where: { id },
      data: { alt: trimmed || null },
      select: { id: true, alt: true },
    });
    return updated;
  }

  /** Métadonnées d'un média possédé (l'éditeur relit l'alternative saisie). */
  async describe(ownerId: string, id: string): Promise<{ id: string; alt: string | null }> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ownerId },
      select: { id: true, alt: true },
    });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    return asset;
  }

  /**
   * Deletes the media a save left behind (a replaced or removed media, a deleted
   * question or quiz) — row and file — unless something still uses them: a
   * duplicated quiz shares its media, a transferred one may too, and a session
   * being played runs on a frozen snapshot that must keep its files. What is
   * kept is caught by the next sweep once nothing holds it any more. Never
   * fails the save that called it.
   */
  async releaseUnused(ids: (string | null | undefined)[]): Promise<void> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    try {
      if (unique.length > 0) {
        const live = await this.liveSnapshots();
        for (const id of unique) {
          if (live.some((snap) => snap.includes(id)) || (await this.isReferenced(id))) continue;
          await this.deleteAsset(id);
        }
      }
      await this.sweepOrphans();
    } catch (err) {
      this.logger.warn(`Media clean-up skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Videos and sounds that nothing uses and that were uploaded long enough ago
   * not to be waiting in an open editor: an upload whose form was abandoned,
   * or a media kept earlier because a session was still playing it.
   */
  async sweepOrphans(olderThanMs = ORPHAN_GRACE_MS): Promise<number> {
    const orphans = await this.prisma.mediaAsset.findMany({
      where: {
        kind: { in: ['video', 'audio'] },
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
        questionVisuals: { none: {} },
        questionAudios: { none: {} },
      },
      select: { id: true },
    });
    if (orphans.length === 0) return 0;
    const live = await this.liveSnapshots();
    let removed = 0;
    for (const { id } of orphans) {
      // Any upload may be a video or a sound now (a Markdown image button, a background):
      // only the full reference check can tell nothing else holds it.
      if (live.some((snap) => snap.includes(id)) || (await this.isReferenced(id))) continue;
      await this.deleteAsset(id);
      removed++;
    }
    return removed;
  }

  /** Every place a media id can be used: slots, options, slides, covers, inline Markdown. */
  private async isReferenced(id: string): Promise<boolean> {
    const direct = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            coverForQuizzes: true,
            questionVisuals: true,
            questionAudios: true,
            questionBackgrounds: true,
            slides: true,
            options: true,
          },
        },
      },
    });
    if (!direct) return true; // already gone: nothing to delete
    if (Object.values(direct._count).some((n) => n > 0)) return true;
    // Images typed into Markdown or placed in slide blocks point at the id as text.
    const pattern = `%${id}%`;
    const [row] = await this.prisma.$queryRaw<{ used: boolean }[]>`
      SELECT (
        EXISTS (SELECT 1 FROM "slide" WHERE "blocks"::text LIKE ${pattern})
        OR EXISTS (SELECT 1 FROM "quiz" WHERE "description" LIKE ${pattern})
        OR EXISTS (SELECT 1 FROM "question"
                   WHERE "prompt" LIKE ${pattern} OR "answer_explanation" LIKE ${pattern})
        OR EXISTS (SELECT 1 FROM "answer_option" WHERE "text" LIKE ${pattern})
      ) AS used`;
    return row?.used ?? true;
  }

  /**
   * Snapshots of the sessions still being played (they carry the URLs of their
   * media). An ended session keeps its keys until they expire, but plays nothing.
   */
  private async liveSnapshots(): Promise<string[]> {
    const keys = await this.redis.keys(gameKeys.snapshot('*'));
    if (keys.length === 0) return [];
    const pins = keys.map((k) => k.split(':')[1]);
    const states = await Promise.all(
      pins.map((pin) => this.redis.hget(gameKeys.game(pin), 'state')),
    );
    const live = keys.filter((_k, i) => states[i] && states[i] !== GameState.Ended);
    if (live.length === 0) return [];
    return (await this.redis.mget(...live)).filter((v): v is string => typeof v === 'string');
  }

  private async deleteAsset(id: string): Promise<void> {
    await this.prisma.mediaAsset.delete({ where: { id } });
    await unlink(join(this.dir, id)).catch(() => undefined);
  }

  /** Supprime un média possédé (ligne + fichier). */
  async remove(ownerId: string, id: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ownerId },
    });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    await unlink(join(this.dir, id)).catch(() => undefined);
  }

  /** Empties the media directory (demo reset — the rows go with the users). */
  async removeAllFiles(): Promise<void> {
    const names = await readdir(this.dir);
    await Promise.all(names.map((n) => unlink(join(this.dir, n)).catch(() => undefined)));
  }

  /** Largest file any kind may be (bundle import caps each entry with it). */
  get maxUploadBytes(): number {
    return uploadCeiling();
  }

  asset(id: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id } });
  }
}
