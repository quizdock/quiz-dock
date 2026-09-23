import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { QuizStatus } from '@prisma/client';
import { ulid } from 'ulid';
import { unzipSync, zipSync } from 'fflate';
import { isDemoMode } from '../demo/demo.config';
import { isManager, type RoleSet } from '../auth/roles';
import { PrismaService } from '../prisma/prisma.service';
import { QuizPortableService } from '../quizzes/portable/quiz-portable.service';

/** One entry of the catalogue, as `index.json` holds it. */
export interface StoreEntry {
  /** ULID of the template — names the entry and its folder. */
  id: string;
  title: string;
  description: string | null;
  language: string;
  tags: string[];
  questionCount: number;
  license: string | null;
  author: { name: string; subject: string };
  revision: number;
  sharedAt: string;
}

const INDEX = 'index.json';
const MANIFEST = 'quiz.json';

/**
 * The **catalogue of shared templates** (#39, RG-17): hosts put a copy of a quiz
 * in it, other hosts take a copy out. A folder on a volume of its own
 * (`STORE_DIR`), in the bundle format — `index.json` plus one directory per
 * template, named by its ULID because a slug cannot be arbitrated with no
 * registry to ask, which an offline instance never has.
 *
 * Nothing here touches the network: an instance with no egress shares and takes
 * normally. A public store (#21) would be one more source, never a required one.
 *
 * The folder **is** the state of sharing — no table mirrors it, so restoring the
 * volume or removing an entry by hand needs no reconciliation.
 */
@Injectable()
export class StoreService implements OnModuleInit {
  private readonly log = new Logger(StoreService.name);
  private readonly dir = process.env.STORE_DIR ?? join(process.cwd(), '.store');

  constructor(
    private readonly prisma: PrismaService,
    private readonly portable: QuizPortableService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (isDemoMode()) return; // no catalogue on a demo instance (single host, wiped hourly)
    await mkdir(this.dir, { recursive: true });
    this.log.log(`Template catalogue: ${this.dir}`);
  }

  /** Refuses everything on a demo instance: one host at a time, nobody to share with. */
  private refuseOnDemo(): void {
    if (isDemoMode()) throw new ForbiddenException('store.demo_disabled');
  }

  /** The catalogue, newest first. Reads the folder, which is the only truth. */
  async list(): Promise<StoreEntry[]> {
    if (isDemoMode()) return [];
    const entries = await this.readIndex();
    return [...entries].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  }

  /**
   * Shares a `ready` quiz: a copy of the bundle lands in the catalogue and the
   * publication counter moves. The template keeps the id minted the first time,
   * so withdrawing and sharing again stays the same template for everyone who
   * took a copy.
   */
  async share(user: { id: string; displayName: string; oidcSubject: string }, quizId: string) {
    this.refuseOnDemo();
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ownerId: user.id },
      select: {
        id: true,
        title: true,
        description: true,
        language: true,
        tags: true,
        license: true,
        status: true,
        questionCount: true,
        publicationId: true,
      },
    });
    if (!quiz) throw new NotFoundException('quiz.not_found');
    if (quiz.status !== QuizStatus.ready) throw new BadRequestException('store.not_ready');
    // A template is meant to be reused, so the terms travel with it.
    if (!quiz.license) throw new BadRequestException('store.license_required');

    const id = quiz.publicationId ?? ulid();
    const stamped = await this.prisma.quiz.update({
      where: { id: quiz.id },
      data: { publicationId: id, revision: { increment: 1 } },
      select: { revision: true },
    });

    // The catalogue holds exactly what an export produces, unzipped.
    const { zip } = await this.portable.exportZip(quiz.id, user.id);
    const folder = join(this.dir, id);
    await rm(folder, { recursive: true, force: true });
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(zip)))) {
      const target = join(folder, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, bytes);
    }

    const entry: StoreEntry = {
      id,
      title: quiz.title,
      description: quiz.description,
      language: quiz.language,
      tags: quiz.tags,
      questionCount: quiz.questionCount,
      license: quiz.license,
      author: { name: user.displayName, subject: user.oidcSubject },
      revision: stamped.revision,
      sharedAt: new Date().toISOString(),
    };
    await this.writeIndex([...(await this.readIndex()).filter((e) => e.id !== id), entry]);
    this.log.log(`Template shared: ${entry.title} (${id}, revision ${entry.revision})`);
    return entry;
  }

  /**
   * Takes a copy: a new **draft** in the taker's bank, with its own media. The
   * copy carries nothing of its origin — no back-reference, no update signal.
   */
  async take(ownerId: string, id: string) {
    this.refuseOnDemo();
    const folder = join(this.dir, this.safeId(id));
    const manifest = await readFile(join(folder, MANIFEST)).catch(() => null);
    if (!manifest) throw new NotFoundException('store.entry_not_found');
    // Rebuilt as a zip so the shared importer validates it exactly like an upload.
    const files: Record<string, Uint8Array> = { [MANIFEST]: new Uint8Array(manifest) };
    for (const name of await readdir(join(folder, 'media')).catch(() => [])) {
      files[`media/${name}`] = new Uint8Array(await readFile(join(folder, 'media', name)));
    }
    const zip = Buffer.from(zipSync(files, { level: 6 }));
    return this.portable.importBundle(ownerId, {
      buffer: zip,
      mimetype: 'application/zip',
      originalname: `${id}.quizdock.zip`,
    });
  }

  /**
   * Withdraws an entry: its author, or an `admin` for any of them (RG-14). The
   * copies people already took are never touched — they are theirs.
   */
  async withdraw(user: { id: string; oidcSubject: string; roles: RoleSet }, id: string) {
    this.refuseOnDemo();
    const entries = await this.readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new NotFoundException('store.entry_not_found');
    const isAuthor = entry.author.subject === user.oidcSubject;
    if (!isAuthor && !isManager(user.roles)) {
      throw new ForbiddenException('store.not_yours');
    }
    await rm(join(this.dir, this.safeId(id)), { recursive: true, force: true });
    await this.writeIndex(entries.filter((e) => e.id !== id));
    this.log.log(`Template withdrawn: ${entry.title} (${id})`);
  }

  /** An id names a folder: it must be a ULID and nothing else. */
  private safeId(id: string): string {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw new BadRequestException('store.invalid_id');
    return id;
  }

  private async readIndex(): Promise<StoreEntry[]> {
    const raw = await readFile(join(this.dir, INDEX), 'utf8').catch(() => null);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { entries?: StoreEntry[] };
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      // A hand-edited or truncated index must not take the catalogue down.
      this.log.warn(`${INDEX} is unreadable — the catalogue reads as empty.`);
      throw new ConflictException('store.index_unreadable');
    }
  }

  private async writeIndex(entries: StoreEntry[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, INDEX), JSON.stringify({ entries }, null, 2), 'utf8');
  }
}
