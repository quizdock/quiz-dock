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

/** Enregistrement d'un joueur dans l'état live (Redis hash `:players`). */
export interface PlayerRecord {
  nickname: string;
  /** Compte lié si apprenant authentifié, sinon `null` (invité). */
  userId: string | null;
  score: number;
  streak: number;
  connected: boolean;
  /** ms epoch d'arrivée (départage des égalités §5). */
  joinedAt: number;
  /** RTT/2 mesuré au join (compensation latence §6). */
  latencyMs: number;
}

/** État scalaire d'une partie (Redis hash `game:{pin}`). */
export interface GameMeta {
  id: string;
  quizId: string;
  hostUserId: string;
  state: string;
  currentIndex: number;
  totalQuestions: number;
  fullCapture: boolean;
  title: string;
  language: string;
  createdAt: number;
}

/** Résultat de notation d'une soumission (sortie de la fonction pure §5). */
export interface ScoreResult {
  correct: boolean;
  points: number;
  newStreak: number;
}

export type { AnswerValue };
