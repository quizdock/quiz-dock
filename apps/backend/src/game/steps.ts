import {
  GameState,
  QuestionType,
  type GameStatePayload,
  type GameStep,
} from '@quiz-dock/contracts';
import type { GameMeta, QuizSnapshot } from './game.types';
import type { PreloadStep } from './preload';

/**
 * The steps of a game's sequence — slides and questions — as the host
 * navigates them and as their media are keyed. Pure: read from the game's
 * state and its snapshot.
 */

/** `q<i>` / `s<i>` ↔ GameStep. */
export function stepKey(step: GameStep): string {
  return 'slideIndex' in step ? `s${step.slideIndex}` : `q${step.questionIndex}`;
}

export function parseStepKey(key: string): GameStep | null {
  const m = /^([qs])(\d+)$/.exec(key);
  if (!m) return null;
  return m[1] === 's' ? { slideIndex: Number(m[2]) } : { questionIndex: Number(m[2]) };
}

/** The Redis key part of a step: a question's index, or `s<i>` for a slide (#125). */
export function mediaStepKey(step: PreloadStep): number | string {
  return step.slideIndex === undefined ? step.questionIndex : `s${step.slideIndex}`;
}

/** A step's reference in a payload: the question index, and the slide's when it is one. */
export function stepRef(step: PreloadStep): { questionIndex: number; slideIndex?: number } {
  return step.slideIndex === undefined
    ? { questionIndex: step.questionIndex }
    : { questionIndex: step.questionIndex, slideIndex: step.slideIndex };
}

/** The step a media wait holds back: the slide it precedes when set, else the question. */
export function waitedStep(meta: GameMeta): PreloadStep {
  return (meta.slideIndex ?? -1) >= 0
    ? { questionIndex: meta.currentIndex, slideIndex: meta.slideIndex }
    : { questionIndex: meta.currentIndex };
}

/** The slide on screen as a media step (its sound, its anchor). */
export function slideStep(meta: GameMeta): PreloadStep {
  return { questionIndex: meta.currentIndex, slideIndex: meta.slideIndex ?? 0 };
}

/** A question that is over: its reveal, or the quiz's standings that follow it (#198). */
export function isSettled(state: string): boolean {
  return state === GameState.Reveal || state === GameState.Leaderboard;
}

/**
 * Whether the quiz's standings get a step of their own after question `index` (#198):
 * not after the last question (the podium follows), nor after one that scores nothing.
 */
export function standingsFollow(snapshot: QuizSnapshot, index: number): boolean {
  const question = snapshot.questions[index];
  return (
    index + 1 < snapshot.questions.length &&
    question !== undefined &&
    question.type !== QuestionType.Poll &&
    question.basePoints > 0
  );
}

/** The step the live position sits on (`q<i>` / `s<i>`), '' in the lobby or at the podium. */
export function liveStepKey(meta: GameMeta): string {
  if (meta.state === GameState.SlideShow) return `s${meta.slideIndex ?? 0}`;
  if (isSettled(meta.state) || meta.state === GameState.Answering) {
    return `q${meta.currentIndex}`;
  }
  return '';
}

/**
 * Every step shown so far, in sequence order: slides anchored before a
 * question come first, then the question once its reveal happened.
 */
export function playedSteps(meta: GameMeta, snapshot: QuizSnapshot): string[] {
  const steps: string[] = [];
  const liveKey = liveStepKey(meta);
  for (let q = 0; q <= snapshot.questions.length; q++) {
    snapshot.slides.forEach((s, i) => {
      if (s.beforeQuestionIndex === q) steps.push(`s${i}`);
    });
    if (q < snapshot.questions.length) steps.push(`q${q}`);
  }
  if (meta.state === GameState.Podium) return steps;
  const at = steps.indexOf(liveKey);
  if (at < 0) return [];
  // A question counts as played once revealed; mid-question it is not a target.
  return steps.slice(0, isSettled(meta.state) ? at + 1 : at + (liveKey.startsWith('s') ? 1 : 0));
}

/** Previous / next targets for the host, around the reviewed step or the live position. */
export function navFor(
  meta: GameMeta,
  snapshot: QuizSnapshot,
): NonNullable<GameStatePayload['nav']> {
  const played = playedSteps(meta, snapshot);
  const review = Boolean(meta.reviewStep);
  const here = review ? (meta.reviewStep as string) : liveStepKey(meta);
  const at = review || here ? played.indexOf(here) : played.length;
  const prev = at > 0 ? played[at - 1] : at < 0 && played.length ? played[played.length - 1] : null;
  const next = review && at >= 0 && at < played.length - 1 ? played[at + 1] : null;
  return {
    prev: prev ? parseStepKey(prev) : null,
    next: next ? parseStepKey(next) : null,
    review,
  };
}
