import {
  OPTIONS_MAX,
  PointsMode,
  QuestionType,
  basePointsFor as basePointsOf,
} from '@quiz-dock/contracts';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import type { AnswerValue, ScoreResult, SnapshotQuestion } from './game.types';

/**
 * Cœur produit : notation d'une réponse (SPECIFICATIONS §5).
 *
 * **Fonction pure** — aucune dépendance I/O, déterministe pour des entrées données.
 * Protégée par des golden tests (couverture 100 % visée). Toute évolution de la
 * formule doit passer par la mise à jour explicite de ces cas de référence.
 */

/** Points de base résolus depuis le mode : la règle vit dans les contrats (aperçu, écrans). */
export function basePointsFor(mode: PointsMode): number {
  return basePointsOf(mode);
}

/**
 * Exactitude d'une réponse selon le type (§4). **Côté serveur uniquement.**
 * Le sondage (`poll`) n'a pas de bonne réponse → toujours `false` (0 point).
 */
export function gradeAnswer(question: SnapshotQuestion, answer: AnswerValue): boolean {
  return creditFor(question, answer) === 1;
}

/**
 * Levenshtein distance, for the `lenient` text scoring: a typo is not a wrong
 * answer. Tolerance: 1 edit up to 5 characters, 2 beyond.
 */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
export function lenientMatch(normalizedAnswer: string, accepted: string): boolean {
  const tolerance = accepted.length <= 5 ? 1 : 2;
  // The distance is at least the gap in length: no need to compute it then.
  if (Math.abs(normalizedAnswer.length - accepted.length) > tolerance) return false;
  return editDistance(normalizedAnswer, accepted) <= tolerance;
}

/** Longest text answer taken in: far beyond any accepted answer (200), short of abuse. */
export const ANSWER_TEXT_MAX = 1000;
/** An option id (a ULID), with room to spare. */
const OPTION_ID_MAX = 64;

const isAnswerText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && !v.includes('\u0000');

/**
 * Whether a client's answer has a shape the scoring can take: text, a list of
 * option ids, or a finite number, all bounded. Anything else is refused before
 * it is graded or stored.
 */
export function isAnswerValue(v: unknown): v is AnswerValue {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) {
    return v.length <= OPTIONS_MAX && v.every((id) => isAnswerText(id, OPTION_ID_MAX));
  }
  return isAnswerText(v, ANSWER_TEXT_MAX);
}

/**
 * Share of the credit an answer earns, 0..1 (§4). `standard` scoring is
 * all-or-nothing; `partial` (multiple choice, ordering) counts the right
 * elements; `lenient` (text) tolerates typos. Numeric `closest` is graded at
 * reveal, once every answer is known — here it only tells whether the answer is
 * exact (within the tolerance).
 */
export function creditFor(question: SnapshotQuestion, answer: AnswerValue): number {
  const scoring = question.scoring ?? 'standard';
  switch (scoredAs(question)) {
    case QuestionType.SingleChoice:
    case QuestionType.TrueFalse: {
      if (typeof answer !== 'string') return 0;
      const picked = question.options.find((o) => o.id === answer);
      return picked?.isCorrect === true ? 1 : 0;
    }
    case QuestionType.MultipleChoice: {
      if (!Array.isArray(answer)) return 0;
      const selected = new Set(answer);
      if (selected.size !== answer.length) return 0; // doublons
      const correct = question.options.filter((o) => o.isCorrect).map((o) => o.id);
      const right = correct.filter((id) => selected.has(id)).length;
      const wrong = selected.size - right;
      if (scoring === 'partial') {
        // Credit per right tick, each wrong tick cancels one — never below 0.
        return correct.length === 0 ? 0 : Math.max(0, right - wrong) / correct.length;
      }
      // Tout-ou-rien : l'ensemble coché == l'ensemble correct, exactement.
      return selected.size === correct.length && right === correct.length ? 1 : 0;
    }
    case QuestionType.Ordering: {
      if (!Array.isArray(answer)) return 0;
      if (answer.length !== question.options.length) return 0;
      if (new Set(answer).size !== answer.length) return 0; // doublons
      const inPlace = answer.filter((optId, i) => {
        const opt = question.options.find((o) => o.id === optId);
        return opt?.correctOrderIndex === i;
      }).length;
      // `partial`: share of elements at the right position; else all or nothing.
      if (scoring === 'partial') return answer.length === 0 ? 0 : inPlace / answer.length;
      return inPlace === answer.length ? 1 : 0;
    }
    case QuestionType.TextInput: {
      if (typeof answer !== 'string') return 0;
      const normalized = normalizeAnswer(answer);
      if (question.acceptedAnswersNormalized.includes(normalized)) return 1;
      if (scoring === 'lenient') {
        return question.acceptedAnswersNormalized.some((a) => lenientMatch(normalized, a)) ? 1 : 0;
      }
      return 0;
    }
    case QuestionType.Numeric: {
      if (typeof answer !== 'number' || !Number.isFinite(answer)) return 0;
      if (question.numericValue === null) return 0;
      const tol = question.numericTolerance ?? 0;
      return Math.abs(answer - question.numericValue) <= tol ? 1 : 0;
    }
    default:
      // poll : collecte d'opinion, jamais « correct ».
      return 0;
  }
}

