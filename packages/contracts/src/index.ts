/**
 * @quiz-dock/contracts
 *
 * Source de vérité partagée front/back pour le contrat temps réel (WebSocket)
 * et les énumérations du domaine. Voir specifications/SPECIFICATIONS.md §9
 * et specifications/SPECIFICATIONS-DONNEES.md §3.
 *
 * Inclut les énumérations du domaine, les noms d'événements et les **payloads typés**
 * (maps `ClientToServerEvents`/`ServerToClientEvents`) du contrat temps réel.
 */

export * from './background';
export * from './image-choice';
export * from './media-sniff';
export * from './preferences';
export * from './question-media';
export * from './question-content';
export * from './quiz-terms';
export * from './slide-content';
export * from './slide-media';
export * from './admin/settings';
export * from './admin/operations';
export * from './admin/results';
import type { ParticipantAccess } from './preferences';
import type { AudioTarget, LiveAudio, LiveQuestionMedia } from './question-media';

export const CONTRACTS_VERSION = '0.3.0' as const;

/** États de la partie (machine à états — technique §8). */
export enum GameState {
  Lobby = 'LOBBY',
  QuestionShow = 'QUESTION_SHOW',
  Answering = 'ANSWERING',
  Reveal = 'REVEAL',
  Leaderboard = 'LEADERBOARD',
  /** A content slide (#7) is on screen: no answer; advances on host click or, in auto mode, by `displayDelayS`. */
  SlideShow = 'SLIDE_SHOW',
  /**
   * A question is due but a device that plays its sound or video has not loaded
   * it: the room waits, at most `GAME_MEDIA_WAIT_S` seconds; the host may start
   * anyway (`host:next`). `questionIndex` is the question that comes.
   */
  MediaLoading = 'MEDIA_LOADING',
  Podium = 'PODIUM',
  Ended = 'ENDED',
  HostDisconnected = 'HOST_DISCONNECTED',
}

/** Types de question (technique §4). */
export enum QuestionType {
  SingleChoice = 'single_choice',
  MultipleChoice = 'multiple_choice',
  TrueFalse = 'true_false',
  TextInput = 'text_input',
  Numeric = 'numeric',
  Ordering = 'ordering',
  Poll = 'poll',
  /** Answers that are pictures (see image-choice.ts). */
  ImageChoice = 'image_choice',
}

/** Mode de points d'une question (technique §5). */
export enum PointsMode {
  Standard = 'standard',
  Double = 'double',
  None = 'none',
  /** Full base points for a right answer, no speed weighting. */
  Fixed = 'fixed',
}

/**
 * Per-type scoring rule. `standard` = historical behaviour. numeric: `closest`
 * ranks the answers by distance (scored at reveal); multiple_choice and
 * ordering: `partial` gives credit per right element; text_input: `lenient`
 * tolerates small typos.
 */
export type QuestionScoring = 'standard' | 'closest' | 'partial' | 'lenient';

/** Rythme de progression de la partie (§8). `manual` : l'hôte enchaîne ; `auto` :
 * la partie avance seule après le reveal (le `pause` suspend l'auto-progression). */
export type GameMode = 'manual' | 'auto';

/** Couleurs/formes des options — accessibilité couleur + forme (technique §4). */
export enum OptionColor {
  Red = 'red',
  Blue = 'blue',
  Yellow = 'yellow',
  Green = 'green',
  Purple = 'purple',
  Orange = 'orange',
  Pink = 'pink',
  Teal = 'teal',
}

export enum OptionShape {
  Triangle = 'triangle',
  Diamond = 'diamond',
  Circle = 'circle',
  Square = 'square',
  Star = 'star',
  Hexagon = 'hexagon',
  Heart = 'heart',
  Cross = 'cross',
}

// ─── Payloads WebSocket (technique §9) ──────────────────────────────────────
// Source de vérité du contrat temps réel, typée bout-en-bout (back + front).

/**
 * Where a player follows the game from. `room`: they see the projection, their
 * device stays silent. `remote`: they get the whole question on their device.
 * Only offered when the quiz plays sound; `room` otherwise.
 */
export type PlayerPresence = 'room' | 'remote';

/** Réponse d'un joueur : option(s), texte, nombre, ou séquence d'ordre. */
export type AnswerValue = string | string[] | number;

