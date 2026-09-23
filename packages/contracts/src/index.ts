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

export * from './media-sniff';
export * from './question-media';
import type { AudioTarget, LiveQuestionMedia } from './question-media';

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

/** Noms des événements WebSocket (technique §9). */
export const ClientEvents = {
  HostCreate: 'host:create',
  HostAttach: 'host:attach',
  HostStart: 'host:start',
  HostNext: 'host:next',
  HostReview: 'host:review',
  HostJoinUrl: 'host:join-url',
  HostReveal: 'host:reveal',
  HostKick: 'host:kick',
  HostEnd: 'host:end',
  /** Bannit un joueur pour une durée donnée (exclusion immédiate, RG-12). */
  HostBan: 'host:ban',
  /** (Dé)active la capture intégrale depuis le lobby, avant le démarrage (RG-13). */
  HostCapture: 'host:capture',
  /** Bascule manuel/auto en cours de partie (le présentateur reprend la main). */
  HostMode: 'host:mode',
  /** Suspend/reprend l'auto-progression (et gèle le chrono en ANSWERING). */
  HostPause: 'host:pause',
  /** Host control over the current question's media (restart it from the top). */
  HostMedia: 'host:media',
  /** Ajoute/retire du temps au chrono de la question courante (± secondes). */
  HostAdjustTime: 'host:adjust-time',
  SpectatorJoin: 'spectator:join',
  /** What a player needs to know before joining (whether the quiz plays sound). */
  PlayerPeek: 'player:peek',
  PlayerJoin: 'player:join',
  PlayerReconnect: 'player:reconnect',
  /** Change la graine d'avatar avant le démarrage (cosmétique). */
  PlayerAvatar: 'player:avatar',
  PlayerSubmit: 'player:submit',
  /** A device has loaded what it fetched ahead of a question. */
  MediaReady: 'media:ready',
  /** Avis du joueur en fin de partie (note Likert 5 + commentaire facultatif). */
  PlayerRate: 'player:rate',
  Ping: 'ping',
} as const;

export const ServerEvents = {
  GameCreated: 'game:created',
  PlayerJoined: 'player:joined',
  PlayerLeft: 'player:left',
  GameRoster: 'game:roster',
  GameState: 'game:state',
  QuestionStart: 'question:start',
  AnswerAck: 'answer:ack',
  AnswerCount: 'answer:count',
  QuestionReveal: 'question:reveal',
  Leaderboard: 'leaderboard',
  GamePodium: 'game:podium',
  GameEnded: 'game:ended',
  /** Mode/pause courants (diffusé à chaque changement + à l'attache). */
  GameMode: 'game:mode',
  /** Sommaire des questions — réservé aux fenêtres de **contrôle hôte**. */
  GameOutline: 'game:outline',
  /** Nouveau timing de la question courante (ajustement du chrono). */
  QuestionTime: 'question:time',
  /** Media of the next question, to fetch ahead (projection and console only). */
  MediaPreload: 'media:preload',
  /** Which devices have loaded the upcoming question's sound or video (screens only). */
  MediaReadiness: 'media:readiness',
  /** A host command on the current question's media, relayed to the screens. */
  MediaControl: 'media:control',
  /** What the quiz's media need from a screen (sent on attach, not to players). */
  GameMedia: 'game:media',
  Notice: 'notice',
  Error: 'error',
  Pong: 'pong',
} as const;

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

export interface QuestionStartPayload {
  questionIndex: number;
  type: QuestionType;
  prompt: string;
  /** Visual and sound of the question; both null when it has none. */
  media: LiveQuestionMedia;
  /** Which devices play its sound, resolved for this game (present when it has one). */
  audioTarget?: AudioTarget;
  options?: PublicOption[];
  timeLimitS: number;
  basePoints: number;
  /** Scoring rule of the question (so the rules line and the reveal can explain it). */
  scoring?: QuestionScoring;
  startedAt: number; // ms epoch serveur (§6)
  endsAt: number;
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
}

/** The media of question `questionIndex`, to fetch ahead of it. */
/**
 * What a device fetches ahead: the next question's media — only those this
 * device will show or play — and the images of the slides before it. Never
 * the prompt nor the options: the question itself stays unknown.
 */
export interface MediaPreloadPayload {
  questionIndex: number;
  media: LiveQuestionMedia;
  /** Which devices will play its sound (present when it has one). */
  audioTarget?: AudioTarget;
  /** Images of the slides shown before that question. */
  images?: string[];
}

/**
 * Who has loaded the sound or video of an upcoming question. Counted: the
 * projection windows, and the participants whose device will play a sound or
 * a video (remote ones; in the room, only when the sound is for every device).
 * Images are not waited for.
 */
