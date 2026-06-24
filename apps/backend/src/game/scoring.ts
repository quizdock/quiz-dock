import { PointsMode, QuestionType } from '@live-quizz/contracts';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import type { AnswerValue, ScoreResult, SnapshotQuestion } from './game.types';

/**
 * Cœur produit : notation d'une réponse (SPECIFICATIONS §5).
 *
 * **Fonction pure** — aucune dépendance I/O, déterministe pour des entrées données.
 * Protégée par des golden tests (couverture 100 % visée). Toute évolution de la
 * formule doit passer par la mise à jour explicite de ces cas de référence.
 */

/** Points de base résolus depuis le mode (défaut 1000 ; double 2000 ; none 0). */
export function basePointsFor(mode: PointsMode): number {
  switch (mode) {
    case PointsMode.Double:
      return 2000;
    case PointsMode.None:
      return 0;
    default:
      return 1000;
  }
}

/**
 * Exactitude d'une réponse selon le type (§4). **Côté serveur uniquement.**
 * Le sondage (`poll`) n'a pas de bonne réponse → toujours `false` (0 point).
 */
export function gradeAnswer(question: SnapshotQuestion, answer: AnswerValue): boolean {
  switch (question.type) {
    case QuestionType.SingleChoice:
    case QuestionType.TrueFalse: {
      if (typeof answer !== 'string') return false;
      const picked = question.options.find((o) => o.id === answer);
      return picked?.isCorrect === true;
    }

    case QuestionType.MultipleChoice: {
      if (!Array.isArray(answer)) return false;
      const selected = new Set(answer);
      if (selected.size !== answer.length) return false; // doublons
      const correct = question.options.filter((o) => o.isCorrect).map((o) => o.id);
      // Tout-ou-rien (v1) : l'ensemble coché == l'ensemble correct, exactement.
      return selected.size === correct.length && correct.every((id) => selected.has(id));
    }

    case QuestionType.Ordering: {
      if (!Array.isArray(answer)) return false;
      if (answer.length !== question.options.length) return false;
      if (new Set(answer).size !== answer.length) return false; // doublons
      // Tout-ou-rien : l'option en position i a correctOrderIndex === i.
      return answer.every((optId, i) => {
        const opt = question.options.find((o) => o.id === optId);
        return opt?.correctOrderIndex === i;
      });
    }

    case QuestionType.TextInput: {
      if (typeof answer !== 'string') return false;
      return question.acceptedAnswersNormalized.includes(normalizeAnswer(answer));
    }

    case QuestionType.Numeric: {
      if (typeof answer !== 'number' || !Number.isFinite(answer)) return false;
      if (question.numericValue === null) return false;
      const tol = question.numericTolerance ?? 0;
      return Math.abs(answer - question.numericValue) <= tol;
    }

    default:
      // poll : collecte d'opinion, jamais « correct ».
      return false;
  }
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
  const correct = !isLate && gradeAnswer(question, answer);

  const unscored = question.type === QuestionType.Poll || question.basePoints === 0;
  if (unscored) {
    return { correct, points: 0, newStreak: prevStreak };
  }

  if (!correct) {
    return { correct: false, points: 0, newStreak: 0 };
  }
  const newStreak = prevStreak + 1;
  const points =
    timePoints(question.basePoints, tMs / 1000, question.timeLimitS) + streakBonus(newStreak);
  return { correct: true, points, newStreak };
}
