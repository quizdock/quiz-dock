import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  ConflictException,
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
import { mediaDimensions } from './media-dimensions';

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  /** The name the browser gave the file: kept to find the media again (#53). */
  originalname?: string;
}

/** What the editor reads back of one of its media. */
export interface MediaDetails {
  id: string;
  alt: string | null;
  credit: string | null;
  durationMs: number | null;
}

const DETAILS = { id: true, alt: true, credit: true, durationMs: true } as const;

/** Bornes d'un crédit : l'auteur, la licence, la source — une ligne. */
const CREDIT_MAX = 300;
const NAME_MAX = 200;

/**
 * A file name as the author typed it. Multer reads a multipart file name as
 * latin1, so `église-台北.png` arrives as `Ã©glise-å°å.png`: its bytes are
 * read again as UTF-8 — only when they make valid UTF-8, so a name that came
 * right (plain ASCII, or a fixed multer) is left as it is.
 */
export function uploadName(raw: string | undefined): string | null {
  const name = raw?.trim();
  if (!name) return null;
  let decoded = name;
  if ([...name].every((c) => c.charCodeAt(0) <= 0xff) && /[\x80-\xff]/.test(name)) {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('\uFFFD')) decoded = utf8;
  }
  return decoded.slice(0, NAME_MAX);
}

