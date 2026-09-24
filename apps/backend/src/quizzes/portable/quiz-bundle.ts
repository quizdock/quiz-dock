import type { Prisma } from '@prisma/client';
import {
  LOUDNESS_TARGET_LUFS,
  type LoudnessTarget,
  MEDIA_TAIL_DEFAULT_S,
} from '@quiz-dock/contracts';
import { ZodError } from 'zod';
import {
  type QuestionContent,
  questionContentSchema,
} from '../../questions/dto/question-content.schema';
import { QUESTION_MEDIA_INCLUDE } from '../../questions/question-media';
import { type SlideContent, slideContentSchema } from '../../slides/dto/slide-content.schema';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  type QuestionBundleItem,
  type QuizBundle,
  type BundleMediaMeta,
  type SlideBundleItem,
} from './quiz-bundle.schema';

/** Rows needed to export a quiz, in the shape `prisma.quiz.findFirst` returns with this include. */
export const EXPORT_INCLUDE = {
  questions: {
    orderBy: { orderIndex: 'asc' },
    include: {
      options: { orderBy: { orderIndex: 'asc' } },
      acceptedAnswers: true,
      ...QUESTION_MEDIA_INCLUDE,
    },
  },
  slides: { orderBy: { orderIndex: 'asc' } },
} satisfies Prisma.QuizInclude;

export type ExportableQuiz = Prisma.QuizGetPayload<{ include: typeof EXPORT_INCLUDE }>;

/** Inline images typed in Markdown fields point at the media route (`components/markdown.tsx`). */
const MEDIA_URL_RE = /\/api\/v1\/media\/([0-9A-Za-z]{26})/g;
const BUNDLE_URL_RE = /\]\((media\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})\)/g;

/** ASCII, lowercase, dash-separated: a bundle `slug` (and file stem) derived from a title. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** The slug a quiz travels under: its own, or one derived from the title. */
export function slugOf(quiz: Pick<ExportableQuiz, 'slug' | 'title'>): string {
  return quiz.slug ?? (slugify(quiz.title) || 'quiz');
}

/** Raised when the bundle is structurally fine but an item fails the API content rules. */
export class BundleContentError extends Error {
  constructor(
    readonly item: number,
    readonly issues: { field: string; code: string }[],
  ) {
    super(`bundle item ${item} rejected`);
  }
}

/** Visits every leaf block of a slide, columns included (blocks are validated later, so stay lenient). */
function walkBlocks(blocks: unknown, visit: (b: Record<string, unknown>) => void): void {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;
    if (block.type === 'columns' && Array.isArray(block.columns)) {
      for (const column of block.columns) walkBlocks(column, visit);
    } else {
      visit(block);
    }
  }
}

// ---------------------------------------------------------------------------
// Export: rows → bundle
// ---------------------------------------------------------------------------

type PathFor = (mediaId: string) => string;

function mdOut(text: string, pathFor: PathFor): string {
  return text.replace(MEDIA_URL_RE, (_m, id: string) => pathFor(id));
}

function blocksOut(blocks: unknown, pathFor: PathFor): unknown {
  if (Array.isArray(blocks)) return blocks.map((b) => blocksOut(b, pathFor));
  if (!blocks || typeof blocks !== 'object') return blocks;
  const b = blocks as Record<string, unknown>;
  if (b.type === 'image' && typeof b.mediaId === 'string') {
    const { mediaId, ...rest } = b;
    return { ...rest, media: pathFor(mediaId) };
  }
  if (b.type === 'text' && typeof b.md === 'string') return { ...b, md: mdOut(b.md, pathFor) };
  if (b.type === 'columns' && Array.isArray(b.columns)) {
    return { ...b, columns: b.columns.map((c) => blocksOut(c, pathFor)) };
  }
  return b;
}