/**
 * The type whose rules score a question: an image choice is a single choice, or a
 * multiple one when several pictures may be right — same credit, same scoring.
 */
export function scoredAs(question: SnapshotQuestion): QuestionType {
  if (question.type !== QuestionType.ImageChoice) return question.type;
  return question.multiSelect ? QuestionType.MultipleChoice : QuestionType.SingleChoice;
}

/** Numeric `closest`: points are settled at reveal, once every answer is known. */
export function isDeferred(question: SnapshotQuestion): boolean {
  return question.type === QuestionType.Numeric && question.scoring === 'closest';
}

/** Share of the base points by proximity rank (1 = closest); exact answers get everything. */
export const CLOSEST_RANK_SHARE = [1, 0.75, 0.5, 0.3] as const;
export const CLOSEST_TAIL_SHARE = 0.1;

export interface ClosestEntry<T> {
  key: T;
  value: number;
  distance: number;
  rank: number;
  exact: boolean;
  points: number;
}

/**
 * Ranks numeric answers from the closest to the farthest and settles their
 * points: exact (within the tolerance) = full base points; otherwise a share
 * by rank (ties share the rank), 10 % beyond the fourth. No speed bonus —
 * precision is the game. Non-numeric answers are left out (0 point).
 */
export function rankClosest<T>(
  question: SnapshotQuestion,
  answers: { key: T; answer: AnswerValue }[],
): ClosestEntry<T>[] {
  const target = question.numericValue;
  if (target === null) return [];
  const tol = question.numericTolerance ?? 0;
  const numeric = answers
    .filter(
      (a): a is { key: T; answer: number } =>
        typeof a.answer === 'number' && Number.isFinite(a.answer),
    )
    .map((a) => ({ key: a.key, value: a.answer, distance: Math.abs(a.answer - target) }))
    .sort((a, b) => a.distance - b.distance);
  const out: ClosestEntry<T>[] = [];
  numeric.forEach((a, i) => {
    const rank = i > 0 && numeric[i - 1].distance === a.distance ? out[i - 1].rank : i + 1;
    const exact = a.distance <= tol;
    const share = exact ? 1 : (CLOSEST_RANK_SHARE[rank - 1] ?? CLOSEST_TAIL_SHARE);
    out.push({ ...a, rank, exact, points: Math.round(question.basePoints * share) });
  });
  return out;
}

/**
 * Part de points liée à la rapidité, pour une bonne réponse (§5).
 * `ratio = clamp(t/T, 0, 1)` → instantané = P_max ; au temps limite = P_max/2.
 */
export function timePoints(basePoints: number, tSeconds: number, timeLimitS: number): number {
  if (timeLimitS <= 0) return basePoints;
  const ratio = Math.min(Math.max(tSeconds / timeLimitS, 0), 1);
  return Math.round(basePoints * (1 - ratio / 2));
}

/** Bonus de série : `+ min(streak - 1, 5) * 100`, cap +500 (§5). */
export function streakBonus(newStreak: number): number {
  if (newStreak <= 1) return 0;
  return Math.min(newStreak - 1, 5) * 100;
}

export interface ScoreInput {
  question: SnapshotQuestion;
  answer: AnswerValue;
  /** Temps de réponse serveur en ms (déjà compensé latence, ≥ 0 — §6). */
  tMs: number;
  /** Série de bonnes réponses consécutives AVANT cette question. */
  prevStreak: number;
  /** Réponse hors délai (`receivedAt > endsAt + grace`) → 0 point, série remise à 0 (§6). */
  isLate?: boolean;
}

/**
 * Note une soumission : exactitude + points temps + bonus série (§5/§6).
 *
 * - Question **sans enjeu** (sondage, ou `points_mode=none` → base 0) : 0 point et
 *   série **neutre** (ni montée ni rupture) — « ça ne compte pas » n'influe sur rien.
 * - Sinon, réponse incorrecte OU hors délai : 0 point et série remise à 0.
 */
export function scoreAnswer(input: ScoreInput): ScoreResult {
  const { question, answer, tMs, prevStreak, isLate = false } = input;
  const credit = isLate ? 0 : creditFor(question, answer);
  const correct = credit === 1;

  const unscored = question.type === QuestionType.Poll || question.basePoints === 0;
  if (unscored) {
    return { correct, points: 0, newStreak: prevStreak, credit };
  }
  // Numeric `closest`: settled at reveal (rankClosest); exactness is known already.
  if (isDeferred(question)) {
    return { correct, points: 0, newStreak: prevStreak, credit, deferred: true };
  }
  if (credit === 0) {
    return { correct: false, points: 0, newStreak: 0, credit };
  }
  // `fixed`: full base points whatever the speed; else the usual time weighting.
  const timed =
    question.pointsMode === PointsMode.Fixed
      ? question.basePoints
      : timePoints(question.basePoints, tMs / 1000, question.timeLimitS);
  if (!correct) {
    // Partial credit: a share of the points; the streak neither grows nor breaks.
    return { correct: false, points: Math.round(timed * credit), newStreak: prevStreak, credit };
  }
  const newStreak = prevStreak + 1;
  return { correct: true, points: timed + streakBonus(newStreak), newStreak, credit };
}
