import { Prisma } from '@prisma/client';
import type {
  OptionColor,
  OptionShape,
  PointsMode,
  PublicOption,
  QuestionScoring,
  QuestionStartPayload,
  QuestionType,
} from '@quiz-dock/contracts';
import { basePointsFor } from './scoring';
import type { QuizSnapshot, SnapshotQuestion, SnapshotSlide } from './game.types';
import type {
  SlideBlock,
  SlideGradient,
  SlideLeafBlock,
  SlideShowPayload,
  SlideTextTone,
} from '@quiz-dock/contracts';

/** Forme Prisma attendue par le constructeur de snapshot (relations incluses). */
const quizWithContent = Prisma.validator<Prisma.QuizDefaultArgs>()({
  include: {
    questions: {
      orderBy: { orderIndex: 'asc' },
      include: {
        media: true,
        backgroundMedia: true,
        options: { orderBy: { orderIndex: 'asc' }, include: { media: true } },
        acceptedAnswers: true,
      },
    },
    slides: { orderBy: { orderIndex: 'asc' }, include: { media: true } },
  },
});
export type QuizWithContent = Prisma.QuizGetPayload<typeof quizWithContent>;
export const QUIZ_SNAPSHOT_INCLUDE = quizWithContent.include;

const mediaOf = (m: { url: string; kind: string; alt?: string | null } | null) =>
  // `alt` travels with the media (#43): the screens have no other description of
  // an image that is itself the question.
  m ? { url: m.url, kind: m.kind as 'image' | 'audio', alt: m.alt ?? null } : null;

/**
 * Construit le snapshot serveur figé d'un quiz (SPECIFICATIONS §8). Fonction pure :
 * résout les points de base depuis `pointsMode`, embarque les bonnes réponses
 * (secret serveur) et les réponses texte normalisées. La boucle live ne touche
 * plus la base après cet appel.
 */
export function buildSnapshot(quiz: QuizWithContent): QuizSnapshot {
  return {
    quizId: quiz.id,
    title: quiz.title,
    description: quiz.description,
    language: quiz.language,
    feedbackEnabled: quiz.feedbackEnabled,
    questions: quiz.questions.map(
      (q): SnapshotQuestion => ({
        id: q.id,
        orderIndex: q.orderIndex,
        type: q.type as QuestionType,
        prompt: q.prompt,
        media: mediaOf(q.media),
        answerExplanation: q.answerExplanation ?? null,
        background: q.backgroundMedia
          ? { url: q.backgroundMedia.url }
          : q.backgroundGradient
            ? { gradient: q.backgroundGradient as unknown as SlideGradient }
            : null,
        textTone: q.textTone as SlideTextTone,
        textOutline: q.textOutline,
        timeLimitS: q.timeLimitS,
        revealDelayS: q.revealDelayS ?? null,
        basePoints: basePointsFor(q.pointsMode as PointsMode),
        pointsMode: q.pointsMode as PointsMode,
        scoring: q.scoring as QuestionScoring,
        numericValue: q.numericValue === null ? null : Number(q.numericValue),
        numericTolerance: q.numericTolerance === null ? null : Number(q.numericTolerance),
        acceptedAnswersNormalized: q.acceptedAnswers.map((a) => a.normalized),
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          color: o.color as OptionColor,
          shape: o.shape as OptionShape,
          media: mediaOf(o.media),
          isCorrect: o.isCorrect,
          correctOrderIndex: o.correctOrderIndex,
        })),
      }),
    ),
    slides: buildSnapshotSlides(quiz),
  };
}

/**
 * Slides (#7) resolved onto question indexes: anchored before the question they
 * reference, or after the last one when unanchored. Sorted by (anchor, orderIndex).
 */
function buildSnapshotSlides(quiz: QuizWithContent): SnapshotSlide[] {
  const indexById = new Map(quiz.questions.map((q, i) => [q.id, i]));
  const end = quiz.questions.length;
  return quiz.slides
    .map((s) => ({
      slide: s,
      anchor: s.beforeQuestionId === null ? end : (indexById.get(s.beforeQuestionId) ?? end),
    }))
    .sort((a, b) => a.anchor - b.anchor || a.slide.orderIndex - b.slide.orderIndex)
    .map(({ slide, anchor }) => snapshotSlide(slide, anchor));
}

