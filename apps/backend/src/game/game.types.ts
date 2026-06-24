import type {
  AnswerValue,
  GameMode,
  OptionColor,
  OptionShape,
  QuestionType,
} from '@quiz-dock/contracts';

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
  description: string | null;
  language: string;
  questions: SnapshotQuestion[];
}

/** Enregistrement d'un joueur dans l'état live (Redis hash `:players`). */
export interface PlayerRecord {
  nickname: string;
  /** Graine d'avatar (multiavatar) — cosmétique ; défaut = pseudo. */
  avatar: string;
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
  /** Timings serveur autoritatifs de la question courante (§6), 0 hors ANSWERING. */
  questionStartedAt: number;
  questionEndsAt: number;
  /** Rythme de progression (§8). `manual` par défaut (l'hôte enchaîne). */
  mode: GameMode;
  /** Auto-progression suspendue par l'hôte (et chrono gelé en ANSWERING). */
  paused: boolean;
  /**
   * Chrono de la question gelé : ms restantes figées dans `pausedRemainingMs`.
   * Primitive partagée par la pause hôte (§8) et le `HOST_DISCONNECTED` (§7.1) —
   * idempotente pour que les deux puissent s'imbriquer sans s'écraser.
   */
  clockFrozen: boolean;
  /** Deadline (ms epoch) de l'enchaînement auto en cours sur un reveal (§8), 0 sinon. */
  autoNextAt?: number;
  /** État figé avant `HOST_DISCONNECTED` (pour la reprise §7.3). */
  prevState?: string;
  /** ms de question restantes, figées quand `clockFrozen` (pause ou §7.1). */
  pausedRemainingMs?: number;
}

/** Réponse gradée stockée au submit (Redis hash `:answers:{idx}`) — REVEAL la relit. */
export interface AnswerRecord {
  answer: AnswerValue;
  isCorrect: boolean;
  pointsAwarded: number;
  /** Temps de réponse serveur compensé, en ms (§6). */
  tMs: number;
  receivedAt: number;
}

/** Résultat de notation d'une soumission (sortie de la fonction pure §5). */
export interface ScoreResult {
  correct: boolean;
  points: number;
  newStreak: number;
}

export type { AnswerValue };
