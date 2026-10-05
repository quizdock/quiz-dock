import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
import { loadSamples, questionCountOf, type SampleBundle } from '../quizzes/samples/samples';
import { type TemplateSteps, templateSteps } from './store-preview';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

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
  /** Chemin de la couverture dans le bundle (`media/…`), pour la vignette. */
  cover?: string | null;
  /**
   * Premier élément du quiz, tel que la galerie l'affiche : c'est ce qu'on voit
   * d'un modèle avant de l'ouvrir, plutôt qu'une tuile vide. Écrit au partage.
   */
  first?: {
    kind: 'question' | 'slide';
    text: string;
    media?: string | null;
    gradient?: { angle: number; colors: string[] } | null;
  } | null;
}

const INDEX = 'index.json';
/** Les exemples sont fournis avec l'application : ils en portent la licence. */
const SAMPLE_LICENSE = 'CC-BY-4.0';
const SAMPLE_SUBJECT = 'system:samples';
/** Les modèles d'usine sont signés par l'auteur du projet, pas par l'instance :
 *  le nom de l'application est configurable (white-label), celui-ci non. */
const SAMPLE_AUTHOR = 'fchaussin';
/** Which sample each seeded template is (`samples.json`): its id (null once withdrawn), its revision. */
const SEEDED = 'samples.json';
type Seeded = Record<string, { id: string | null; revision: number }>;
/** The samples of the releases before `samples.json`, by the title they were seeded under. */
const LEGACY_SAMPLES: [string, string][] = [
  ['discover-france', 'Discover France'],
  ['discover-taiwan', 'Discover Taiwan'],
];

/** Un élément de bundle, tel que l'aperçu a besoin de le lire (lecture tolérante). */
interface BundleItem {
  kind: 'question' | 'slide';
  backgroundImage?: string | null;
  backgroundGradient?: { angle: number; colors: string[] } | null;
  textTone?: 'light' | 'dark';
  textOutline?: boolean;
  prompt?: string;
  type?: string;
  timeLimitS?: number;
  media?: string;
  blocks?: unknown[];
  options?: { text?: string; color?: string; shape?: string; media?: string; alt?: string }[];
}

/**
 * The first slide as the stage draws it: blocks with their media served by the
 * catalogue, background, text tone and outline — the card shows the slide itself.
 */
export interface ServedSlide {
  blocks: unknown[];
  background: { url: string } | { gradient: { angle: number; colors: string[] } } | null;
  textTone: 'light' | 'dark';
  textOutline: boolean;
}

/** Une entrée telle que l'API la rend : les chemins deviennent des URL servies. */
export type ListedEntry = Omit<StoreEntry, 'first'> & {
  coverUrl: string | null;
  first: {
    kind: 'question' | 'slide';
    text: string;
    media: string | null;
    gradient: { angle: number; colors: string[] } | null;
    /** Present when the first item is a slide. */
    slide: ServedSlide | null;
  } | null;
};

/**
 * `item` is the first item read from the bundle, when it could be read: the card
 * is drawn from the folder, not from the summary `index.json` kept at share time.
 */
function served(entry: StoreEntry, item?: BundleItem): ListedEntry {
  const first = item ? firstItemOf([item]) : entry.first;
  return {
    ...entry,
    coverUrl: mediaUrl(entry.id, entry.cover),
    first: first
      ? {
          kind: first.kind,
          text: first.text,
          media: mediaUrl(entry.id, first.media),
          gradient: first.gradient ?? null,
          slide: item?.kind === 'slide' ? servedSlide(entry.id, item) : null,
        }
      : null,
  };
}

function servedSlide(id: string, item: BundleItem): ServedSlide {
  const image = mediaUrl(id, item.backgroundImage);
  return {
    blocks: servedBlocks(id, item.blocks ?? []) as unknown[],
    background: image
      ? { url: image }
      : item.backgroundGradient
        ? { gradient: item.backgroundGradient }
        : null,
    textTone: item.textTone ?? 'light',
    textOutline: item.textOutline ?? true,
  };
}

/** An inline Markdown image in a bundle: `](media/…)`. */
const BUNDLE_MD_MEDIA_RE = /\]\((media\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})\)/g;

