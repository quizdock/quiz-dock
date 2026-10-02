import { type MediaAsset, Prisma } from '@prisma/client';
import type {
  LiveQuestionMedia,
  OptionColor,
  OptionShape,
  PointsMode,
  PublicOption,
  QuestionScoring,
  QuestionStartPayload,
  QuestionType,
} from '@quiz-dock/contracts';
import {
  type AudioTarget,
  LOUDNESS_TARGET_LUFS,
  effectiveTimeLimitS,
  fillSlideBlocks,
  quizVariables,
  mediaDurationMs,
  playbackGainDb,
  resolveAudioTarget,
  slideHasPlayback,
  slideSoundMedia,
  slideTimedMs,
  SETTINGS,
} from '@quiz-dock/contracts';
import { QUESTION_MEDIA_INCLUDE, liveMediaOf } from '../questions/question-media';
import { MEDIA_LEAD_MS } from './game.keys';
import { settings } from '../admin/settings/settings.service';
import { basePointsFor } from './scoring';
import type { QuizSnapshot, SnapshotQuestion, SnapshotSlide } from './game.types';
import type {
  SlideBlock,
  SlideGradient,
  SlideLeafBlock,
  SlideShowPayload,
  SlideTextTone,
} from '@quiz-dock/contracts';
import { mediaUrl } from '../media/media.config';

/** Forme Prisma attendue par le constructeur de snapshot (relations incluses). */
const quizWithContent = Prisma.validator<Prisma.QuizDefaultArgs>()({
  include: {
    questions: {
      orderBy: { orderIndex: 'asc' },
      include: {
        ...QUESTION_MEDIA_INCLUDE,
        backgroundMedia: true,
        options: { orderBy: { orderIndex: 'asc' }, include: { media: true } },
        acceptedAnswers: true,
      },
    },
    slides: {
      orderBy: { orderIndex: 'asc' },
      include: { media: true, videoMedia: true, audioMedia: true },
    },
    // Its slides may name the author (`{author}`).
    owner: { select: { displayName: true } },
  },
});
/** Whether media hold a sound or a video — what a device is waited for (an image is not). */
export function hasSoundOrVideo(media: LiveQuestionMedia | null | undefined): boolean {
  return !!media?.audio || media?.visual?.kind === 'video';
}

/** Whether a question plays a sound: an MP3, or a video's own track. */
export function questionHasSound(q: SnapshotQuestion): boolean {
  return hasSoundOrVideo(q.media);
}

/** Whether a slide plays a sound: its own, or its video's (#125). */
export function slideHasSound(slide: SnapshotSlide): boolean {
  return slideSoundMedia(slide) !== null;
}

/**
 * Whether any question or slide plays a sound or a video: the screens ask for
 * sound, players pick a presence.
 */
export function snapshotHasSound(snapshot: QuizSnapshot): boolean {
  return snapshot.questions.some(questionHasSound) || snapshot.slides.some(slideHasPlayback);
}

/** Which devices play this slide's sound: its own target, else the game's (#125). */
export function slideAudioTarget(slide: SnapshotSlide, gameTarget: AudioTarget): AudioTarget {
  return resolveAudioTarget(slide.audioTarget ?? null, gameTarget, null);
}

/** The game's default audio target: the host's lobby choice, else the quiz's. */
export function gameAudioTarget(
  snapshot: QuizSnapshot,
  sessionTarget: AudioTarget | '' | null | undefined,
): AudioTarget {
  return resolveAudioTarget(null, sessionTarget || null, snapshot.audioTarget);
}

/** Which devices play this question's sound: its own target, else the game's. */
export function questionAudioTarget(q: SnapshotQuestion, gameTarget: AudioTarget): AudioTarget {
  return resolveAudioTarget(q.audioTarget, gameTarget, null);
}

export type QuizWithContent = Prisma.QuizGetPayload<typeof quizWithContent>;
export const QUIZ_SNAPSHOT_INCLUDE = quizWithContent.include;

/**
 * An option's picture. `alt` travels with it (#43): the screens have no other
 * description. The option's own, in the quiz's language, before the asset's.
 */
const optionImageOf = (
  m: { url: string; kind: string; alt?: string | null } | null,
  optionAlt: string | null = null,
) =>
  m?.kind === 'image'
    ? { url: m.url, kind: 'image' as const, alt: optionAlt || m.alt || null }
    : null;