/** Option telle qu'EXPOSÉE au joueur — JAMAIS de flag correct (anti-triche §7). */
export interface PublicOption {
  id: string;
  text?: string | null;
  color: OptionColor;
  shape: OptionShape;
  /** `alt` is what the author wrote for screen readers (#43); null = none. */
  media?: { url: string; kind: 'image'; alt?: string | null } | null;
}

/** A participant's nickname, in characters: what the server takes and the phone counts. */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

/**
 * What a player learns of a room before joining (#57): whether the quiz plays
 * sound (the form then asks where they are), whether an account is needed, and
 * whose room it is — said as soon as the PIN is typed.
 */
export interface PlayerPeek {
  hasSound: boolean;
  participantAccess: ParticipantAccess;
  roomName: string | null;
  hostName: string | null;
  quizTitle: string | null;
  /** Closed to newcomers by the host: a place taken back still works. */
  joinLocked: boolean;
}

export interface QuestionStartPayload {
  questionIndex: number;
  type: QuestionType;
  prompt: string;
  /** Visual and sound of the question; both null when it has none. */
  media: LiveQuestionMedia;
  /** Which devices play its sound, resolved for this game (present when it has one). */
  audioTarget?: AudioTarget;
  options?: PublicOption[];
  /** image_choice: several pictures may be picked (absent = one). */
  multiSelect?: boolean;
  timeLimitS: number;
  basePoints: number;
  /** Scoring rule of the question (so the rules line and the reveal can explain it). */
  scoring?: QuestionScoring;
  startedAt: number; // ms epoch serveur (§6)
  endsAt: number;
  /**
   * When every device starts the sound or video (server ms epoch; present when
   * the question has one). A device reaching it late starts where the media is.
   */
  mediaStartAt?: number;
  /** Listen first: the answers open when the media ends (`startedAt`), not before. */
  listenFirst?: boolean;
  /** Optional full-cover background (image or gradient), like a slide's. */
  background?: SlideBackground | null;
  textTone?: SlideTextTone;
  textOutline?: boolean;
}

/** Text over a full-cover background: light text on a darkened image, or dark text on a lightened one. */
export type SlideTextTone = 'light' | 'dark';

/** Horizontal alignment of a text-like block; centred when absent. */
export type SlideTextAlign = 'left' | 'center' | 'right';

/** Base font size of a text block on the 1280×720 stage: 20 / 30 / 40 px; medium when absent. */
export type SlideTextSize = 'small' | 'medium' | 'large';

/** Width of an image block on the slide surface. */
export type SlideImageSize = 'small' | 'medium' | 'large' | 'full';

/**
 * Slide content (#7) is a composition of blocks, top to bottom; `columns` lays
 * leaf blocks side by side. `id` is a stable client key (reorder, edit).
 */
export type SlideLeafBlock =
  | { type: 'heading'; id: string; text: string; level: 1 | 2; align?: SlideTextAlign }
  | { type: 'text'; id: string; md: string; align?: SlideTextAlign; size?: SlideTextSize }
  | {
      type: 'image';
      id: string;
      /** Media id when stored/edited; the live payload also carries the resolved `url`. */
      mediaId: string;
      url?: string;
      size: SlideImageSize;
      align: 'left' | 'center' | 'right';
    };
export type SlideBlock =
  | SlideLeafBlock
  | {
      type: 'columns';
      id: string;
      columns: SlideLeafBlock[][];
      /** Width split for two columns; equal when absent (and always for three). */
      ratio?: SlideColumnsRatio;
    };
export type SlideColumnsRatio = '1-1' | '1-2' | '2-1';

/** A CSS linear gradient built by the author: 2–4 colours along an angle. */
export interface SlideGradient {
  angle: number;
  colors: string[];
}
/** Full-cover background: an uploaded image, or a generated gradient. */
export type SlideBackground = { url: string } | { gradient: SlideGradient };

/**
 * A slide's video (#125), filling the slide behind its content (cover).
 * `loop`: it runs as long as the slide shows (else it plays once and stays on
 * its last frame); `sound`: it plays its own sound (else muted, and the slide
 * may have a sound of its own).
 */
export interface SlideVideo {
  url: string;
  loop: boolean;
  sound: boolean;
  gainDb: number;
  durationMs?: number;
}

/**
 * A content slide on screen (#7). `questionIndex` is the question that follows
 * the slide (`totalQuestions` when the slide closes the quiz). Sent to everyone:
 * participants see the full content on their device.
 */