/** Slide blocks with their bundle media paths turned into catalogue URLs. */
function servedBlocks(id: string, blocks: unknown): unknown {
  if (Array.isArray(blocks)) return blocks.map((b) => servedBlocks(id, b));
  if (!blocks || typeof blocks !== 'object') return blocks;
  const b = blocks as Record<string, unknown>;
  if (b.type === 'image' && typeof b.media === 'string') {
    const { media, ...rest } = b;
    return { ...rest, mediaId: '', url: mediaUrl(id, media) };
  }
  if (b.type === 'text' && typeof b.md === 'string') {
    return {
      ...b,
      md: b.md.replace(BUNDLE_MD_MEDIA_RE, (_m, path: string) => `](${mediaUrl(id, path)})`),
    };
  }
  if (b.type === 'columns' && Array.isArray(b.columns)) {
    return { ...b, columns: b.columns.map((c) => servedBlocks(id, c)) };
  }
  return b;
}

/** Ce qu'une carte montre d'un modèle : son premier élément, en compact. */
function firstItemOf(items: BundleItem[] | undefined): StoreEntry['first'] {
  const first = (items ?? [])[0];
  if (!first) return null;
  return {
    kind: first.kind,
    text: first.kind === 'question' ? (first.prompt ?? '') : firstText(first.blocks),
    media: (first.kind === 'slide' ? first.backgroundImage : first.media) ?? null,
    gradient: first.backgroundGradient ?? null,
  };
}

/** URL servie d'un média du catalogue, depuis son chemin dans le bundle. */
function mediaUrl(id: string, path?: string | null): string | null {
  return path ? `/api/v1/store/${id}/media/${path.replace(/^media\//, '')}` : null;
}

/** Premier texte d'une diapositive : son titre, à défaut de mieux. */
function firstText(blocks: unknown[] | undefined): string {
  for (const block of blocks ?? []) {
    const b = block as { text?: string; md?: string };
    const text = b.text ?? b.md;
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 200);
  }
  return '';
}