/** Every media id the quiz refers to, direct references and inline Markdown images alike. */
export function collectMediaIds(quiz: ExportableQuiz): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => id && ids.add(id);
  const scan = (text: string | null | undefined) => {
    for (const m of (text ?? '').matchAll(MEDIA_URL_RE)) ids.add(m[1]);
  };
  add(quiz.coverMediaId);
  scan(quiz.description);
  for (const q of quiz.questions) {
    add(q.visualMediaId);
    add(q.audioMediaId);
    add(q.backgroundMediaId);
    scan(q.prompt);
    scan(q.answerExplanation);
    for (const o of q.options) {
      add(o.mediaId);
      scan(o.text);
    }
  }
  for (const s of quiz.slides) {
    add(s.mediaId);
    walkBlocks(s.blocks, (b) => {
      if (b.type === 'image' && typeof b.mediaId === 'string') add(b.mediaId);
      if (b.type === 'text' && typeof b.md === 'string') scan(b.md);
    });
  }
  return ids;
}

function questionOut(q: ExportableQuiz['questions'][number], pathFor: PathFor): QuestionBundleItem {
  const item: QuestionBundleItem = {
    kind: 'question',
    type: q.type,
    prompt: mdOut(q.prompt, pathFor),
    timeLimitS: q.timeLimitS,
    pointsMode: q.pointsMode,
    textTone: q.textTone,
    textOutline: q.textOutline,
  };
  if (q.visualMediaId) item.media = pathFor(q.visualMediaId);
  if (q.audioMediaId) item.audio = pathFor(q.audioMediaId);
  if (q.answerExplanation) item.answerExplanation = mdOut(q.answerExplanation, pathFor);
  if (q.backgroundMediaId) item.backgroundImage = pathFor(q.backgroundMediaId);
  if (q.backgroundGradient)
    item.backgroundGradient = q.backgroundGradient as QuestionBundleItem['backgroundGradient'];
  if (q.scoring !== 'standard') item.scoring = q.scoring;
  if (q.revealDelayS !== null) item.revealDelayS = q.revealDelayS;
  if (q.numericValue !== null) item.numericValue = Number(q.numericValue);
  if (q.numericTolerance !== null) item.numericTolerance = Number(q.numericTolerance);
  if (q.options.length > 0) {
    item.options = q.options.map((o) => {
      const out: NonNullable<QuestionBundleItem['options']>[number] = {
        color: o.color,
        shape: o.shape,
        isCorrect: o.isCorrect,
      };
      if (o.text) out.text = mdOut(o.text, pathFor);
      if (o.mediaId) out.media = pathFor(o.mediaId);
      if (o.correctOrderIndex !== null) out.correctOrderIndex = o.correctOrderIndex;
      return out;
    });
  }
  if (q.acceptedAnswers.length > 0) item.acceptedAnswers = q.acceptedAnswers.map((a) => a.text);
  return item;
}

function slideOut(s: ExportableQuiz['slides'][number], pathFor: PathFor): SlideBundleItem {
  const item: SlideBundleItem = {
    kind: 'slide',
    blocks: blocksOut(s.blocks, pathFor) as unknown[],
    textTone: s.textTone,
    textOutline: s.textOutline,
  };
  if (s.mediaId) item.backgroundImage = pathFor(s.mediaId);
  if (s.gradient) item.backgroundGradient = s.gradient as SlideBundleItem['backgroundGradient'];
  if (s.displayDelayS !== null) item.displayDelayS = s.displayDelayS;
  return item;
}

/** Serialises a quiz into its bundle manifest; `pathFor` names the media file for each id. */
export function toBundle(
  quiz: ExportableQuiz,
  pathFor: PathFor,
  /** What each media carries beyond its bytes, by bundle path (alt, a sound's measures). */
  mediaMeta: Record<string, BundleMediaMeta> = {},
): QuizBundle {
  const items: QuizBundle['items'] = [];
  const slidesBefore = new Map<string | null, ExportableQuiz['slides']>();
  for (const s of quiz.slides) {
    const list = slidesBefore.get(s.beforeQuestionId) ?? [];
    list.push(s);
    slidesBefore.set(s.beforeQuestionId, list);
  }
  for (const q of quiz.questions) {
    for (const s of slidesBefore.get(q.id) ?? []) items.push(slideOut(s, pathFor));
    items.push(questionOut(q, pathFor));
  }
  for (const s of slidesBefore.get(null) ?? []) items.push(slideOut(s, pathFor));
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    quiz: {
      slug: slugOf(quiz),
      namespace: quiz.namespace,
      revision: quiz.revision,
      updatedAt: quiz.updatedAt.toISOString(),
      title: quiz.title,
      description: quiz.description ? mdOut(quiz.description, pathFor) : null,
      language: quiz.language,
      domain: quiz.domain,
      tags: quiz.tags,
      license: quiz.license,
      feedbackEnabled: quiz.feedbackEnabled,
      mediaTailS: quiz.mediaTailS,
      loudnessTargetLufs: quiz.loudnessTargetLufs as LoudnessTarget,
      cover: quiz.coverMediaId ? pathFor(quiz.coverMediaId) : null,
    },
    media: Object.fromEntries(
      Object.entries(mediaMeta)
        .map(([path, meta]) => [path, compactMeta(meta)] as const)
        .filter(([, meta]) => Object.keys(meta).length > 0),
    ),
    items,
  };
}

