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
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '../quizzes/portable/quiz-bundle.schema';
import { QuizPortableService } from '../quizzes/portable/quiz-portable.service';
import { SAMPLE_QUIZZES, type SampleQuiz } from '../quizzes/samples/sample-quizzes.data';

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

/**
 * Bundle d'un quiz d'exemple, construit depuis sa définition : aucun compte
 * n'est propriétaire d'un modèle du catalogue, il n'y a donc rien en base.
 */
function sampleBundle(sample: SampleQuiz): unknown {
  const items: unknown[] = [
    {
      kind: 'slide',
      blocks: sample.intro.blocks,
      backgroundGradient: sample.intro.gradient ?? null,
      textTone: sample.intro.textTone,
      textOutline: sample.intro.textOutline,
    },
    ...sample.questions.map((q) => ({
      kind: 'question',
      type: q.type,
      prompt: q.prompt,
      answerExplanation: q.answerExplanation ?? null,
      timeLimitS: q.timeLimitS,
      revealDelayS: q.revealDelayS ?? null,
      pointsMode: q.pointsMode,
      scoring: q.scoring,
      numericValue: q.numericValue ?? undefined,
      numericTolerance: q.numericTolerance ?? undefined,
      options: q.options?.map((o) => ({
        text: o.text,
        color: o.color,
        shape: o.shape,
        isCorrect: o.isCorrect ?? false,
        correctOrderIndex: o.correctOrderIndex ?? undefined,
      })),
      // Le bundle porte des chaînes ; le schéma d'API des objets `{ text }`.
      acceptedAnswers: q.acceptedAnswers?.map((a) => a.text),
    })),
  ];
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    quiz: {
      title: sample.title,
      description: sample.description,
      language: sample.language,
      license: SAMPLE_LICENSE,
      revision: 1,
      feedbackEnabled: true,
      cover: null,
    },
    items,
  };
}

/** Un élément de bundle, tel que l'aperçu a besoin de le lire (lecture tolérante). */
interface BundleItem {
  kind: 'question' | 'slide';
  backgroundGradient?: { angle: number; colors: string[] } | null;
  prompt?: string;
  type?: string;
  timeLimitS?: number;
  media?: string;
  blocks?: unknown[];
  options?: { text?: string; color?: string; shape?: string }[];
}

/** Une entrée telle que l'API la rend : les chemins deviennent des URL servies. */
export type ListedEntry = Omit<StoreEntry, 'first'> & {
  coverUrl: string | null;
  first: {
    kind: 'question' | 'slide';
    text: string;
    media: string | null;
    gradient: { angle: number; colors: string[] } | null;
  } | null;
};

function served(entry: StoreEntry): ListedEntry {
  return {
    ...entry,
    coverUrl: mediaUrl(entry.id, entry.cover),
    first: entry.first
      ? {
          kind: entry.first.kind,
          text: entry.first.text,
          media: mediaUrl(entry.id, entry.first.media),
          gradient: entry.first.gradient ?? null,
        }
      : null,
  };
}

