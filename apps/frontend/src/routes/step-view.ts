import {
  AUDIO_TARGET_DEFAULT,
  GameState,
  type LiveQuestionMedia,
  type PublicOption,
  type QuestionMedia,
  type QuestionRevealPayload,
  type QuestionStartPayload,
  type SlideGradient,
  type MediaPosition,
  type WaveformSize,
  basePointsFor,
  normalizeAnswer,
} from '@quiz-dock/contracts';
import type { QuizItem } from '@/lib/quiz-items';
import type { MediaResolver } from '@/lib/media-url';
import type { QuizDetailDtoQuestionsItem } from '../api/generated/model';
import { type GameView, INITIAL_VIEW } from '../game/use-game-session';
import { type StepQuiz, slideQuizFieldsOf, slideShowOf } from './quiz-stage-preview';

/**
 * A quiz's step as the live screens would receive it, with no game: the preview
 * draws the real projection and the real phone from it (UI system §3). A question
 * shows as it opens (`QUESTION_SHOW`), or with its answer (`REVEAL`).
 */
export function stepView(
  items: QuizItem[],
  index: number,
  quiz: StepQuiz,
  url: MediaResolver,
  { reveal = false }: { reveal?: boolean } = {},
): GameView {
  const item = items[index];
  const questionIndex = items.slice(0, index).filter((i) => i.kind === 'question').length;
  const base: GameView = {
    ...INITIAL_VIEW,
    status: 'ready',
    questionIndex,
    totalQuestions: items.filter((i) => i.kind === 'question').length,
    quizTitle: quiz.title,
    quizDescription: quiz.description,
    // Not a room: no way in to show.
    joinLocked: true,
    // Its clock stands at the question's full time.
    still: true,
  };
  if (item.kind === 'slide') {
    const slide = slideShowOf(item.slide, index, slideQuizFieldsOf(quiz), url);
    return { ...base, state: GameState.SlideShow, slide: { ...slide, questionIndex } };
  }
  const question = liveQuestion(item.question, questionIndex, url);
  return reveal
    ? { ...base, state: GameState.Reveal, question, reveal: revealOf(item.question, question) }
    : { ...base, state: GameState.QuestionShow, question };
}

/** The question as `question:start` carries it. */
function liveQuestion(
  q: QuizDetailDtoQuestionsItem,
  questionIndex: number,
  url: MediaResolver,
): QuestionStartPayload {
  const media = q.media as QuestionMedia | null;
  const now = Date.now();
  const live = liveMedia(
    media,
    url,
    q.waveformSize as WaveformSize,
    q.mediaPosition as MediaPosition,
  );
  return {
    questionIndex,
    type: q.type as QuestionStartPayload['type'],
    prompt: q.prompt,
    media: live,
    ...(live.audio || live.visual?.kind === 'video'
      ? { audioTarget: q.audioTarget ?? AUDIO_TARGET_DEFAULT }
      : {}),
    options:
      q.options.length > 0
        ? q.options.map(
            (o): PublicOption => ({
              id: o.id,
              text: q.type === 'image_choice' ? null : o.text,
              color: o.color as PublicOption['color'],
              shape: o.shape as PublicOption['shape'],
              media: o.mediaId ? { url: url(o.mediaId), kind: 'image', alt: o.alt } : null,
            }),
          )
        : undefined,
    multiSelect: q.type === 'image_choice' ? q.multiSelect : undefined,
    timeLimitS: q.timeLimitS,
    basePoints: basePointsFor(q.pointsMode),
    scoring: q.scoring as QuestionStartPayload['scoring'],
    startedAt: now,
    endsAt: now + q.timeLimitS * 1000,
    listenFirst: q.timerAfterMedia || undefined,
    background: q.backgroundMediaId
      ? { url: url(q.backgroundMediaId) }
      : q.backgroundGradient
        ? { gradient: q.backgroundGradient as SlideGradient }
        : null,
    textTone: q.textTone,
    textOutline: q.textOutline,
  };
}

/** The media as the screens get them: addresses, at their own level. */
function liveMedia(
  media: QuestionMedia | null,
  url: MediaResolver,
  size: WaveformSize,
  position: MediaPosition | undefined,
): LiveQuestionMedia {
  const visual = media?.visual;
  const audio = media?.audio;
  return {
    visual: !visual
      ? null
      : visual.kind === 'image'
        ? { kind: 'image', url: url(visual.assetId), alt: null }
        : visual.source === 'upload'
          ? { kind: 'video', source: 'upload', url: url(visual.assetId), gainDb: 0 }
          : visual,
    audio: audio
      ? {
          url: url(audio.assetId),
          durationMs: audio.durationMs,
          peaks: audio.peaks,
          gainDb: 0,
          size,
        }
      : null,
    // As the server sends it: only a visual has a place, the default goes without saying.
    ...(visual && position && position !== 'bottom' ? { position } : {}),
  };
}

/** The answer as `question:reveal` carries it, nobody having answered (the server's rule). */
function revealOf(
  q: QuizDetailDtoQuestionsItem,
  live: QuestionStartPayload,
): QuestionRevealPayload {
  const byOption = q.type !== 'ordering' && q.type !== 'numeric' && q.type !== 'text_input';
  const reveal: QuestionRevealPayload = {
    distribution: byOption
      ? Object.fromEntries((live.options ?? []).map((o) => [o.id, 0]))
      : { correct: 0, incorrect: 0 },
    ...(q.answerExplanation ? { answerExplanation: q.answerExplanation } : {}),
  };
  if (q.type === 'ordering') {
    reveal.correctValue = [...q.options]
      .sort((a, b) => (a.correctOrderIndex ?? 0) - (b.correctOrderIndex ?? 0))
      .map((o) => o.id);
  } else if (q.type === 'numeric') {
    if (q.numericValue != null) reveal.correctValue = Number(q.numericValue);
  } else if (q.type === 'text_input') {
    reveal.correctValue = q.acceptedAnswers.map((a) => a.normalized || normalizeAnswer(a.text));
  } else if (q.type !== 'poll') {
    reveal.correctOptionIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
  }
  return reveal;
}