export interface SlideShowPayload {
  slideIndex: number;
  questionIndex: number;
  blocks: SlideBlock[];
  /** Optional full-cover background (image or gradient). */
  background: SlideBackground | null;
  textTone: SlideTextTone;
  /** Subtitle-like halo around the text (contrast over any background). */
  textOutline: boolean;
  /** Auto-mode display time: null = engine default, 0 = the host clicks, else seconds. */
  displayDelayS: number | null;
  /** A video filling the slide behind its content (#125), over its background. */
  video?: SlideVideo | null;
  /** The slide's sound (#125); never with a video that plays its own. */
  audio?: LiveAudio | null;
  /** Which devices play the slide's sound, resolved for this game (present when it has one). */
  audioTarget?: AudioTarget;
  /** When every device starts the slide's videos and sound (server ms epoch; present when it has some). */
  mediaStartAt?: number;
}

/**
 * What a device fetches ahead of the next step — a question, or a slide when
 * `slideIndex` is set: only what this device will show or play. For a question,
 * never its prompt nor its options: the question itself stays unknown.
 */
export interface MediaPreloadPayload {
  questionIndex: number;
  /** The step is the slide `slideIndex` (shown before question `questionIndex`). */
  slideIndex?: number;
  /** A question's media; for a slide, its sound-bearing media (see `slideSoundMedia`). */
  media: LiveQuestionMedia;
  /** Which devices will play its sound (present when it has one). */
  audioTarget?: AudioTarget;
  /** Images of the slides coming (a slide's background and image blocks). */
  images?: string[];
  /** A slide's video this device shows muted (#125). */
  videos?: string[];
}

/**
 * Who has loaded the sound or video of an upcoming question. Counted: the
 * projection windows, and the participants whose device will play a sound or
 * a video (remote ones; in the room, only when the sound is for every device).
 * Images are not waited for.
 */
export interface MediaReadinessPayload {
  questionIndex: number;
  /** The step is the slide `slideIndex` (#125). */
  slideIndex?: number;
  /** Counted devices ready, out of all of them (screens and participants). */
  ready: number;
  total: number;
  /**
   * The participants counted, ready or not (the console lists them). In the lobby
   * (#104), every participant: `pressed` when they said they are ready, `ready`
   * once their device has also loaded what it plays.
   */
  players: { playerId: string; ready: boolean; pressed?: boolean }[];
  /** The projection windows counted. */
  screens: { ready: number; total: number };
  /** The lobby's count (#104): `ready`/`total` are the participants; the screens say their own. */
  lobby?: boolean;
}

/**
 * Where the projection is in a question's sound: seconds played, and whether it
 * plays on. Sent about once a second and at each play, pause or jump, so the
 * screens that do not play the sound move their playhead with the room's.
 */
export interface MediaPositionPayload {
  questionIndex: number;
  /** The sound of the slide `slideIndex`, not of the question (#125). */
  slideIndex?: number;
  t: number;
  playing: boolean;
}

/** A step of the sequence the host can jump back to: a played question (its reveal) or a shown slide. */
export type GameStep = { questionIndex: number } | { slideIndex: number };

export interface GameStatePayload {
  state: GameState;
  questionIndex: number;
  totalQuestions: number;
  /**
   * Host navigation over what was already played: `prev`/`next` steps when the
   * host may look back (null = none), `review` when the screens show a past step
   * rather than the live position (`host:next` then resumes the live position).
   */
  nav?: { prev: GameStep | null; next: GameStep | null; review: boolean };
}

/**
 * Mode/pause courants. `remainingMs` n'est présent que si le chrono est gelé.
 * `autoNextAt`/`autoNextMs` ne sont présents que pendant l'attente d'enchaînement
 * automatique (mode auto, sur un reveal) : deadline (ms epoch serveur) + durée
 * totale, pour afficher un compte à rebours + une barre de progression.
 */
export interface GameModePayload {
  mode: GameMode;
  paused: boolean;
  remainingMs?: number;
  autoNextAt?: number;
  autoNextMs?: number;
}

/** Nouveau timing serveur autoritatif de la question courante (ajustement chrono). */
export interface QuestionTimePayload {
  questionIndex: number;
  startedAt: number;
  endsAt: number;
  /** The media's start, moved with the rest (present when the question has a sound or a video). */
  mediaStartAt?: number;
}

