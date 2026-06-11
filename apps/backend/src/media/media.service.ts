import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { type MediaAsset, MediaKind } from '@prisma/client';
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

  private kindFor(mime: string): MediaKind {
    if (mime.startsWith('image/')) return MediaKind.image;
    if (mime.startsWith('audio/')) return MediaKind.audio;
    throw new BadRequestException('Type de média non supporté (image/audio).');
  }

  /** Enregistre un média uploadé (ligne + fichier) et renvoie son URL servie. */
  async upload(
    ownerId: string,
    file: UploadFile | undefined,
  ): Promise<{ mediaId: string; url: string }> {
    if (!file) {
      throw new BadRequestException('Fichier manquant (champ "file").');
    }
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException(`Fichier trop volumineux (max ${this.maxBytes} octets).`);
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

  /** Flux d'un média pour le service HTTP (public — chargé aussi par les joueurs). */
  async openStream(id: string): Promise<{ stream: ReadStream; mime: string; sizeBytes: number }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Média introuvable.');
    }
    const path = join(this.dir, id);
    const stream = createReadStream(path);
    return {
      stream,
      mime: asset.mime,
      sizeBytes: Number(asset.sizeBytes),
    };
  }

  /** Supprime un média possédé (ligne + fichier). */
  async remove(ownerId: string, id: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ownerId },
    });
    if (!asset) {
      throw new NotFoundException('Média introuvable.');
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    await unlink(join(this.dir, id)).catch(() => undefined);
  }

  /** Exposé pour les tests / vérifications. */
  get maxUploadBytes(): number {
    return this.maxBytes;
  }

  asset(id: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id } });
  }
}