/** A media entry without its empty fields (an image with no alt has none left). */
function compactMeta(meta: BundleMediaMeta): BundleMediaMeta {
  return Object.fromEntries(
    Object.entries(meta).filter(
      ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
    ),
  ) as BundleMediaMeta;
}

// ---------------------------------------------------------------------------
// Import: bundle → API content (validated)
// ---------------------------------------------------------------------------

type IdFor = (path: string) => string;

/** A media uploaded from the bundle: its id, the kind its content turned out to be. */
export interface ImportedAsset {
  id: string;
  kind: 'image' | 'video' | 'audio';
}

export interface ImportedQuiz {
  title: string;
  description: string | null;
  language: string;
  feedbackEnabled: boolean;
  mediaTailS: number;
  loudnessTargetLufs: LoudnessTarget;
  coverMediaId: string | null;
  /** Store fields, defaulted when the bundle predates them (`docs/quiz-bundle.md`). */
  slug: string;
  namespace: string | null;
  revision: number;
  domain: string | null;
  tags: string[];
  license: string | null;
  questions: QuestionContent[];
  /** `beforeQuestion` indexes `questions`; `null` anchors the slide at the end. */
  slides: { content: SlideContent; beforeQuestion: number | null; orderIndex: number }[];
}

function mdIn(text: string, idFor: IdFor): string {
  return text.replace(BUNDLE_URL_RE, (_m, path: string) => `](/api/v1/media/${idFor(path)})`);
}

function blocksIn(blocks: unknown, idFor: IdFor): unknown {
  if (Array.isArray(blocks)) return blocks.map((b) => blocksIn(b, idFor));
  if (!blocks || typeof blocks !== 'object') return blocks;
  const b = blocks as Record<string, unknown>;
  if (b.type === 'image' && typeof b.media === 'string') {
    const { media, ...rest } = b;
    return { ...rest, mediaId: idFor(media) };
  }
  if (b.type === 'text' && typeof b.md === 'string') return { ...b, md: mdIn(b.md, idFor) };
  if (b.type === 'columns' && Array.isArray(b.columns)) {
    return { ...b, columns: b.columns.map((c) => blocksIn(c, idFor)) };
  }
  return b;
}

/** Every media path the bundle refers to, so the caller can check and upload them first. */
export function collectMediaPaths(bundle: QuizBundle): Set<string> {
  const paths = new Set<string>();
  const add = (p: string | null | undefined) => p && paths.add(p);
  const scan = (text: string | null | undefined) => {
    for (const m of (text ?? '').matchAll(BUNDLE_URL_RE)) paths.add(m[1]);
  };
  add(bundle.quiz.cover);
  scan(bundle.quiz.description);
  for (const it of bundle.items) {
    add(it.backgroundImage);
    if (it.kind === 'question') {
      add(it.media);
      add(it.audio);
      scan(it.prompt);
      scan(it.answerExplanation);
      for (const o of it.options ?? []) {
        add(o.media);
        scan(o.text);
      }
    } else {
      walkBlocks(it.blocks, (b) => {
        if (b.type === 'image' && typeof b.media === 'string') add(b.media);
        if (b.type === 'text' && typeof b.md === 'string') scan(b.md);
      });
    }
  }
  return paths;
}