/** Reading window before the answers open (configurable, like the engine reads it). */
const readDelayMs = () => settings.get(SETTINGS.GAME_READ_DELAY_MS);

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
    audioTarget: quiz.audioTarget,
    questions: quiz.questions.map((q): SnapshotQuestion => {
      const media = liveMediaOf(q, quiz.loudnessTargetLufs);
      const durationMs = mediaDurationMs(media);
      // Listen first applies only when the media's length is known (else: the usual timing).
      const listensFirst = q.timerAfterMedia && durationMs !== null;
      return {
        id: q.id,
        orderIndex: q.orderIndex,
        type: q.type as QuestionType,
        prompt: q.prompt,
        media,
        answerExplanation: q.answerExplanation ?? null,
        background: q.backgroundMedia
          ? { url: q.backgroundMedia.url }
          : q.backgroundGradient
            ? { gradient: q.backgroundGradient as unknown as SlideGradient }
            : null,
        textTone: q.textTone as SlideTextTone,
        textOutline: q.textOutline,
        // Stretched when the media would still be playing (quiz-wide pause after it):
        // the timer, the display and the speed weighting all read this one value.
        // Listen first: the timer only starts once the media has played, nothing to stretch.
        timeLimitS: listensFirst
          ? q.timeLimitS
          : effectiveTimeLimitS(
              q.timeLimitS,
              durationMs,
              quiz.mediaTailS,
              // The media starts MEDIA_LEAD_MS after the question: that much less of it
              // plays during the reading.
              readDelayMs() - MEDIA_LEAD_MS,
            ),
        timerAfterMedia: listensFirst,
        revealDelayS: q.revealDelayS ?? null,
        audioTarget: q.audioTarget ?? null,
        basePoints: basePointsFor(q.pointsMode as PointsMode),
        pointsMode: q.pointsMode as PointsMode,
        scoring: q.scoring as QuestionScoring,
        numericValue: q.numericValue === null ? null : Number(q.numericValue),
        numericTolerance: q.numericTolerance === null ? null : Number(q.numericTolerance),
        acceptedAnswersNormalized: q.acceptedAnswers.map((a) => a.normalized),
        ...(q.multiSelect ? { multiSelect: true } : {}),
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          color: o.color as OptionColor,
          shape: o.shape as OptionShape,
          media: optionImageOf(o.media, o.alt),
          isCorrect: o.isCorrect,
          correctOrderIndex: o.correctOrderIndex,
        })),
      };
    }),
    slides: buildSnapshotSlides(quiz),
  };
}

/**
 * Slides (#7) resolved onto question indexes: anchored before the question they
 * reference, or after the last one when unanchored. Sorted by (anchor, orderIndex).
 */
function buildSnapshotSlides(quiz: QuizWithContent): SnapshotSlide[] {
  const indexById = new Map(quiz.questions.map((q, i) => [q.id, i]));
  return orderSlides(quiz.slides, indexById, quiz.questions.length).map(({ slide, anchor }) =>
    snapshotSlide(slide, anchor, quiz.loudnessTargetLufs, quiz.mediaTailS, slideQuizFields(quiz)),
  );
}

/** Slides anchored on question indexes (the end when unanchored), sorted by (anchor, order). */
function orderSlides(
  slides: QuizWithContent['slides'],
  indexById: Map<string, number>,
  end: number,
) {
  return slides
    .map((slide) => ({
      slide,
      anchor:
        slide.beforeQuestionId === null ? end : (indexById.get(slide.beforeQuestionId) ?? end),
    }))
    .sort((a, b) => a.anchor - b.anchor || a.slide.orderIndex - b.slide.orderIndex);
}

function snapshotSlide(
  slide: QuizWithContent['slides'][number],
  anchor: number,
  targetLufs: number = LOUDNESS_TARGET_LUFS,
  mediaTailS = 0,
  /** The quiz whose fields the slide's text may name (`{title}`, `{questions}`…). */
  quiz: SlideQuizFields = { title: '' },
): SnapshotSlide {
  const gain = (m: MediaAsset) => playbackGainDb(m.loudnessLufs, m.peakDbfs, targetLufs);
  // Media (#125): a video of the right kind, and a sound only beside a muted one.
  const v = slide.videoMedia?.kind === 'video' ? slide.videoMedia : null;
  const a =
    slide.audioMedia?.kind === 'audio' && !(v && slide.videoSound) ? slide.audioMedia : null;
  const video = v
    ? {
        url: v.url,
        loop: slide.videoLoop,
        sound: slide.videoSound,
        gainDb: gain(v),
        ...(v.durationMs ? { durationMs: v.durationMs } : {}),
      }
    : null;
  const audio = a
    ? {
        url: a.url,
        durationMs: a.durationMs ?? 0,
        peaks: a.peaks,
        gainDb: gain(a),
        size: slide.waveformSize,
      }
    : null;
  const timedMs = slideTimedMs({ video, audio });
  return {
    id: slide.id,
    beforeQuestionIndex: anchor,
    blocks: resolveBlocks(slide.blocks as SlideBlock[], quiz),
    background: slide.media
      ? { url: slide.media.url }
      : slide.gradient
        ? { gradient: slide.gradient as unknown as SlideGradient }
        : null,
    video,
    audio,
    audioTarget: slide.audioTarget ?? null,
    mediaHoldMs: timedMs === null ? null : timedMs + mediaTailS * 1000,
    textTone: slide.textTone as SlideTextTone,
    textOutline: slide.textOutline,
    displayDelayS: slide.displayDelayS,
  };
}

