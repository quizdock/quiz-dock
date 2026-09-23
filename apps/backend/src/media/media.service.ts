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
import { type MediaRejection, sniffMedia } from '@quiz-dock/contracts';
import { isDemoMode } from '../demo/demo.config';
import { PrismaService } from '../prisma/prisma.service';
import { parseUploadMeta } from './dto/media-upload-meta';
import { mediaLimits, uploadCeiling } from './media.config';

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

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

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.logger.log(`Répertoire des médias : ${this.dir}`);
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

  /** Bytes and mime of a stored media, for the quiz export (#19). */
  async readAsset(
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; alt: string | null } | null> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return null;
    try {
      // `alt` travels with the bytes so a bundle can carry it (#43).
      return { buffer: await readFile(join(this.dir, id)), mime: asset.mime, alt: asset.alt };
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