/**
 * Une question du sommaire de contrôle. Le sommaire est **réservé à la console
 * hôte** (jamais diffusé aux joueurs/projection), donc il peut porter la clé de
 * correction — `correctOptionIds` permet à l'animateur de voir la bonne réponse
 * en direct (vide pour les types sans option : numérique/texte/sondage/ordre).
 */
export interface OutlineQuestion {
  index: number;
  type: QuestionType;
  prompt: string;
  timeLimitS: number;
  correctOptionIds: string[];
}

/** A slide in the host's outline, placed before the question it leads to. */
export interface OutlineSlide {
  /** Its index among the quiz's slides (the `slideIndex` of a `GameStep`). */
  slideIndex: number;
  /** The question it comes before; the question count when it closes the quiz. */
  beforeQuestionIndex: number;
  /** Its first heading, else the start of its first text; empty when it has neither. */
  title: string;
  /** Seconds it stays in auto mode; null = the default duration. */
  displayDelayS: number | null;
}

/** Sommaire du quiz pour la console hôte (récap + carrousel d'avancement). */
export interface GameOutlinePayload {
  /** Quiz being played — the host console links back to its editor. */
  quizId: string;
  title: string;
  description: string | null;
  questions: OutlineQuestion[];
  /** The quiz's slides, so the outline shows every step. */
  slides: OutlineSlide[];
}

export interface PersonalResult {
  correct: boolean;
  points: number;
  totalScore: number;
  rank: number;
  /** Share of the credit earned (0..1) when the scoring gives partial credit. */
  credit?: number;
  /** Numeric `closest`: own proximity rank and distance to the target. */
  closestRank?: number;
  distance?: number;
}

/** One row of the proximity ranking of a `closest` numeric question. */
export interface ClosestRow {
  nickname: string;
  avatar?: string;
  value: number;
  /** |value − target| */
  distance: number;
  /** 1 = closest; ties share a rank. */
  rank: number;
  points: number;
}

export interface QuestionRevealPayload {
  correctOptionIds?: string[];
  correctValue?: number | string | string[];
  /** Markdown explanation of the answer (#5); only ever sent at reveal. */
  answerExplanation?: string;
  distribution: Record<string, number>;
  /** Numeric `closest`: answers from the closest to the farthest (top 10). */
  closest?: ClosestRow[];
  yourResult?: PersonalResult;
}

export interface LeaderboardRow {
  nickname: string;
  score: number;
  rank: number;
  /** Graine d'avatar (multiavatar) — cosmétique ; défaut = pseudo si absent. */
  avatar?: string;
}

export interface LeaderboardPayload {
  top: LeaderboardRow[];
  you?: { score: number; rank: number };
}

/**
 * The room's standings across the quizzes played so far (#89): the scores add up,
 * a player who left stays ranked. `you` is the player's own, on their socket only.
 */
/**
 * The room's game sounds (#93, SPECIFICATIONS-MEDIA §9): a tick at each answer,
 * a gong when a question ends, a background track while players answer. The
 * effects are synthesised unless a sample replaces them; the levels are the
 * MUSIC and SFX buses'. Played by the projection and remote participants only.
 */
export interface RoomSoundsPayload {
  tick: boolean;
  gong: boolean;
  /** Tic… tac… on the last five seconds of a question, the gong on zero. */
  countdown: boolean;
  /** A bright ding as a question starts (not over a question with its own sound). */
  ding: boolean;
  /** A sample replacing a synthesised effect (a sound of the library), null = synthesised. */
  tickUrl: string | null;
  gongUrl: string | null;
  dingUrl: string | null;
  /** The countdown's sample: its tic, and its tac played lower. */
  countdownUrl: string | null;
  /** The background track, looped while players answer; null = none. */
  musicUrl: string | null;
  /** Levels of the MUSIC and SFX buses, 0..1. */
  musicLevel: number;
  sfxLevel: number;
  /** A bus the host switched off for the room, its level kept for when it is back. */
  musicMuted: boolean;
  sfxMuted: boolean;
  /** The MEDIA bus: a question's, a slide's or a video's own sound, 0..1 (#150). */
  mediaLevel: number;
  mediaMuted: boolean;
  /** Every sound of the room off at once, from the console; the buses keep their settings. */
  muted: boolean;
}

