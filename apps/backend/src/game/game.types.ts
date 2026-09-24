import type {
  AnswerValue,
  AudioTarget,
  PlayerPresence,
  GameMode,
  LiveQuestionMedia,
  OptionColor,
  OptionShape,
  PointsMode,
  QuestionScoring,
  QuestionType,
  SlideBackground,
  SlideBlock,
  SlideTextTone,
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
  media: { url: string; kind: 'image'; alt?: string | null } | null;
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
  media: LiveQuestionMedia;
  timeLimitS: number;
  /** Auto-mode delay on this REVEAL in seconds (#6); null = engine default. */
  revealDelayS: number | null;
  /** Which devices play its sound; null (or absent, older snapshots) = the game's default. */
  audioTarget?: AudioTarget | null;
  /** Markdown shown at REVEAL only (#5) — never part of `question:start`. */
  answerExplanation: string | null;
  /** Optional full-cover background (image or gradient) with its text contrast. */
  background: SlideBackground | null;
  textTone: SlideTextTone;
  textOutline: boolean;
  /** Points de base déjà résolus depuis `pointsMode` (1000 / 2000 / 0 — §5). */
  basePoints: number;
  /** `fixed`: full base points, no speed weighting. Absent = standard weighting. */
  pointsMode?: PointsMode;
  /** Per-type scoring rule (`standard` when absent — snapshots from before the field). */
  scoring?: QuestionScoring;
  /** Cible numérique (type `numeric`) — secret serveur. */
  numericValue: number | null;
  numericTolerance: number | null;
  /** Réponses acceptées **normalisées** (type `text_input`) — secret serveur. */
  acceptedAnswersNormalized: string[];
  options: SnapshotOption[];
}

/**
 * Content slide (#7) in the live sequence. `beforeQuestionIndex` is the index of
 * the question it precedes (`questions.length` = after the last one).
 */
export interface SnapshotSlide {
  id: string;
  beforeQuestionIndex: number;
  /** Blocks with image URLs resolved (the client never needs a media id). */
  blocks: SlideBlock[];
  background: SlideBackground | null;
  textTone: SlideTextTone;
  textOutline: boolean;
  displayDelayS: number | null;
}

export interface QuizSnapshot {
  quizId: string;
  title: string;
  description: string | null;
  language: string;
  /** End-of-session rating allowed (§2.11). */
  feedbackEnabled: boolean;
  /** The quiz's default audio target (absent in snapshots from before it). */
  audioTarget?: AudioTarget;
  questions: SnapshotQuestion[];
  /** Sorted by (beforeQuestionIndex, orderIndex). */
  slides: SnapshotSlide[];
}

/** Enregistrement d'un joueur dans l'état live (Redis hash `:players`). */
export interface PlayerRecord {
  nickname: string;
  /** Graine d'avatar (multiavatar) — cosmétique ; défaut = pseudo. */
  avatar: string;
  /** Compte lié si participant authentifié, sinon `null` (invité). */
  userId: string | null;
  score: number;
  streak: number;
  connected: boolean;
  /** ms epoch d'arrivée (départage des égalités §5). */
  joinedAt: number;
  /** RTT/2 mesuré au join (compensation latence §6). */
  latencyMs: number;
  /** Where they follow the game from; `room` when absent (records made before it existed). */
  presence?: PlayerPresence;
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
  /** Suivi individuel (RG-16) : `false` = aucun résultat par participant archivé. */
  personalTracking: boolean;
  /** Les participants choisissent leur nom affiché ; sinon il vient du compte (RG-15). */
  pickOwnName: boolean;
  /** End of the media wait (ms epoch) while in `MEDIA_LOADING`, 0 otherwise. */
  mediaWaitUntil?: number;
  /** The host's lobby choice replacing the quiz's default audio target; empty = the quiz's. */
  audioTarget?: AudioTarget | '';
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
  /** Index of the slide on screen while `state === SLIDE_SHOW` (#7), -1 otherwise. */
  slideIndex?: number;
  /** Duration (ms) of the auto-next countdown armed at `autoNextAt` (#6). */
  autoNextMs?: number;
  /** État figé avant `HOST_DISCONNECTED` (pour la reprise §7.3). */
  prevState?: string;
  /** ms de question restantes, figées quand `clockFrozen` (pause ou §7.1). */
  pausedRemainingMs?: number;
  /** Step shown again by the host (`q<i>` / `s<i>`), '' when the screens follow the live position. */
  reviewStep?: string;
  /** Base URL of the invitations (QR, link) chosen by the host; '' = each screen's own origin. */
  joinBaseUrl?: string;
}

/** Réponse gradée stockée au submit (Redis hash `:answers:{idx}`) — REVEAL la relit. */
export interface AnswerRecord {
  answer: AnswerValue;
  isCorrect: boolean;
  pointsAwarded: number;
  /** Share of the credit earned (0..1), when the scoring is not all-or-nothing. */
  credit?: number;
  /** Numeric `closest`: proximity rank and distance, settled at reveal. */
  closestRank?: number;
  distance?: number;
  /** Temps de réponse serveur compensé, en ms (§6). */
  tMs: number;
  receivedAt: number;
}

/** Résultat de notation d'une soumission (sortie de la fonction pure §5). */
export interface ScoreResult {
  correct: boolean;
  points: number;
  newStreak: number;
  /** Share of the credit earned, 0..1. */
  credit: number;
  /** Points settled later (numeric `closest`, at reveal). */
  deferred?: boolean;
}

export type { AnswerValue };

/**
 * Avis de transparence (§2.10, RG-16) : ce que la session enregistre, tel qu'il est
 * envoyé aux participants (et reflété par la console).
 */
export function noticeOf(
  meta: Pick<GameMeta, 'fullCapture' | 'personalTracking' | 'pickOwnName'>,
): {
  fullCapture: boolean;
  personalTracking: boolean;
  pickOwnName: boolean;
} {
  return {
    fullCapture: meta.fullCapture,
    personalTracking: meta.personalTracking,
    pickOwnName: meta.pickOwnName,
  };
}
