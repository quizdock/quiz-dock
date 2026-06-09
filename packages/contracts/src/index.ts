/**
 * @roux-quizz/contracts
 *
 * Source de vérité partagée front/back pour le contrat temps réel (WebSocket)
 * et les énumérations du domaine. Voir specifications/SPECIFICATIONS.md §9
 * et specifications/SPECIFICATIONS-DONNEES.md §3.
 *
 * v0.1.0 : squelette — les payloads complets seront ajoutés en phase Jeu de base (v0.3.0).
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
  HostStart: 'host:start',
  HostNext: 'host:next',
  HostReveal: 'host:reveal',
  HostKick: 'host:kick',
  HostEnd: 'host:end',
  PlayerJoin: 'player:join',
  PlayerReconnect: 'player:reconnect',
  PlayerSubmit: 'player:submit',
  Ping: 'ping',
} as const;

export const ServerEvents = {
  GameCreated: 'game:created',
  PlayerJoined: 'player:joined',
  PlayerLeft: 'player:left',
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