/** Ce qu'une carte montre d'un modèle : son premier élément, en compact. */
function firstItemOf(items: BundleItem[] | undefined): StoreEntry['first'] {
  const first = (items ?? [])[0];
  if (!first) return null;
  return {
    kind: first.kind,
    text: first.kind === 'question' ? (first.prompt ?? '') : firstText(first.blocks),
    media: first.media ?? null,
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

/** L'aperçu d'un modèle : son entrée de catalogue, plus ce qu'il contient. */
export type StorePreview = StoreEntry & {
  coverUrl: string | null;
  slideCount: number;
  items: {
    kind: 'question' | 'slide';
    text: string;
    type: string | null;
    timeLimitS: number | null;
    mediaUrl: string | null;
    mediaAlt: string | null;
    options: { text: string; color: string; shape: string }[];
  }[];
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
  private readonly dir = process.env.STORE_DIR ?? join(process.cwd(), '.store');

  constructor(
    private readonly prisma: PrismaService,
    private readonly portable: QuizPortableService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (isDemoMode()) return; // no catalogue on a demo instance (single host, wiped hourly)
    await mkdir(this.dir, { recursive: true });
    this.log.log(`Template catalogue: ${this.dir}`);
    await this.seedSamples();
  }

  /**
   * Amorce un catalogue vide avec les quiz d'exemple. Ils ne sont plus versés
   * d'office dans la banque de chaque nouvel arrivant : ils vivent ici, et qui en
   * veut s'en prend une copie. Une instance neuve montre donc à quoi sert la
   * bibliothèque au lieu d'une page vide, et personne n'hérite d'un contenu qu'il
   * n'a pas demandé.
   *
   * Ne s'exécute que si le catalogue est vide : un opérateur qui a tout retiré ne
   * les voit pas revenir au prochain démarrage.
   */
  private async seedSamples(): Promise<void> {
    if ((await this.readIndex()).length > 0) return;
    const entries: StoreEntry[] = [];
    for (const sample of SAMPLE_QUIZZES) {
      const id = ulid();
      const bundle = sampleBundle(sample);
      await mkdir(join(this.dir, id), { recursive: true });
      await writeFile(join(this.dir, id, MANIFEST), JSON.stringify(bundle, null, 2), 'utf8');
      entries.push({
        id,
        title: sample.title,
        description: sample.description,
        language: sample.language,
        tags: [],
        questionCount: sample.questions.length,
        license: SAMPLE_LICENSE,
        author: { name: SAMPLE_AUTHOR, subject: SAMPLE_SUBJECT },
        revision: 1,
        sharedAt: new Date().toISOString(),
        cover: null,
        first: firstItemOf((bundle as { items?: BundleItem[] }).items),
      });
    }
    await this.writeIndex(entries);
    this.log.log(`Template catalogue seeded with ${entries.length} sample(s)`);
  }

  /** Refuses everything on a demo instance: one host at a time, nobody to share with. */
  private refuseOnDemo(): void {
    if (isDemoMode()) throw new ForbiddenException('store.demo_disabled');
  }

  /** The catalogue, newest first. Reads the folder, which is the only truth. */
  async list(): Promise<ListedEntry[]> {
    if (isDemoMode()) return [];
    const entries = await this.readIndex();
    return [...entries].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt)).map(served);
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
    await this.writeIndex([...(await this.readIndex()).filter((e) => e.id !== id), entry]);
    this.log.log(`Template shared: ${entry.title} (${id}, revision ${entry.revision})`);
    return served(entry);
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
   * Ce qu'un modèle contient, lu depuis son bundle : de quoi juger avant d'en
   * prendre une copie. Les chemins de médias deviennent des URL servies par le
   * catalogue, sinon l'aperçu n'aurait que du texte.
   */
  async preview(id: string): Promise<StorePreview> {
    this.refuseOnDemo();
    const entry = (await this.readIndex()).find((e) => e.id === id);
    const raw = await readFile(join(this.dir, this.safeId(id), MANIFEST), 'utf8').catch(() => null);
    if (!entry || !raw) throw new NotFoundException('store.entry_not_found');
    // Le catalogue est un dossier : un manifeste retouché à la main ne doit pas
    // faire tomber l'aperçu, il montre alors ce qu'il a.
    const bundle = JSON.parse(raw) as {
      quiz?: { cover?: string | null };
      media?: Record<string, { alt: string | null }>;
      items?: BundleItem[];
    };
    const urlOf = (path?: string | null) => mediaUrl(id, path);
    const items = (bundle.items ?? []).map((item) => ({
      kind: item.kind,
      text: item.kind === 'question' ? (item.prompt ?? '') : firstText(item.blocks),
      type: item.kind === 'question' ? (item.type ?? null) : null,
      timeLimitS: item.timeLimitS ?? null,
      mediaUrl: urlOf(item.media),
      mediaAlt: item.media ? (bundle.media?.[item.media]?.alt ?? null) : null,
      options: (item.options ?? []).map((o) => ({
        text: o.text ?? '',
        color: o.color ?? 'blue',
        shape: o.shape ?? 'circle',
      })),
    }));
    return {
      ...entry,
      coverUrl: urlOf(bundle.quiz?.cover),
      slideCount: items.filter((i) => i.kind === 'slide').length,
      items,
    };
  }

  /** Un média du catalogue, servi pour l'aperçu (lecture seule, jamais réécrit). */
  async readMedia(id: string, name: string): Promise<Buffer> {
    this.refuseOnDemo();
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
