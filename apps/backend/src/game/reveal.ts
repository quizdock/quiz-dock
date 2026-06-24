import { QuestionType } from '@live-quizz/contracts';
import type { AnswerRecord, SnapshotQuestion } from './game.types';

/** Partie **commune** d'un reveal (identique pour tous) — sans le résultat perso. */
export interface RevealCommon {
  correctOptionIds?: string[];
  correctValue?: number | string | string[];
  distribution: Record<string, number>;
}

/** Types dont la répartition se compte par option choisie. */
const OPTION_DISTRIBUTION = new Set<QuestionType>([
  QuestionType.SingleChoice,
  QuestionType.MultipleChoice,
  QuestionType.TrueFalse,
  QuestionType.Poll,
]);

/**
 * Calcule la partie commune du `question:reveal` (contrat §9) : bonne(s) réponse(s)
 * — désormais divulguées (après ANSWERING, anti-triche §7) — et la **répartition**
 * des réponses. Fonction **pure** : lit le snapshot + les réponses gradées stockées.
 *
 * - QCM/V-F/sondage : répartition par id d'option (toutes initialisées à 0).
 * - Ordre/texte/numérique : répartition correct/incorrect (les options libres ne se
 *   comptent pas par valeur).
 */
export function buildRevealCommon(q: SnapshotQuestion, records: AnswerRecord[]): RevealCommon {
  const common: RevealCommon = { distribution: {} };

  // Bonne(s) réponse(s) selon le type.
  switch (q.type) {
    case QuestionType.SingleChoice:
    case QuestionType.MultipleChoice:
    case QuestionType.TrueFalse:
      common.correctOptionIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
      break;
    case QuestionType.Ordering:
      common.correctValue = [...q.options]
        .sort((a, b) => (a.correctOrderIndex ?? 0) - (b.correctOrderIndex ?? 0))
        .map((o) => o.id);
      break;
    case QuestionType.Numeric:
      if (q.numericValue !== null) common.correctValue = q.numericValue;
      break;
    case QuestionType.TextInput:
      common.correctValue = q.acceptedAnswersNormalized;
      break;
    // poll : pas de bonne réponse.
  }

  // Répartition.
  if (OPTION_DISTRIBUTION.has(q.type)) {
    for (const o of q.options) common.distribution[o.id] = 0;
    for (const r of records) {
      const picks = Array.isArray(r.answer) ? r.answer : [r.answer];
      for (const p of picks) {
        if (typeof p === 'string' && p in common.distribution) common.distribution[p] += 1;
      }
    }
  } else {
    const correct = records.filter((r) => r.isCorrect).length;
    common.distribution = { correct, incorrect: records.length - correct };
  }

  return common;
}
