import type {
  AnswerValue,
  AudioTarget,
  PlayerPresence,
  GameMode,
  LiveQuestionMedia,
  OptionColor,
  OptionShape,
  ParticipantAccess,
  PointsMode,
  QuestionScoring,
  QuestionType,
  SessionNotice,
  SlideBackground,
  SlideBlock,
  SlideTextTone,
} from '@quiz-dock/contracts';
import type { GameId } from './game.keys';

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
  /** Listen first: the answers open when the media ends (frozen with the substance). */
  timerAfterMedia?: boolean;
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
  /** The credits of the media it plays, shown at the podium (#53; absent before it). */
  credits?: string[];
}

/**
 * Who a player is in the room (Redis hash `room:{pin}:players`). What they score
 * belongs to each game (`PlayerScore`), never to the room.
 */
export interface PlayerRecord {
  nickname: string;
  /** Graine d'avatar (multiavatar) — cosmétique ; défaut = pseudo. */
  avatar: string;
  /** Compte lié si participant authentifié, sinon `null` (invité). */
  userId: string | null;
  connected: boolean;
  /** ms epoch d'arrivée (départage des égalités §5). */
  joinedAt: number;
  /** RTT/2 mesuré au join (compensation latence §6). */
  latencyMs: number;
  /** Where they follow the game from; `room` when absent (records made before it existed). */
  presence?: PlayerPresence;
}

/** A player's score in one game (Redis hash `game:{id}:scores`). */
export interface PlayerScore {
  score: number;
  streak: number;
}

/**
 * The room (Redis hash `room:{pin}`): who hosts it, the game it plays, and what
 * the players were told when they came in.
 */
export interface RoomMeta {
  roomId: string;
  hostUserId: string;
  /** The game the room plays (the last one, once it is over). */
  gameId: GameId;
  fullCapture: boolean;
  personalTracking: boolean;
  pickOwnName: boolean;
  participantAccess: ParticipantAccess;
  joinLocked: boolean;
  /** Base URL of the invitations (QR, link) chosen by the host; '' = each screen's own origin. */
  joinBaseUrl: string;
  /** When the room opened (ms epoch); each game keeps its own `createdAt`. */
  openedAt: number;
}

/** The room fields, as the game view (`GameMeta`) carries them. */
export const ROOM_FIELDS = [
  'roomId',
  'hostUserId',
  'gameId',
  'fullCapture',
  'personalTracking',
  'pickOwnName',
  'participantAccess',
  'joinLocked',
  'joinBaseUrl',
  'openedAt',
] as const;

/**
 * The game a room is playing, as the engine reads it: its own hash
 * (`game:{id}`) merged with the room's (`room:{pin}`).
 */
export interface GameMeta {
  /** The game's id, the key of its state. */
  id: GameId;
  /** The room it is played in. */
  roomId: string;
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
  /**
   * How participants get in, fixed at creation (#57): `open` = the PIN and a
   * nickname alone, every player a guest even when signed in.
   */
  participantAccess: ParticipantAccess;
  /** Closed to new participants by the host (reconnections still get in). */
  joinLocked: boolean;
  /**
   * `questionStartedAt − mediaStartAt` for the current question, null when it plays
   * nothing: kept as a distance so a pause, which moves `questionStartedAt`, moves
   * the media's start with it.
   */
  mediaLeadMs?: number | null;
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

/** The fields of the game hash (`game:{id}`): everything in `GameMeta` the room does not hold. */
export type GameFields = Omit<GameMeta, 'id' | (typeof ROOM_FIELDS)[number]>;

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
  meta: Pick<
    GameMeta,
    'fullCapture' | 'personalTracking' | 'pickOwnName' | 'participantAccess' | 'joinLocked'
  >,
): SessionNotice {
  return {
    fullCapture: meta.fullCapture,
    personalTracking: meta.personalTracking,
    pickOwnName: meta.pickOwnName,
    participantAccess: meta.participantAccess,
    joinLocked: meta.joinLocked,
  };
}