function snapshotSlide(slide: QuizWithContent['slides'][number], anchor: number): SnapshotSlide {
  return {
    id: slide.id,
    beforeQuestionIndex: anchor,
    blocks: resolveBlocks(slide.blocks as SlideBlock[]),
    background: slide.media
      ? { url: slide.media.url }
      : slide.gradient
        ? { gradient: slide.gradient as unknown as SlideGradient }
        : null,
    textTone: slide.textTone as SlideTextTone,
    textOutline: slide.textOutline,
    displayDelayS: slide.displayDelayS,
  };
}

/** Image blocks get their served URL so the clients never build one from an id. */
function resolveBlocks(blocks: SlideBlock[]): SlideBlock[] {
  const leaf = (b: SlideLeafBlock): SlideLeafBlock =>
    b.type === 'image' ? { ...b, url: `/api/v1/media/${b.mediaId}` } : b;
  return blocks.map((b) =>
    b.type === 'columns' ? { ...b, columns: b.columns.map((c) => c.map(leaf)) } : leaf(b),
  );
}

/** Public `slide:show` payload (#7): everything in a slide is meant to be shown. */
export function buildSlideShow(slide: SnapshotSlide, slideIndex: number): SlideShowPayload {
  return {
    slideIndex,
    questionIndex: slide.beforeQuestionIndex,
    blocks: slide.blocks,
    background: slide.background,
    textTone: slide.textTone,
    textOutline: slide.textOutline,
    displayDelayS: slide.displayDelayS,
  };
}

/**
 * Construit le payload public `question:start` (contrat §9) par **allowlist stricte**
 * (anti-triche §7) : on ne recopie QUE `{id,text,color,shape,media}` des options —
 * jamais `isCorrect`/`correctOrderIndex`, ni la cible numérique/réponses texte.
 * Le secret ne fuit pas par oubli de suppression : il n'est jamais ajouté.
 */
export function buildQuestionStart(
  question: SnapshotQuestion,
  questionIndex: number,
  startedAt: number,
  endsAt: number,
): QuestionStartPayload {
  const hasOptions = question.options.length > 0;
  const options: PublicOption[] | undefined = hasOptions
    ? question.options.map((o) => ({
        id: o.id,
        text: o.text,
        color: o.color,
        shape: o.shape,
        media: o.media,
      }))
    : undefined;
  return {
    questionIndex,
    type: question.type,
    prompt: question.prompt,
    media: question.media,
    options,
    timeLimitS: question.timeLimitS,
    basePoints: question.basePoints,
    scoring: question.scoring ?? 'standard',
    startedAt,
    endsAt,
    background: question.background,
    textTone: question.textTone,
    textOutline: question.textOutline,
  };
}

/**
 * Live refresh of the **form** of a running session: the substance of the
 * questions (list and order, type, prompt, media, options, right answers,
 * scoring, timing) stays frozen from the launch so statistics remain
 * consistent; what only affects the display follows the editor — backgrounds,
 * text contrast, answer explanation, reveal delay — and the slides in full
 * (they carry no history). Questions are matched by id; a question deleted
 * meanwhile keeps its frozen version.
 */
export function refreshSnapshotForm(frozen: QuizSnapshot, current: QuizWithContent): QuizSnapshot {
  const fresh = buildSnapshot(current);
  const freshById = new Map(fresh.questions.map((q) => [q.id, q]));
  const questions = frozen.questions.map((q): SnapshotQuestion => {
    const now = freshById.get(q.id);
    if (!now) return q;
    return {
      ...q,
      background: now.background,
      textTone: now.textTone,
      textOutline: now.textOutline,
      answerExplanation: now.answerExplanation,
      revealDelayS: now.revealDelayS,
    };
  });
  // Slides anchor on question ids in the editor; resolve them onto the frozen order.
  const indexById = new Map(frozen.questions.map((q, i) => [q.id, i]));
  const end = frozen.questions.length;
  const slides = current.slides
    .map((slide) => ({
      slide,
      anchor:
        slide.beforeQuestionId === null ? end : (indexById.get(slide.beforeQuestionId) ?? end),
    }))
    .sort((a, b) => a.anchor - b.anchor || a.slide.orderIndex - b.slide.orderIndex)
    .map(({ slide, anchor }) => snapshotSlide(slide, anchor));
  return {
    ...frozen,
    title: fresh.title,
    description: fresh.description,
    feedbackEnabled: fresh.feedbackEnabled,
    questions,
    slides,
  };
}