/** The SHA-256 of the original file the editor sends along, when it is one. */
function sourceSha256Of(fields: Record<string, unknown>): string | null {
  const value = fields.sourceSha256;
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** How long an unused media may wait for the form it was uploaded from. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** A stored file is named after the SHA-256 of its bytes. */
const BLOB_FILE = /^[0-9a-f]{64}$/;
/** A write that did not finish (renamed to its blob name once complete), one per upload. */
const PARTIAL_FILE = /^[0-9a-f]{64}\.[0-9a-f-]{36}\.part$/;
/** A file from before files were shared, named after its media id (a ULID). */
const LEGACY_FILE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const sha256Of = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

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
 * (cf. décision self-hosted). A file per content (`media_blob`, named after its
 * SHA-256), shared by every media that carries the same bytes; a media from
 * before that keeps its file under its own id until `adoptLegacyFiles` moves it.
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
    /** Straight into the instance's media (#62): an administrator's upload. */
    options: { instance?: boolean } = {},
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
    // The same bytes uploaded twice — a re-used jingle, an imported copy — share one file.
    const sha256 = sha256Of(file.buffer);
    await this.writeBlobFile(sha256, file.buffer);
    const asset = await this.prisma.$transaction(async (tx) => {
      await tx.mediaBlob.upsert({
        where: { sha256 },
        create: { sha256, mime: sniffed.mime, sizeBytes: BigInt(file.size) },
        update: {},
      });
      const created = await tx.mediaAsset.create({
        data: {
          ownerId,
          url: '', // complété après obtention de l'id
          mime: sniffed.mime,
          sizeBytes: BigInt(file.size),
          kind: sniffed.kind,
          blobSha256: sha256,
          name: uploadName(file.originalname),
          ...(mediaDimensions(file.buffer, sniffed.mime) ?? {}),
          instance: options.instance ?? false,
          sourceSha256: sourceSha256Of(fields),
          ...meta,
        },
      });
      return tx.mediaAsset.update({
        where: { id: created.id },
        data: { url: `/api/v1/media/${created.id}` },
      });
    });
    // A clean-up may have let go of that file between the write and the rows.
    await this.writeBlobFile(sha256, file.buffer);
    return { mediaId: asset.id, url: asset.url, kind: sniffed.kind };
  }

  /** Writes a blob's file unless it is there already; a partial write never takes its name. */
  private async writeBlobFile(sha256: string, buffer: Buffer): Promise<void> {
    const path = join(this.dir, sha256);
    if (await exists(path)) return;
    // Two uploads of the same new file each write their own part; either rename gives the same bytes.
    const partial = `${path}.${randomUUID()}.part`;
    await writeFile(partial, buffer);
    await rename(partial, path);
  }

  /** Where a media's bytes are: its blob, or its own id for a file not adopted yet. */
  private fileOf(asset: Pick<MediaAsset, 'id' | 'blobSha256'>): string {
    return join(this.dir, asset.blobSha256 ?? asset.id);
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
    const stream = createReadStream(this.fileOf(asset), span);
    return {
      stream,
      mime: asset.mime,
      sizeBytes: Number(asset.sizeBytes),
    };
  }

  /** Size of a stored media on disk — the truth a byte range is cut from. */
  async sizeOf(id: string): Promise<number> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, blobSha256: true },
    });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    try {
      return (await stat(this.fileOf(asset))).size;
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
      return { buffer: await readFile(this.fileOf(asset)), mime: asset.mime, asset };
    } catch {
      return null;
    }
  }

  /**
   * Texte alternatif d'un média possédé (#43). Une chaîne vide efface : pour une
   * image décorative, c'est la bonne réponse — un mauvais texte vaut moins que rien.
   */
  async setAlt(ownerId: string, id: string, alt: string): Promise<MediaDetails> {
    await this.owned(ownerId, id);
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { alt: alt.trim().slice(0, ALT_MAX) || null },
      select: DETAILS,
    });
  }

  /**
   * The credit of an owned media (#53): who made it, under which licence, from
   * where. A CC-BY sound or picture asks for one; empty clears it.
   */
  async setCredit(ownerId: string, id: string, credit: string): Promise<MediaDetails> {
    await this.owned(ownerId, id);
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { credit: credit.trim().slice(0, CREDIT_MAX) || null },
      select: DETAILS,
    });
  }

  /** Métadonnées d'un média possédé (l'éditeur relit l'alternative et le crédit saisis). */
  async describe(ownerId: string, id: string): Promise<MediaDetails> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ownerId, instance: false },
      select: DETAILS,
    });
    if (!asset) {
      throw new NotFoundException('media.not_found');
    }
    return asset;
  }

  /**
   * One of the author's media — or one of the instance's (#62) — put to a new
   * use: a new media of theirs on the same file, with its alt text and credit
   * to start from, so changing them here never changes them there. A media of
   * their own from before files were shared has no file to share yet: it is
   * used as it is.
   */
  async reuse(
    ownerId: string,
    id: string,
  ): Promise<{ mediaId: string; url: string; kind: MediaKind }> {
    const source = await this.prisma.mediaAsset.findFirst({
      where: {
        id,
        OR: [
          { ownerId, instance: false },
          { instance: true, blobSha256: { not: null } },
        ],
      },
    });
    if (!source) throw new NotFoundException('media.not_found');
    if (!source.blobSha256) return { mediaId: source.id, url: source.url, kind: source.kind };
    // A global media carries no alt text: it depends on the use, and on the quiz's language.
    return this.copyOf(source, ownerId, { instance: false, keepAlt: !source.instance });
  }

  /**
   * Puts a file among the instance's media (#62): a new media owned by the
   * administrator and marked as the instance's, on the same file — the media it
   * comes from stays its author's. A file already there is not added twice.
   */
  async addToInstance(
    adminId: string,
    id: string,
  ): Promise<{ mediaId: string; url: string; kind: MediaKind }> {
    const source = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('media.not_found');
    if (!source.blobSha256) throw new BadRequestException('media.not_adopted_yet');
    const already = await this.prisma.mediaAsset.findFirst({
      where: { blobSha256: source.blobSha256, instance: true },
    });
    if (already) return { mediaId: already.id, url: already.url, kind: already.kind };
    return this.copyOf(source, adminId, { instance: true, keepAlt: false });
  }

  /** Takes a media out of the instance's (#62); the hosts' own copies stay theirs. */
  async removeFromInstance(id: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, instance: true } });
    if (!asset) throw new NotFoundException('media.not_found');
    await this.deleteAsset(id);
  }

  /**
   * The credit of one of the instance's media, set by an administrator. No alt
   * text: it depends on the use and on the quiz's language, so the host writes
   * it on their own copy (#43).
   */
  async setInstanceCredit(id: string, credit: string): Promise<MediaDetails> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, instance: true } });
    if (!asset) throw new NotFoundException('media.not_found');
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { credit: credit.trim().slice(0, CREDIT_MAX) || null },
      select: DETAILS,
    });
  }

  /** A new media on the same file as `source`, with what it carries. */
  private async copyOf(
    source: MediaAsset,
    ownerId: string,
    { instance, keepAlt }: { instance: boolean; keepAlt: boolean },
  ): Promise<{ mediaId: string; url: string; kind: MediaKind }> {
    const created = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        instance,
        url: '',
        blobSha256: source.blobSha256,
        name: source.name,
        alt: keepAlt ? source.alt : null,
        credit: source.credit,
        mime: source.mime,
        sizeBytes: source.sizeBytes,
        kind: source.kind,
        durationMs: source.durationMs,
        peaks: source.peaks,
        audioOrigin: source.audioOrigin,
        loudnessLufs: source.loudnessLufs,
        peakDbfs: source.peakDbfs,
        width: source.width,
        height: source.height,
        sourceSha256: source.sourceSha256,
      },
    });
    const url = `/api/v1/media/${created.id}`;
    await this.prisma.mediaAsset.update({ where: { id: created.id }, data: { url } });
    return { mediaId: created.id, url, kind: created.kind };
  }

  /** Whether any of these media is played by a session right now. */
  async playing(ids: string[]): Promise<boolean> {
    const live = await this.liveSnapshots();
    return ids.some((id) => live.some((snap) => snap.includes(id)));
  }

  /**
   * Deletes these media whatever uses them — an administrator's decision
   * (moderation): the quiz slots pointing at them are emptied by the database,
   * a text that shows one no longer does; their files go with the last of them.
   */
  async deleteForGood(ids: string[]): Promise<void> {
    for (const id of ids) await this.deleteAsset(id);
  }

  /** Whether a media is held by a quiz, an archived session or a session being played. */
  async inUse(id: string): Promise<boolean> {
    const live = await this.liveSnapshots();
    return live.some((snap) => snap.includes(id)) || (await this.isReferenced(id));
  }

  /** One of the author's own media (the instance's are the administrators' to change). */
  private async owned(ownerId: string, id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ownerId, instance: false },
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
   * kept is caught by the scheduled sweep (MediaJanitor) once nothing holds it
   * any more. Never fails the save that called it.
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
    } catch (err) {
      this.logger.warn(`Media clean-up skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Media of any kind that nothing uses and that were uploaded long enough ago
   * not to be waiting in an open editor: an upload whose form was abandoned, an
   * image taken out of a text, or a media kept earlier because a session was
   * still playing it.
   */
  async sweepOrphans(olderThanMs = ORPHAN_GRACE_MS): Promise<number> {
    const orphans = await this.prisma.mediaAsset.findMany({
      where: {
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
        // The instance's media are kept for the hosts, used or not (#62).
        instance: false,
        coverForQuizzes: { none: {} },
        questionVisuals: { none: {} },
        questionAudios: { none: {} },
        questionBackgrounds: { none: {} },
        slides: { none: {} },
        options: { none: {} },
      },
      select: { id: true },
    });
    if (orphans.length === 0) return 0;
    const live = await this.liveSnapshots();
    let removed = 0;
    for (const { id } of orphans) {
      // The slots are ruled out above; texts, archives and live sessions still need the full check.
      if (live.some((snap) => snap.includes(id)) || (await this.isReferenced(id))) continue;
      await this.deleteAsset(id);
      removed++;
    }
    return removed;
  }

  /**
   * Blobs no media holds, left by a clean-up or an upload that stopped halfway.
   * Same grace period: an upload in flight writes its blob just before its media.
   */
  async sweepUnusedBlobs(olderThanMs = ORPHAN_GRACE_MS): Promise<number> {
    const blobs = await this.prisma.mediaBlob.findMany({
      where: { assets: { none: {} }, createdAt: { lt: new Date(Date.now() - olderThanMs) } },
      select: { sha256: true },
    });
    let removed = 0;
    for (const { sha256 } of blobs) {
      if (await this.releaseBlob(sha256)) removed++;
    }
    return removed;
  }

  /**
   * Reads the size of the images and videos stored before it was kept, from
   * their files, a batch per pass. One whose bytes do not say (or whose file
   * is gone) gets 0 × 0 — unknown — so the next pass moves on.
   */
  async fillDimensions(batch = 100, ownerIds?: string[]): Promise<number> {
    const missing = await this.prisma.mediaAsset.findMany({
      where: {
        kind: { in: ['image', 'video'] },
        width: null,
        ...(ownerIds ? { ownerId: { in: ownerIds } } : {}),
      },
      select: { id: true, blobSha256: true, mime: true },
      orderBy: { createdAt: 'desc' },
      take: batch,
    });
    let filled = 0;
    for (const asset of missing) {
      const bytes = await readFile(this.fileOf(asset)).catch(() => null);
      const size = bytes && mediaDimensions(bytes, asset.mime);
      // A media deleted meanwhile is simply not updated.
      await this.prisma.mediaAsset.updateMany({
        where: { id: asset.id, width: null },
        data: size ?? { width: 0, height: 0 },
      });
      if (size) filled++;
    }
    return filled;
  }

  /**
   * Moves the files of the media uploaded before files were shared under their
   * blob name, merging identical ones. Each step can be interrupted and run
   * again: the blob name is made before the media points at it, and the old
   * name goes last. A media whose file is missing is left as it is; one that
   * fails is tried again on the next pass, without holding up the others.
   */
  async adoptLegacyFiles(): Promise<{ adopted: number; failed: number }> {
    const legacy = await this.prisma.mediaAsset.findMany({
      where: { blobSha256: null },
      select: { id: true, mime: true, sizeBytes: true },
    });
    let adopted = 0;
    let failed = 0;
    for (const asset of legacy) {
      try {
        if (await this.adoptLegacyFile(asset)) adopted++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Media ${asset.id} not moved to shared storage: ${(err as Error).message}`,
        );
      }
    }
    return { adopted, failed };
  }

  private async adoptLegacyFile(
    asset: Pick<MediaAsset, 'id' | 'mime' | 'sizeBytes'>,
  ): Promise<boolean> {
    const old = join(this.dir, asset.id);
    if (!(await exists(old))) return false;
    const sha256 = await sha256OfFile(old);
    await this.linkOrCopy(old, join(this.dir, sha256));
    await this.prisma.$transaction([
      this.prisma.mediaBlob.upsert({
        where: { sha256 },
        create: { sha256, mime: asset.mime, sizeBytes: asset.sizeBytes },
        update: {},
      }),
      this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { blobSha256: sha256 } }),
    ]);
    await unlink(old).catch(() => undefined);
    return true;
  }

  /** A second name for a file; a copy where the volume has no hard links (some network shares). */
  private async linkOrCopy(from: string, to: string): Promise<void> {
    try {
      await link(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
      await copyFile(from, to, constants.COPYFILE_EXCL).catch((copyErr: NodeJS.ErrnoException) => {
        if (copyErr.code !== 'EEXIST') throw copyErr;
      });
    }
  }

  /**
   * Files in the media directory nothing points to, left long enough not to be
   * an upload in flight: the old sounds the audio migration dropped the rows
   * of, a delete whose unlink failed, a write cut short, the old name of an
   * adopted file. Only names this service gives are considered — a blob, a
   * partial write, a media id — anything else an operator put there is left
   * alone. Two mismatches between the database and the volume stop the purge
   * rather than empty the volume: a database with no media at all (an empty
   * database pointed at a full volume), and media from before files were shared
   * whose file is gone (a database restored from before the files were renamed
   * after their SHA-256 — its blobs look stray, and a hard link keeps the old
   * file's date, past any grace period).
   */
  async purgeStrayFiles(olderThanMs = ORPHAN_GRACE_MS): Promise<number> {
    const { files, guard } = await this.strayFiles();
    if (guard === 'empty_database') {
      this.logger.warn(`Files in ${this.dir} but no media in the database: stray files kept`);
    } else if (guard === 'database_older') {
      this.logger.warn(
        `Media without their file (database older than ${this.dir}?): stored files kept`,
      );
    }
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const file of files.filter((f) => f.mtimeMs < cutoff)) {
      await unlink(join(this.dir, file.name)).catch(() => undefined);
      removed++;
    }
    return removed;
  }

  /**
   * The files `purgeStrayFiles` would consider, whatever their age, and what
   * holds the purge back: nothing, an empty database (`empty_database`: nothing
   * listed), or media from before sharing that lost their file
   * (`database_older`: stored files left out).
   */
  async strayFiles(): Promise<{
    files: Array<{ name: string; bytes: number; mtimeMs: number }>;
    guard: 'empty_database' | 'database_older' | null;
  }> {
    let names = (await readdir(this.dir)).filter(
      (n) => BLOB_FILE.test(n) || PARTIAL_FILE.test(n) || LEGACY_FILE.test(n),
    );
    if (names.length === 0) return { files: [], guard: null };
    if ((await this.prisma.mediaAsset.count()) === 0) return { files: [], guard: 'empty_database' };
    let guard: 'database_older' | null = null;
    if ((await this.legacyMediaWithoutFile(names)) > 0) {
      guard = 'database_older';
      names = names.filter((n) => !BLOB_FILE.test(n));
    }
    const [blobs, legacy] = await Promise.all([
      this.prisma.mediaBlob.findMany({
        where: { sha256: { in: names.filter((n) => BLOB_FILE.test(n)) } },
        select: { sha256: true },
      }),
      // A media id names a file only until that media is adopted.
      this.prisma.mediaAsset.findMany({
        where: { id: { in: names.filter((n) => LEGACY_FILE.test(n)) }, blobSha256: null },
        select: { id: true },
      }),
    ]);
    const known = new Set([...blobs.map((b) => b.sha256), ...legacy.map((a) => a.id)]);
    const files = [];
    for (const name of names.filter((n) => !known.has(n))) {
      const info = await stat(join(this.dir, name)).catch(() => null);
      if (info?.isFile()) files.push({ name, bytes: info.size, mtimeMs: info.mtimeMs });
    }
    return { files, guard };
  }

  /** Media not adopted yet whose file under their own id is missing too. */
  private async legacyMediaWithoutFile(names: string[]): Promise<number> {
    const legacy = await this.prisma.mediaAsset.findMany({
      where: { blobSha256: null },
      select: { id: true },
    });
    const present = new Set(names);
    return legacy.filter((a) => !present.has(a.id)).length;
  }

  /**
   * Every place a media id can be used: slots, options, slides, covers, inline
   * Markdown — and the archived sessions, whose frozen questions the results
   * still show.
   */
  private async isReferenced(id: string): Promise<boolean> {
    const direct = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: {
        instance: true,
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
    if (direct.instance) return true; // the instance's: only an administrator removes it
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
        OR EXISTS (SELECT 1 FROM "game_session_log" WHERE "quiz_snapshot"::text LIKE ${pattern})
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

  /** A media row, then its file if no other media shares it. */
  private async deleteAsset(id: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.delete({
      where: { id },
      select: { id: true, blobSha256: true },
    });
    if (asset.blobSha256) await this.releaseBlob(asset.blobSha256);
    else await unlink(this.fileOf(asset)).catch(() => undefined);
  }

  /**
   * Deletes a blob and its file when no media holds it any more. An upload
   * taking that blob at the same moment wins: its media row keeps the blob
   * (the foreign key refuses the delete) or it writes the file again.
   */
  private async releaseBlob(sha256: string): Promise<boolean> {
    try {
      const { count } = await this.prisma.mediaBlob.deleteMany({
        where: { sha256, assets: { none: {} } },
      });
      if (count === 0) return false;
    } catch {
      return false; // a media took it meanwhile
    }
    if (await this.prisma.mediaBlob.findUnique({ where: { sha256 }, select: { sha256: true } })) {
      return false; // taken again: an upload wrote it back
    }
    await unlink(join(this.dir, sha256)).catch(() => undefined);
    return true;
  }

  /** Supprime un média possédé (ligne + fichier). */
  /**
   * Removes an entry of the author's library: every media of theirs on the
   * same file (a reused media is one entry). Refused while any of them is
   * used — deleting it would leave a hole in a quiz or a past session's results.
   */
  async remove(ownerId: string, id: string): Promise<void> {
    const asset = await this.owned(ownerId, id);
    const group = asset.blobSha256
      ? await this.prisma.mediaAsset.findMany({
          where: { ownerId, blobSha256: asset.blobSha256, instance: false },
          select: { id: true },
        })
      : [{ id }];
    for (const { id: member } of group) {
      if (await this.inUse(member)) throw new ConflictException('media.in_use');
    }
    for (const { id: member } of group) await this.deleteAsset(member);
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
