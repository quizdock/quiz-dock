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
import { type MediaAsset, MediaKind } from '@prisma/client';
import { isDemoMode } from '../demo/demo.config';
import { PrismaService } from '../prisma/prisma.service';

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Médias stockés sur un **volume local** (MEDIA_DIR) et servis par le backend
 * (cf. décision self-hosted). Un fichier par `media_asset.id`.
 */
/** Bornes du texte alternatif : une phrase, pas un paragraphe. */
const ALT_MAX = 300;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private readonly dir = process.env.MEDIA_DIR ?? join(process.cwd(), '.media');
  private readonly maxBytes = Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 * 1024);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.logger.log(`Répertoire des médias : ${this.dir}`);
  }

  /**
   * Images only, for now (#42). Audio was accepted and stored, but no screen has
   * ever played it: a file could be attached to a question and simply vanish from
   * the game. Refusing it at the door is the honest state of things until the
   * question of *where* a sound plays — one source in a room, every device when
   * people are remote — gets a real answer. The `audio` kind stays in the schema:
   * the rows that exist are not rewritten.
   */
  private kindFor(mime: string): MediaKind {
    if (mime.startsWith('image/')) return MediaKind.image;
    throw new BadRequestException('media.unsupported_type');
  }

  /** Enregistre un média uploadé (ligne + fichier) et renvoie son URL servie. */
  async upload(
    ownerId: string,
    file: UploadFile | undefined,
  ): Promise<{ mediaId: string; url: string }> {
    if (isDemoMode()) {
      throw new ForbiddenException('media.demo_disabled');
    }
    if (!file) {
      throw new BadRequestException('media.file_missing');
    }
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException({
        code: 'media.file_too_large',
        params: { max: this.maxBytes },
      });
    }
    const kind = this.kindFor(file.mimetype);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        url: '', // complété après obtention de l'id
        mime: file.mimetype,
        sizeBytes: BigInt(file.size),
        kind,
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
    return { mediaId: asset.id, url };
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

  /** Exposé pour les tests / vérifications. */
  get maxUploadBytes(): number {
    return this.maxBytes;
  }

  asset(id: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id } });
  }
}