/** What the host sets (media ids, not URLs); every field optional. */
export interface RoomSoundsSettings {
  tick?: boolean;
  gong?: boolean;
  countdown?: boolean;
  ding?: boolean;
  /** A media id of the library ('' = back to the synthesised effect / no track). */
  tickId?: string;
  gongId?: string;
  dingId?: string;
  countdownId?: string;
  musicId?: string;
  musicLevel?: number;
  sfxLevel?: number;
  musicMuted?: boolean;
  sfxMuted?: boolean;
  mediaLevel?: number;
  mediaMuted?: boolean;
  muted?: boolean;
}

export interface RoomStandingsPayload {
  quizzesPlayed: number;
  /** The quizzes the room played to their end — to the host console only. */
  playedQuizIds?: string[];
  /** Top 10, by total score then arrival in the room. */
  top: LeaderboardRow[];
  you?: {
    score: number;
    rank: number;
    correct: number;
    answered: number;
    /** Average answer time over the series (ms); null before any answer. */
    avgResponseMs: number | null;
    /** Longest run of right answers in any one quiz. */
    maxStreak: number;
    /** Quizzes of the room they took part in. */
    quizzes: number;
  };
}

/** One player's line in the host's standings (#198): their score in this quiz and in the room. */
export interface HostScoreRow {
  playerId: string;
  /** Points in the quiz being played; 0 before any. */
  quizScore: number;
  quizRank: number;
  /** The room's total: the quizzes already played, and this one so far. */
  roomScore: number;
  roomRank: number;
}

/** Every player's scores, to the host's console only (#198). */
export interface HostScoresPayload {
  rows: HostScoreRow[];
}

export interface PodiumPayload {
  podium: LeaderboardRow[];
  /** The quiz of this podium: a rating goes to it (several quizzes share a room's PIN). */
  quizId?: string;
  you?: { score: number; rank: number };
  /** Whether the end-of-session rating panel is offered (§2.11); absent = yes. */
  feedbackEnabled?: boolean;
  /** Credits of the quiz's media (author, licence, source), shown under the podium (#53). */
  credits?: string[];
}