/** L'aperçu d'un modèle : son entrée de catalogue, plus ce qu'en donnerait une copie. */
export type StorePreview = StoreEntry &
  TemplateSteps & {
    coverUrl: string | null;
    slideCount: number;
  };
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
  private readonly dir = settings.path(SETTINGS.STORE_DIR);
  /** The last change of the index, which the next one waits for (see `updateIndex`). */
  private indexWrites: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly portable: QuizPortableService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.log.log(`Template catalogue: ${this.dir}`);
    await this.seedSamples();
  }

  /**
   * The sample quizzes in the catalogue. A fresh catalogue gets every sample; a
   * later release brings the samples it adds, and a new revision of a sample
   * replaces the old one in place (same template, so a copy taken earlier stays
   * linked). A sample the operator withdrew is not brought back. What was seeded
   * is kept in `samples.json`, next to the index.
   */
  private async seedSamples(): Promise<void> {
    // An unreadable index is the operator's to repair: seeding over it would lose it.
    const entries = await this.readIndex().catch(() => null);
    if (entries === null) return;
    const seeded = await this.readSeeded(entries);
    let changed = false;
    for (const sample of loadSamples()) {
      const known = seeded[sample.key];
      const revision = sample.manifest.quiz.revision ?? 1;
      if (known === undefined) {
        const id = ulid();
        await this.writeSample(id, sample);
        await this.updateIndex((current) => [...current, this.sampleEntry(id, sample)]);
        seeded[sample.key] = { id, revision };
        changed = true;
      } else if (known.id && !entries.some((e) => e.id === known.id)) {
        seeded[sample.key] = { id: null, revision: known.revision };
        changed = true;
      } else if (known.id && known.revision < revision) {
        const id = known.id;
        await this.writeSample(id, sample);
        await this.updateIndex((current) =>
          current.map((e) =>
            e.id === id ? { ...this.sampleEntry(id, sample), sharedAt: e.sharedAt } : e,
          ),
        );
        seeded[sample.key] = { id, revision };
        changed = true;
      }
    }
    if (!changed) return;
    await writeFile(join(this.dir, SEEDED), JSON.stringify(seeded, null, 2), 'utf8');
    this.log.log(`Template catalogue: samples ${Object.keys(seeded).join(', ')} up to date`);
  }

  /**
   * What `samples.json` says was seeded. Before it existed, the samples were the
   * entries signed `system:samples`, recognised by title; on such a catalogue a
   * sample it no longer holds was withdrawn by the operator.
   */
  private async readSeeded(entries: StoreEntry[]): Promise<Seeded> {
    const raw = await readFile(join(this.dir, SEEDED), 'utf8').catch(() => null);
    if (raw) return parseOr<Seeded>(raw, {});
    const seeded: Seeded = {};
    if (entries.length === 0) return seeded;
    for (const [key, title] of LEGACY_SAMPLES) {
      const entry = entries.find((e) => e.author?.subject === SAMPLE_SUBJECT && e.title === title);
      seeded[key] = { id: entry?.id ?? null, revision: entry?.revision ?? 1 };
    }
    return seeded;
  }

  /** A sample's bundle, as a template folder: `quiz.json` and its `media/`. */
  private async writeSample(id: string, sample: SampleBundle): Promise<void> {
    const folder = join(this.dir, id);
    await rm(join(folder, 'media'), { recursive: true, force: true });
    await mkdir(join(folder, 'media'), { recursive: true });
    for (const [path, bytes] of Object.entries(sample.files)) {
      await writeFile(join(folder, path), bytes);
    }
    await writeFile(join(folder, MANIFEST), sample.manifestText, 'utf8');
  }

  private sampleEntry(id: string, sample: SampleBundle): StoreEntry {
    const quiz = sample.manifest.quiz;
    return {
      id,
      title: quiz.title,
      description: quiz.description ?? null,
      language: quiz.language ?? 'en',
      tags: [],
      questionCount: questionCountOf(sample),
      license: quiz.license ?? SAMPLE_LICENSE,
      author: { name: SAMPLE_AUTHOR, subject: SAMPLE_SUBJECT },
      revision: quiz.revision ?? 1,
      sharedAt: new Date().toISOString(),
      cover: null,
      first: firstItemOf(sample.manifest.items as BundleItem[]),
    };
  }

  /**
   * A demo catalogue is read-only: the sample templates stay put — they are how a
   * visitor gets something to play when someone else emptied the shared bank.
   */
  private refuseOnDemo(): void {
    if (isDemoMode()) throw new ForbiddenException('store.demo_disabled');
  }

  /** The catalogue, newest first. Reads the folder, which is the only truth. */
  async list(): Promise<ListedEntry[]> {
    const entries = await this.readIndex();
    const sorted = [...entries].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
    return Promise.all(sorted.map(async (e) => served(e, await this.firstOnDisk(e.id))));
  }

  /** The first item of a template's bundle; undefined when the manifest cannot be read. */
  private async firstOnDisk(id: string): Promise<BundleItem | undefined> {
    const raw = await readFile(join(this.dir, id, MANIFEST), 'utf8').catch(() => null);
    if (!raw) return undefined;
    try {
      return (JSON.parse(raw) as { items?: BundleItem[] }).items?.[0];
    } catch {
      return undefined;
    }
  }

  /**
   * Shares a `ready` quiz: a copy of the bundle lands in the catalogue and the
   * publication counter moves. The template keeps the id minted the first time,
   * so withdrawing and sharing again stays the same template for everyone who
   * took a copy.
   */
  async share(
    user: { id: string; displayName: string; oidcSubject: string },
    quizId: string,
  ): Promise<ListedEntry> {
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

    // La couverture est lue dans le bundle qu'on vient d'écrire : la galerie a
    // besoin d'une vignette sans ouvrir chaque modèle.
    const manifest = await readFile(join(folder, MANIFEST), 'utf8').catch(() => null);
    const parsed = manifest
      ? (JSON.parse(manifest) as { quiz?: { cover?: string | null }; items?: BundleItem[] })
      : null;
    const cover = parsed?.quiz?.cover ?? null;
    const first = firstItemOf(parsed?.items);
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
      cover,
      first,
    };
    await this.updateIndex((entries) => [...entries.filter((e) => e.id !== id), entry]);
    this.log.log(`Template shared: ${entry.title} (${id}, revision ${entry.revision})`);
    return served(entry, parsed?.items?.[0]);
  }

  /**
   * Takes a copy: a new **draft** in the taker's bank, with its own media. The
   * copy carries nothing of its origin — no back-reference, no update signal.
   */
  async take(ownerId: string, id: string) {
    const folder = join(this.dir, this.safeId(id));
    const manifest = await readFile(join(folder, MANIFEST)).catch(() => null);
    if (!manifest) throw new NotFoundException('store.entry_not_found');
    // Rebuilt as a zip so the shared importer validates it exactly like an upload.
    const files: Record<string, Uint8Array> = { [MANIFEST]: new Uint8Array(manifest) };
    for (const name of await readdir(join(folder, 'media')).catch(() => [])) {
      files[`media/${name}`] = new Uint8Array(await readFile(join(folder, 'media', name)));
    }
    const zip = Buffer.from(zipSync(files, { level: 6 }));
    // A demo refuses media uploads, but its catalogue holds only the application's own
    // templates (sharing is refused there): their media come with the copy.
    return this.portable.importBundle(
      ownerId,
      { buffer: zip, mimetype: 'application/zip', originalname: `${id}.quizdock.zip` },
      { seeding: isDemoMode() },
    );
  }

  /**
   * Ce qu'un modèle contient, lu depuis son bundle par l'import lui-même : de quoi
   * juger avant d'en prendre une copie, exactement ce que la copie donnera. Les
   * médias gardent des identifiants de remplacement, servis par le catalogue.
   */
  async preview(id: string): Promise<StorePreview> {
    const entry = (await this.readIndex()).find((e) => e.id === id);
    const raw = await readFile(join(this.dir, this.safeId(id), MANIFEST), 'utf8').catch(() => null);
    if (!entry || !raw) throw new NotFoundException('store.entry_not_found');
    // Le catalogue est un dossier : un manifeste retouché à la main ne doit pas
    // faire tomber l'aperçu, il dit alors quel élément la copie refuserait.
    const bundle = parseOr<{ quiz?: { cover?: string | null } }>(raw, {});
    const steps = templateSteps(bundle, id, (path) => mediaUrl(id, path));
    return {
      ...entry,
      coverUrl: mediaUrl(id, bundle.quiz?.cover),
      slideCount: steps.slides.length,
      ...steps,
    };
  }

  /** Un média du catalogue, servi pour l'aperçu (lecture seule, jamais réécrit). */
  async readMedia(id: string, name: string): Promise<Buffer> {
    // Le nom vient de l'URL : il ne doit pas pouvoir remonter hors du dossier.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name)) {
      throw new BadRequestException('store.invalid_id');
    }
    const bytes = await readFile(join(this.dir, this.safeId(id), 'media', name)).catch(() => null);
    if (!bytes) throw new NotFoundException('store.entry_not_found');
    return bytes;
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
    await this.updateIndex((current) => current.filter((e) => e.id !== id));
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
      // A hand-edited or truncated index is refused, never read as empty: the next
      // share would otherwise write an index of one entry over every other.
      this.log.warn(`${INDEX} is unreadable — the catalogue is refused until it is repaired.`);
      throw new ConflictException('store.index_unreadable');
    }
  }

  /**
   * Changes the index: one change at a time in this process (a share and a
   * withdraw at once both stick), written to a temporary file then renamed, so a
   * crash mid-write leaves the previous index, never a truncated one.
   */
  private updateIndex(change: (entries: StoreEntry[]) => StoreEntry[]): Promise<void> {
    const next = this.indexWrites.then(async () => {
      const entries = change(await this.readIndex());
      await mkdir(this.dir, { recursive: true });
      const tmp = join(this.dir, `${INDEX}.${process.pid}.tmp`);
      await writeFile(tmp, JSON.stringify({ entries }, null, 2), 'utf8');
      await rename(tmp, join(this.dir, INDEX));
    });
    // The next change waits for this one, whether it succeeded or not.
    this.indexWrites = next.catch(() => undefined);
    return next;
  }
}

/** A JSON file written by hand: what it holds, or `fallback` when it does not parse. */
function parseOr<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