export interface MediaReadinessPayload {
  questionIndex: number;
  /** Counted devices ready, out of all of them (screens and participants). */
  ready: number;
  total: number;
  /** The participants counted, ready or not (the console lists them). */
  players: { playerId: string; ready: boolean }[];
  /** The projection windows counted. */
  screens: { ready: number; total: number };
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

/** Sommaire du quiz pour la console hôte (récap + carrousel d'avancement). */
export interface GameOutlinePayload {
  /** Quiz being played — the host console links back to its editor. */
  quizId: string;
  title: string;
  description: string | null;
  questions: OutlineQuestion[];
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

export interface PodiumPayload {
  podium: LeaderboardRow[];
  you?: { score: number; rank: number };
  /** Whether the end-of-session rating panel is offered (§2.11); absent = yes. */
  feedbackEnabled?: boolean;
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
    },
    ack: (res: { pin: string }) => void,
  ) => void;
  /** Rebinde un hôte authentifié propriétaire à sa partie (reconnexion / 2ᵉ fenêtre de contrôle). */
  'host:attach': (p: { pin: string }, ack: (res: { ok: boolean }) => void) => void;
  'host:start': (p: { pin: string }) => void;
  'host:next': (p: { pin: string }) => void;
  /** Show a played step again (no replay, no rescoring); `host:next` resumes. */
  'host:review': (p: { pin: string } & GameStep) => void;
  /** Base URL the invitations (QR, link) point at; lobby only. */
  'host:join-url': (p: { pin: string; baseUrl: string }) => void;
  'host:reveal': (p: { pin: string }) => void;
  'host:kick': (p: { pin: string; playerId: string }) => void;
  /**
   * Bannit un joueur pour `minutes` minutes : exclusion immédiate (déconnecté +
   * retiré du classement) et re-join refusé tant que le ban court (RG-12).
   */
  'host:ban': (p: { pin: string; playerId: string; minutes: number }) => void;
  /** Termine la partie. `archive:true` → persiste les résultats avant destruction. */
  'host:end': (p: { pin: string; archive?: boolean }) => void;
  /**
   * (Dé)active la capture intégrale des réponses depuis le lobby, **avant** le
   * démarrage (RG-13). Refusé une fois la partie lancée. Les joueurs connectés en
   * sont informés en direct via `notice`.
   */
  'host:capture': (p: { pin: string; fullCapture: boolean }) => void;
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
  }) => void;
  /** Bascule le rythme manuel/auto en cours de partie (§8). */
  'host:mode': (p: { pin: string; mode: GameMode }) => void;
  /** Suspend (`paused:true`) ou reprend (`paused:false`) l'auto-progression. */
  'host:pause': (p: { pin: string; paused: boolean }) => void;
  /** Restart the current question's sound or video from the top, on the projection. */
  'host:media': (p: { pin: string; action: 'restart' }) => void;
  /** Ajoute/retire `deltaS` secondes au chrono de la question courante. */
  'host:adjust-time': (p: { pin: string; deltaS: number }) => void;
  /** Rejoint la room en lecture seule (fenêtre projetée) — aucune auth, le PIN suffit. */
  'spectator:join': (p: { pin: string }, ack: (res: { ok: boolean }) => void) => void;
  /** Before joining: whether the quiz plays sound, so the join form offers the presence choice. */
  'player:peek': (p: { pin: string }, ack: (res: { hasSound: boolean }) => void) => void;
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
  'media:ready': (p: { pin: string; questionIndex: number }) => void;
  ping: (p: { t0: number }) => void;
}

/** Map des events serveur → client. */
export interface ServerToClientEvents {
  'game:created': (p: { pin: string }) => void;
  /**
   * Avis de transparence (§2.10, RG-16) : ce que la session enregistre. Les deux
   * drapeaux décident du texte affiché aux participants.
   */
  notice: (p: { fullCapture: boolean; personalTracking: boolean; pickOwnName: boolean }) => void;
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
  'answer:ack': (p: { accepted: boolean; receivedAt: number }) => void;
  'answer:count': (p: { answered: number; total: number }) => void;
  'question:reveal': (p: QuestionRevealPayload) => void;
  leaderboard: (p: LeaderboardPayload) => void;
  'game:podium': (p: PodiumPayload) => void;
  'game:ended': (p: { feedbackEnabled?: boolean }) => void;
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
  /** The host restarts the current question's media from the top. */
  'media:control': (p: { questionIndex: number; action: 'restart' }) => void;
  /**
   * Whether the quiz plays any sound (an MP3, a video), sent on attach to the
   * screens that are not players: the projection then asks for the click that
   * unlocks sound as soon as it opens, whatever the moment of the session.
   */
  'game:media': (p: {
    hasSound: boolean;
    /** Whether any question or slide carries a media (the lobby then says they are sent ahead). */
    hasMedia: boolean;
    /** The game's default audio target: the host's lobby choice, else the quiz's. */
    audioTarget: AudioTarget;
  }) => void;
  /**
   * Erreur typée. **Token uniquement** : le backend n'émet qu'un `code` domaine
   * stable (ex. `session.not_found`) + d'éventuels `params` d'interpolation ; le
   * texte lisible est résolu côté client via le dictionnaire i18n (ADR 0001).
   */
  error: (p: { code: string; params?: Record<string, string | number> }) => void;
  pong: (p: { t0: number; t1: number }) => void;
}