/** Map des events client → serveur (avec accusés de réception typés). */
export interface ClientToServerEvents {
  'host:create': (
    p: {
      quizId: string;
      fullCapture?: boolean;
      /** Suivi individuel (RG-16) ; défaut `true`. `false` = agrégats seuls. */
      personalTracking?: boolean;
      /**
       * Les participants choisissent leur nom affiché (RG-15) ; sous OIDC le défaut
       * est `false` (le nom vient du compte). Sans compte, ils le saisissent toujours.
       */
      pickOwnName?: boolean;
      /**
       * How participants get in (#57), fixed for the whole game: `account` (the
       * default) or `open`, the PIN and a nickname alone — offered only when the
       * server allows it (`ALLOW_ANONYMOUS_PARTICIPANTS`). Open access means no
       * personal tracking and a chosen name.
       */
      participantAccess?: ParticipantAccess;
    },
    ack: (res: { pin: string }) => void,
  ) => void;
  /** Rebinde un hôte authentifié propriétaire à sa partie (reconnexion / 2ᵉ fenêtre de contrôle). */
  'host:attach': (p: { pin: string }, ack: (res: { ok: boolean }) => void) => void;
  'host:start': (p: { pin: string }) => void;
  /** Stops the next quiz's countdown (#198): the quiz then waits for **Start**. */
  'host:lobby-countdown-stop': (p: { pin: string }) => void;
  'host:next': (p: { pin: string }) => void;
  /** Show a played step again (no replay, no rescoring); `host:next` resumes. */
  'host:review': (p: { pin: string } & GameStep) => void;
  /** Base URL the invitations (QR, link) point at; lobby only. */
  'host:join-url': (p: { pin: string; baseUrl: string }) => void;
  'host:reveal': (p: { pin: string }) => void;
  /**
   * Bannit un joueur pour `minutes` minutes : exclusion immédiate (déconnecté +
   * retiré du classement) et re-join refusé tant que le ban court (RG-12).
   */
  'host:ban': (p: { pin: string; playerId: string; minutes: number }) => void;
  /** Termine la partie. `archive:true` → persiste les résultats avant destruction. */
  'host:end': (p: { pin: string; archive?: boolean }) => void;
  /**
   * Opens `quizId` as the room's next quiz, in its lobby: from the lobby (the
   * quiz picked is replaced) or from the podium (`archive:true` keeps the results
   * of the quiz just played, as `host:end` does). The players stay in, at 0; the
   * host's choices (capture, tracking, lock, pace, audio target) carry over.
   */
  /** The room's game sounds (#93), at any time (a volume may move mid-quiz). */
  'host:sounds': (p: { pin: string } & RoomSoundsSettings) => void;
  /** Whether the room's screens move between steps (UI system §1.8), at any time. */
  'host:motion': (p: { pin: string; on: boolean }) => void;
  /** The participant is ready (or not yet) in the lobby (#104); never blocks the start. */
  'player:ready': (p: { pin: string; ready: boolean }, ack: (res: { ok: boolean }) => void) => void;
  /** The room's own name (≤ 60 characters), from its lobby; blank = the default. */
  'host:room-name': (p: { pin: string; name: string }) => void;
  /** Picks the quiz of the room's lobby, or replaces it (nothing of it was played). */
  'host:next-quiz': (
    p: { pin: string; quizId: string },
    ack: (res: { ok: boolean }) => void,
  ) => void;
  /**
   * Back to the room's lobby, with no quiz chosen: from the podium, or stopping the quiz
   * in progress. `archive` keeps what was played (archived, counted in the room's standings).
   */
  'host:back-to-lobby': (
    p: { pin: string; archive?: boolean },
    ack: (res: { ok: boolean }) => void,
  ) => void;
  /**
   * (Dé)active la capture intégrale des réponses depuis le lobby, **avant** le
   * démarrage (RG-13). Refusé une fois la partie lancée. Les joueurs connectés en
   * sont informés en direct via `notice`.
   */
  'host:capture': (p: { pin: string; fullCapture: boolean }) => void;
  /**
   * Closes the game to new participants (`locked:true`), or reopens it. Those
   * already in, reconnections included, are not affected. Until the game ends.
   */
  'host:lock': (p: { pin: string; locked: boolean }) => void;
  /**
   * Règle les deux autres options de session depuis le lobby, **avant** le
   * démarrage (RG-15, RG-16) : suivi individuel et nom affiché choisi. Refusé une
   * fois la partie lancée ; les joueurs connectés voient l'avis changer (`notice`).
   */
  'host:options': (p: {
    pin: string;
    personalTracking?: boolean;
    pickOwnName?: boolean;
    /** Replaces the quiz's default audio target for this game (questions with their own keep it). */
    audioTarget?: AudioTarget;
    /** The language of the audience's screens for the whole room (#209); '' = each quiz's. */
    audienceLanguage?: string;
  }) => void;
  /** Bascule le rythme manuel/auto en cours de partie (§8). */
  'host:mode': (p: { pin: string; mode: GameMode }) => void;
  /** Suspend (`paused:true`) ou reprend (`paused:false`) l'auto-progression. */
  'host:pause': (p: { pin: string; paused: boolean }) => void;
  /** Steer the current step's sound or video (a question's, a slide's) on every device that plays it: restart, play, pause, seek. */
  'host:media': (p: HostMediaCommand) => void;
  /** Ajoute/retire `deltaS` secondes au chrono de la question courante. */
  'host:adjust-time': (p: { pin: string; deltaS: number }) => void;
  /** Rejoint la room en lecture seule (fenêtre projetée) — aucune auth, le PIN suffit. */
  /**
   * A projection window joins read-only. `follow`: a participant's copy of it on
   * another device (#104) — it follows the projection's position, is never waited
   * for, and never speaks for the sound.
   */
  'spectator:join': (
    p: { pin: string; follow?: boolean },
    ack: (res: { ok: boolean }) => void,
  ) => void;
  /**
   * Before joining: whether the quiz plays sound, so the join form offers the
   * presence choice, and whether an account is needed to get in.
   */
  'player:peek': (p: { pin: string }, ack: (res: PlayerPeek) => void) => void;
  'player:join': (
    p: {
      pin: string;
      nickname: string;
      authToken?: string;
      avatar?: string;
      /** `room` when absent, and whenever the quiz plays no sound. */
      presence?: PlayerPresence;
    },
    /**
     * `nickname` est celui **retenu par le serveur** : le pseudo saisi, ou le nom
     * du compte quand l'hôte n'ouvre pas le choix (RG-15), suffixé en cas
     * d'homonyme. Le client affiche celui-là, sinon il montrerait au participant
     * un nom que personne d'autre ne voit.
     */
    ack: (res: { sessionToken: string; playerId: string; nickname: string }) => void,
  ) => void;
  'player:reconnect': (p: { sessionToken: string }, ack: (res: { ok: boolean }) => void) => void;
  /** Change la graine d'avatar (cosmétique) — accepté uniquement avant le démarrage. */
  'player:avatar': (p: { pin: string; avatar: string }) => void;
  'player:submit': (p: { pin: string; questionIndex: number; answer: AnswerValue }) => void;
  /**
   * Avis de fin de partie : note Likert 1..5 + commentaire facultatif. Recevable
   * seulement quand la partie est terminée (PODIUM/ENDED) ; `ack.ok=false` sinon.
   */
  'player:rate': (
    p: { pin: string; rating: number; comment?: string },
    ack: (res: { ok: boolean }) => void,
  ) => void;
  /** A device has loaded the sound or video it fetched ahead of `questionIndex`. */
  'media:ready': (p: { pin: string; questionIndex: number; slideIndex?: number }) => void;
  /** The projection's playback position of the current sound (relayed to the room). */
  'media:position': (p: { pin: string } & MediaPositionPayload) => void;
  ping: (p: { t0: number }) => void;
}

