/**
 * @roux-quizz/contracts
 *
 * Source de vérité partagée front/back pour le contrat temps réel (WebSocket)
 * et les énumérations du domaine. Voir specifications/SPECIFICATIONS.md §9
 * et specifications/SPECIFICATIONS-DONNEES.md §3.
 *
 * Inclut les énumérations du domaine, les noms d'événements et les **payloads typés**
 * (maps `ClientToServerEvents`/`ServerToClientEvents`) du contrat temps réel.
 */

export const CONTRACTS_VERSION = '0.1.0' as const;

/** États de la partie (machine à états — technique §8). */
export enum GameState {
  Lobby = 'LOBBY',
  QuestionShow = 'QUESTION_SHOW',
  Answering = 'ANSWERING',
  Reveal = 'REVEAL',
  Leaderboard = 'LEADERBOARD',
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
}

/** Couleurs/formes des options — accessibilité couleur + forme (technique §4). */
export enum OptionColor {
  Red = 'red',
  Blue = 'blue',
  Yellow = 'yellow',
  Green = 'green',
}

export enum OptionShape {
  Triangle = 'triangle',
  Diamond = 'diamond',
  Circle = 'circle',
  Square = 'square',
}

/** Noms des événements WebSocket (technique §9). */
export const ClientEvents = {
  HostCreate: 'host:create',
  HostAttach: 'host:attach',
  HostStart: 'host:start',
  HostNext: 'host:next',
  HostReveal: 'host:reveal',
  HostKick: 'host:kick',
  HostEnd: 'host:end',
  SpectatorJoin: 'spectator:join',
  PlayerJoin: 'player:join',
  PlayerReconnect: 'player:reconnect',
  PlayerSubmit: 'player:submit',
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
  Notice: 'notice',
  Error: 'error',
  Pong: 'pong',
} as const;

// ─── Payloads WebSocket (technique §9) ──────────────────────────────────────
// Source de vérité du contrat temps réel, typée bout-en-bout (back + front).

/** Réponse d'un joueur : option(s), texte, nombre, ou séquence d'ordre. */
export type AnswerValue = string | string[] | number;

/** Option telle qu'EXPOSÉE au joueur — JAMAIS de flag correct (anti-triche §7). */
export interface PublicOption {
  id: string;
  text?: string | null;
  color: OptionColor;
  shape: OptionShape;
  media?: { url: string; kind: 'image' | 'audio' } | null;
}

export interface QuestionStartPayload {
  questionIndex: number;
  type: QuestionType;
  prompt: string;
  media?: { url: string; kind: 'image' | 'audio' } | null;
  options?: PublicOption[];
  timeLimitS: number;
  basePoints: number;
  startedAt: number; // ms epoch serveur (§6)
  endsAt: number;
}

export interface GameStatePayload {
  state: GameState;
  questionIndex: number;
  totalQuestions: number;
}

export interface PersonalResult {
  correct: boolean;
  points: number;
  totalScore: number;
  rank: number;
}

export interface QuestionRevealPayload {
  correctOptionIds?: string[];
  correctValue?: number | string | string[];
  distribution: Record<string, number>;
  yourResult?: PersonalResult;
}

export interface LeaderboardRow {
  nickname: string;
  score: number;
  rank: number;
}

export interface LeaderboardPayload {
  top: LeaderboardRow[];
  you?: { score: number; rank: number };
}

export interface PodiumPayload {
  podium: LeaderboardRow[];
  you?: { score: number; rank: number };
}

/** Map des events client → serveur (avec accusés de réception typés). */
export interface ClientToServerEvents {
  'host:create': (
    p: { quizId: string; fullCapture?: boolean },
    ack: (res: { pin: string }) => void,
  ) => void;
  /** Rebinde un hôte authentifié propriétaire à sa partie (reconnexion / 2ᵉ fenêtre de contrôle). */
  'host:attach': (p: { pin: string }, ack: (res: { ok: boolean }) => void) => void;
  'host:start': (p: { pin: string }) => void;
  'host:next': (p: { pin: string }) => void;
  'host:reveal': (p: { pin: string }) => void;
  'host:kick': (p: { pin: string; playerId: string }) => void;
  'host:end': (p: { pin: string }) => void;
  /** Rejoint la room en lecture seule (fenêtre projetée) — aucune auth, le PIN suffit. */
  'spectator:join': (p: { pin: string }, ack: (res: { ok: boolean }) => void) => void;
  'player:join': (
    p: { pin: string; nickname: string; authToken?: string },
    ack: (res: { sessionToken: string; playerId: string }) => void,
  ) => void;
  'player:reconnect': (p: { sessionToken: string }, ack: (res: { ok: boolean }) => void) => void;
  'player:submit': (p: { pin: string; questionIndex: number; answer: AnswerValue }) => void;
  ping: (p: { t0: number }) => void;
}

/** Map des events serveur → client. */
export interface ServerToClientEvents {
  'game:created': (p: { pin: string }) => void;
  notice: (p: { fullCapture: true }) => void;
  'player:joined': (p: { playerId: string; nickname: string; playerCount: number }) => void;
  'player:left': (p: { playerId: string; playerCount: number }) => void;
  /** Instantané du lobby (joueurs connectés) renvoyé à un socket qui se (ré)attache (§6). */
  'game:roster': (p: { players: { playerId: string; nickname: string }[] }) => void;
  'game:state': (p: GameStatePayload) => void;
  'question:start': (p: QuestionStartPayload) => void;
  'answer:ack': (p: { accepted: boolean; receivedAt: number }) => void;
  'answer:count': (p: { answered: number; total: number }) => void;
  'question:reveal': (p: QuestionRevealPayload) => void;
  leaderboard: (p: LeaderboardPayload) => void;
  'game:podium': (p: PodiumPayload) => void;
  'game:ended': (p: Record<string, never>) => void;
  error: (p: { code: string; message: string }) => void;
  pong: (p: { t0: number; t1: number }) => void;
}