/** The two media slots of a bundle item, in the contract's shape (validated by the question schema). */
function questionMediaIn(
  bundle: QuizBundle,
  it: QuestionBundleItem,
  idFor: IdFor,
  kindFor: (path: string) => ImportedAsset['kind'],
): unknown {
  const visual = it.media
    ? kindFor(it.media) === 'video'
      ? { kind: 'video', source: 'upload', assetId: idFor(it.media) }
      : { kind: kindFor(it.media), assetId: idFor(it.media) }
    : null;
  const meta = it.audio ? bundle.media?.[it.audio] : undefined;
  const audio = it.audio
    ? {
        assetId: idFor(it.audio),
        origin: meta?.origin ?? 'upload',
        durationMs: meta?.durationMs,
        peaks: meta?.peaks,
      }
    : null;
  return { visual, audio };
}

function parseOrThrow<T>(parse: () => T, item: number): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BundleContentError(
        item,
        err.issues.map((i) => ({ field: i.path.join('.') || '_', code: i.code })),
      );
    }
    throw err;
  }
}

/**
 * Turns a validated manifest into API-shaped content, `idFor` resolving each
 * media path to an uploaded media id. Items are re-validated with the API
 * content schemas so a hand-written bundle obeys the same rules as the builder.
 */
export function fromBundle(
  bundle: QuizBundle,
  idFor: IdFor,
  /** Kind of each uploaded media (a question's visual may be an image or a video). */
  kindFor: (path: string) => ImportedAsset['kind'] = () => 'image',
): ImportedQuiz {
  const questions: QuestionContent[] = [];
  const slides: ImportedQuiz['slides'] = [];
  let pending: SlideContent[] = [];
  bundle.items.forEach((it, index) => {
    if (it.kind === 'slide') {
      pending.push(
        parseOrThrow(
          () =>
            slideContentSchema.parse({
              blocks: blocksIn(it.blocks ?? [], idFor),
              mediaId: it.backgroundImage ? idFor(it.backgroundImage) : null,
              gradient: it.backgroundGradient ?? null,
              textTone: it.textTone,
              textOutline: it.textOutline,
              displayDelayS: it.displayDelayS,
            }),
          index,
        ),
      );
      return;
    }
    const q = parseOrThrow(
      () =>
        questionContentSchema.parse({
          type: it.type,
          prompt: mdIn(it.prompt, idFor),
          answerExplanation: it.answerExplanation ? mdIn(it.answerExplanation, idFor) : null,
          media: questionMediaIn(bundle, it, idFor, kindFor),
          backgroundMediaId: it.backgroundImage ? idFor(it.backgroundImage) : null,
          backgroundGradient: it.backgroundGradient ?? null,
          textTone: it.textTone,
          textOutline: it.textOutline,
          timeLimitS: it.timeLimitS,
          revealDelayS: it.revealDelayS,
          pointsMode: it.pointsMode,
          scoring: it.scoring,
          numericValue: it.numericValue,
          numericTolerance: it.numericTolerance,
          options: (it.options ?? []).map((o) => ({
            text: o.text ? mdIn(o.text, idFor) : undefined,
            mediaId: o.media ? idFor(o.media) : undefined,
            color: o.color,
            shape: o.shape,
            isCorrect: o.isCorrect,
            correctOrderIndex: o.correctOrderIndex,
          })),
          acceptedAnswers: (it.acceptedAnswers ?? []).map((text) => ({ text })),
        }),
      index,
    );
    pending.forEach((content, orderIndex) =>
      slides.push({ content, beforeQuestion: questions.length, orderIndex }),
    );
    pending = [];
    questions.push(q);
  });
  pending.forEach((content, orderIndex) =>
    slides.push({ content, beforeQuestion: null, orderIndex }),
  );
  const { quiz } = bundle;
  return {
    title: quiz.title,
    description: quiz.description ? mdIn(quiz.description, idFor) : null,
    language: quiz.language ?? 'en',
    feedbackEnabled: quiz.feedbackEnabled ?? true,
    mediaTailS: quiz.mediaTailS ?? MEDIA_TAIL_DEFAULT_S,
    loudnessTargetLufs: quiz.loudnessTargetLufs ?? LOUDNESS_TARGET_LUFS,
    coverMediaId: quiz.cover ? idFor(quiz.cover) : null,
    slug: quiz.slug ?? slugOf({ slug: null, title: quiz.title }),
    namespace: quiz.namespace ?? null,
    revision: quiz.revision ?? 0,
    domain: quiz.domain ?? null,
    tags: quiz.tags ?? [],
    license: quiz.license ?? null,
    questions,
    slides,
  };
}