/** What a game records and who may get in: the notice every screen of the room receives. */
export interface SessionNotice {
  fullCapture: boolean;
  personalTracking: boolean;
  pickOwnName: boolean;
  /** Fixed at creation (#57). */
  participantAccess: ParticipantAccess;
  /** Closed to new participants by the host. */
  joinLocked: boolean;
}

/** The room waits for media before a step (a question, or the slide `slideIndex`), until `until`. */
export interface MediaWaitPayload {
  questionIndex: number;
  slideIndex?: number;
  until: number;
}

/** Map des events serveur → client. */

/**
 * Where the host put the current question's media, from the console: at `t`
 * seconds when the server's clock read `at`, playing on from there or held.
 * Every device that plays it lands on the same point, late ones included.
 */
export interface MediaAnchor {
  t: number;
  at: number;
  playing: boolean;
}
export interface MediaControlPayload extends MediaAnchor {
  questionIndex: number;
  /** The media of the slide `slideIndex`, not of the question (#125). */
  slideIndex?: number;
}
/** The host's command on the question's media: `t` for play, pause and seek (seconds). */
export interface HostMediaCommand {
  pin: string;
  action: 'restart' | 'play' | 'pause' | 'seek';
  t?: number;
  /** For a seek: whether it plays on from there (a held media stays held). */
  playing?: boolean;
}

/**
 * Why an answer was not counted: `closed` (the question is over, or another
 * one runs), `early` (the answers are not open yet), `late` (past the time),
 * `unknown` (not a player of this quiz), `duplicate` (an earlier answer counts).
 */
export type AnswerRefusal = 'closed' | 'early' | 'late' | 'unknown' | 'duplicate';
export interface AnswerAck {
  accepted: boolean;
  receivedAt: number;
  /** Set when `accepted` is false. */
  reason?: AnswerRefusal;
}