/** What a slide's variables read of the quiz (see `quizVariables`). */
type SlideQuizFields = Parameters<typeof quizVariables>[0];

/** The quiz's fields for its slides' variables, from the rows the snapshot reads. */
function slideQuizFields(quiz: QuizWithContent): SlideQuizFields {
  return {
    title: quiz.title,
    description: quiz.description,
    questionCount: quiz.questions.length,
    author: quiz.owner?.displayName ?? null,
    tags: quiz.tags,
    license: quiz.license,
  };
}

/**
 * Image blocks get their served URL so the clients never build one from an id;
 * a text naming the quiz (`{title}`, `{description}`) gets the quiz's current ones.
 */
function resolveBlocks(blocks: SlideBlock[], quiz: SlideQuizFields): SlideBlock[] {
  const leaf = (b: SlideLeafBlock): SlideLeafBlock =>
    b.type === 'image' ? { ...b, url: mediaUrl(b.mediaId) } : b;
  const resolved = blocks.map((b) =>
    b.type === 'columns' ? { ...b, columns: b.columns.map((c) => c.map(leaf)) } : leaf(b),
  );
  return fillSlideBlocks(resolved, quizVariables(quiz));
}

/**
 * Public `slide:show` payload (#7): everything in a slide is meant to be shown.
 * With media (#125): who hears its sound, and when every device starts them.
 */
export function buildSlideShow(
  slide: SnapshotSlide,
  slideIndex: number,
  /** The game's default audio target (see {@link gameAudioTarget}). */
  gameTarget?: AudioTarget,
  /** When the slide's media start (server ms epoch), 0 or absent when it plays none. */
  mediaStartAt?: number,
): SlideShowPayload {
  return {
    slideIndex,
    questionIndex: slide.beforeQuestionIndex,
    blocks: slide.blocks,
    background: slide.background,
    ...(slide.video ? { video: slide.video } : {}),
    ...(slide.audio ? { audio: slide.audio } : {}),
    ...(gameTarget && slideHasSound(slide)
      ? { audioTarget: slideAudioTarget(slide, gameTarget) }
      : {}),
    ...(mediaStartAt ? { mediaStartAt } : {}),
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
  /** The game's default audio target (see {@link gameAudioTarget}). */
  gameTarget: AudioTarget,
  /** `startedAt − mediaStartAt`, null when the question plays nothing (see `GameMeta`). */
  mediaLeadMs: number | null,
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
    ...(questionHasSound(question)
      ? { audioTarget: questionAudioTarget(question, gameTarget) }
      : {}),
    options,
    ...(question.multiSelect ? { multiSelect: true } : {}),
    timeLimitS: question.timeLimitS,
    basePoints: question.basePoints,
    scoring: question.scoring ?? 'standard',
    startedAt,
    endsAt,
    ...(mediaLeadMs !== null && startedAt > 0 ? { mediaStartAt: startedAt - mediaLeadMs } : {}),
    ...(question.timerAfterMedia ? { listenFirst: true } : {}),
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
 * text contrast, answer explanation, reveal delay, who hears the sound — and the slides in full
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
      audioTarget: now.audioTarget,
    };
  });
  // Slides anchor on question ids in the editor; resolve them onto the frozen order.
  const indexById = new Map(frozen.questions.map((q, i) => [q.id, i]));
  const slides = orderSlides(current.slides, indexById, frozen.questions.length).map(
    ({ slide, anchor }) =>
      snapshotSlide(
        slide,
        anchor,
        current.loudnessTargetLufs,
        current.mediaTailS,
        slideQuizFields(current),
      ),
  );
  return {
    ...frozen,
    title: fresh.title,
    description: fresh.description,
    feedbackEnabled: fresh.feedbackEnabled,
    audioTarget: fresh.audioTarget,
    questions,
    slides,
  };
}

/**
 * A slide's name in the host's outline: its first heading, else the start of its
 * first text (Markdown marks removed), columns included; empty when it has neither.
 */
export function slideTitle(blocks: SlideBlock[]): string {
  const leaves = blocks.flatMap((b) => (b.type === 'columns' ? b.columns.flat() : [b]));
  const heading = leaves.find((b) => b.type === 'heading' && b.text.trim());
  if (heading && heading.type === 'heading') return heading.text.trim();
  const text = leaves.find((b) => b.type === 'text' && b.md.trim());
  if (text && text.type === 'text') {
    const plain = text.md
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
  }
  return '';
}
