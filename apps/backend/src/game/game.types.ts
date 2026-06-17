import type { AnswerValue, OptionColor, OptionShape, QuestionType } from '@roux-quizz/contracts';

/**
 * Snapshot serveur du quiz (SPECIFICATIONS §8 / mémoire gameplay-v0-3).
 *
 * Construit une fois au `host:create` et stocké dans l'état Redis. La boucle live
 * tourne EXCLUSIVEMENT sur ce snapshot : immune aux édits/suppressions en cours de
 * partie, aucun hit DB par question, et c'est **ici seulement** que vivent les
 * bonnes réponses côté serveur (anti-triche §7 — jamais diffusées avant `reveal`).
 */
export interface SnapshotOption {
  id: string;
  text: string | null;
  color: OptionColor;
  shape: OptionShape;
  media: { url: string; kind: 'image' | 'audio' } | null;
  /** Secret serveur — JAMAIS envoyé au client avant `question:reveal`. */
  isCorrect: boolean;
  /** Position correcte (type `ordering`) — secret serveur. */
  correctOrderIndex: number | null;
}

export interface SnapshotQuestion {
  id: string;
  orderIndex: number;
  type: QuestionType;
  prompt: string;
  media: { url: string; kind: 'image' | 'audio' } | null;
  timeLimitS: number;
  /** Points de base déjà résolus depuis `pointsMode` (1000 / 2000 / 0 — §5). */
  basePoints: number;
  /** Cible numérique (type `numeric`) — secret serveur. */
  numericValue: number | null;
  numericTolerance: number | null;
  /** Réponses acceptées **normalisées** (type `text_input`) — secret serveur. */
  acceptedAnswersNormalized: string[];
  options: SnapshotOption[];
}

export interface QuizSnapshot {
  quizId: string;
  title: string;
  language: string;
  questions: SnapshotQuestion[];
}

/** Résultat de notation d'une soumission (sortie de la fonction pure §5). */
export interface ScoreResult {
  correct: boolean;
  points: number;
  newStreak: number;
}

export type { AnswerValue };