export interface ServerToClientEvents {
  /**
   * Avis de transparence (§2.10, RG-16) : ce que la session enregistre. Les deux
   * drapeaux décident du texte affiché aux participants.
   */
  notice: (p: SessionNotice) => void;
  'player:joined': (p: {
    playerId: string;
    nickname: string;
    playerCount: number;
    avatar?: string;
    presence?: PlayerPresence;
  }) => void;
  'player:left': (p: { playerId: string; playerCount: number }) => void;
  /** Le joueur a été banni par l'hôte : son client affiche l'exclusion (durée en minutes). */
  kicked: (p: { minutes: number }) => void;
  /** Instantané du lobby (joueurs connectés) renvoyé à un socket qui se (ré)attache (§6). */
  'game:roster': (p: {
    players: { playerId: string; nickname: string; avatar?: string; presence?: PlayerPresence }[];
  }) => void;
  'game:state': (p: GameStatePayload) => void;
  'question:start': (p: QuestionStartPayload) => void;
  /** A content slide is shown (state `SLIDE_SHOW`, #7); re-sent on (re)attach. */
  'slide:show': (p: SlideShowPayload) => void;
  'answer:ack': (p: AnswerAck) => void;
  'answer:count': (p: { answered: number; total: number }) => void;
  'question:reveal': (p: QuestionRevealPayload) => void;
  leaderboard: (p: LeaderboardPayload) => void;
  'game:podium': (p: PodiumPayload) => void;
  /**
   * The room's own name (null = the default the screens show, "<host>'s room")
   * and its host's name: on attach, and when the host renames it in the lobby.
   */
  'room:info': (p: { name: string | null; hostName: string }) => void;
  /** The room's game sounds (#93): on attach, and when the host changes them. */
  'room:sounds': (p: RoomSoundsPayload) => void;
  /**
   * Whether the room's screens move between steps (UI system §1.8): on attach, and
   * when the host switches it. A new room starts from the instance's `LIVE_MOTION`.
   */
  'room:motion': (p: { on: boolean }) => void;
  /** To a participant back in a lobby: whether they already said they are ready (#104). */
  'lobby:you': (p: { ready: boolean }) => void;
  /** To the participants in a lobby (#104): how many said they are ready, out of how many. */
  'lobby:count': (p: { ready: number; total: number }) => void;
  /** The room's standings: at a podium, in the lobby of the next quiz, and when the room closes. */
  'room:standings': (p: RoomStandingsPayload) => void;
  /** Every player's quiz and room scores (#198), to the host's console only. */
  'game:scores': (p: HostScoresPayload) => void;
  /** The next quiz's lobby starts on its own at `startAt` (ms epoch, #198); null = no countdown. */
  'lobby:countdown': (p: { startAt: number | null }) => void;
  /** `quizId`: the quiz that ended, which a rating goes to (several share a room's PIN). */
  'game:ended': (p: { feedbackEnabled?: boolean; quizId?: string }) => void;
  /** Mode/pause courants (à chaque changement et au (ré)attache). */
  'game:mode': (p: GameModePayload) => void;
  /** Base URL of the invitations chosen by the host (null = the page's own origin). */
  'game:join-url': (p: { baseUrl: string | null }) => void;
  /** Sommaire des questions — émis aux seules fenêtres de contrôle hôte. */
  'game:outline': (p: GameOutlinePayload) => void;
  /** Timing recalculé de la question courante (ajustement du chrono). */
  'question:time': (p: QuestionTimePayload) => void;
  /**
   * The media of the next question, sent in the lobby (the first one) and with
   * the reveal of the current one, so a device fetches them while the room waits
   * and plays them at once. Each device gets only what it will show or play.
   */
  'media:preload': (p: MediaPreloadPayload) => void;
  /** Who has loaded the upcoming question's sound or video (screens only). */
  'media:readiness': (p: MediaReadinessPayload) => void;
  /** The room waits for media before question `questionIndex`, until `until` (server ms epoch). */
  'media:wait': (p: MediaWaitPayload) => void;
  /** Where the projection is in the current sound: the other screens draw their playhead there. */
  'media:position': (p: MediaPositionPayload) => void;
  /** Where the host put the current step's media: restart, play, pause, seek. */
  'media:control': (p: MediaControlPayload) => void;
  /**
   * Whether the quiz plays any sound (an MP3, a video), sent on attach to every
   * device: the projection (and a phone that never enabled it) then asks for the
   * click that unlocks sound, whatever the moment of the session — the room's
   * next quiz may play sound where the first did not (#89).
   */
  'game:media': (p: {
    /** The quiz's title: the room's projection shows the quiz coming next. */
    title?: string;
    hasSound: boolean;
    /** Whether any question or slide carries a media (the lobby then says they are sent ahead). */
    hasMedia: boolean;
    /** The game's default audio target: the host's lobby choice, else the quiz's. */
    audioTarget: AudioTarget;
    /**
     * The language of the audience's screens (#209), a BCP 47 tag: the host's choice for
     * the room, else the quiz's.
     */
    language: string;
    /** The host's choice for the room (#209); '' = each quiz's. Read by the console. */
    roomLanguage: string;
  }) => void;
  /**
   * Erreur typée. **Token uniquement** : le backend n'émet qu'un `code` domaine
   * stable (ex. `session.not_found`) + d'éventuels `params` d'interpolation ; le
   * texte lisible est résolu côté client via le dictionnaire i18n (ADR 0001).
   */
  error: (p: { code: string; params?: Record<string, string | number> }) => void;
  pong: (p: { t0: number; t1: number }) => void;
}
