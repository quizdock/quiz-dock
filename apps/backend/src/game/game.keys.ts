import { GameState } from '@quiz-dock/contracts';

/** A game over, as the state reads it in Redis. */
const ENDED: string = GameState.Ended;

/** Durée de vie de l'état live d'une partie (~4 h — SPECIFICATIONS-DONNEES §4). */
export const GAME_TTL_S = 4 * 60 * 60;

/**
 * How often, at most, a room's answer count goes out while answers come in: ten
 * times a second, too quick to see; each answer still gets its tick (up to five
 * at once, `game/media/game-sounds.ts` on the screens).
 */
export const ANSWER_COUNT_EVERY_MS = 100;

/**
 * How far ahead the server sets the common start of a question's media (ms):
 * a second for the room to see the question before its sound or video starts,
 * and enough for the question to reach every device, which then starts on the
 * same instant of the server's clock.
 */
export const MEDIA_LEAD_MS = 1_600;

/** Tolérance serveur : réponses reçues après `endsAt + grace` rejetées (§6). */
export const GRACE_MS = 300;

/**
 * Plancher du chrono après un retrait de temps (`host:adjust-time`) : en deçà,
 * la question est révélée immédiatement plutôt que de laisser un timer mort.
 */
export const CHRONO_FLOOR_MS = 1_000;

/**
 * A game's id (`meta.id`): the key of everything one quiz played in a room
 * owns. Branded so a PIN can never be passed where a game is meant.
 */
export type GameId = string & { readonly __gameId: unique symbol };

/** A game hash: `game:` then the 32 hex characters of its id (never a PIN). */
export const GAME_HASH_KEY = /^game:[0-9a-f]{32}$/;

/** A room hash: `room:` then its PIN. */
export const ROOM_HASH_KEY = /^room:\d+$/;

/**
 * Redis keys of the live state (SPECIFICATIONS-DONNEES §4, SPECIFICATIONS-ROOM §3).
 * The room lives under its PIN: who is in, and what the players were told. Each
 * game (one quiz played in the room) lives under its own id, so nothing a game
 * leaves behind (a lock, an answer, a score) is ever read by the next one.
 */
export const gameKeys = {
  // ── Room (PIN) ──
  /** Atomic PIN allocation (value: the room id), self-expiring. */
  pin: (pin: string) => `pin:${pin}`,
  /** The room hash: host, current game, what the players were told (RoomMeta). */
  room: (pin: string) => `room:${pin}`,
  /** Hash playerId → who the player is (JSON PlayerRecord). */
  players: (pin: string) => `room:${pin}:players`,
  /** Set of the normalized nicknames (atomic deduplication). */
  nicknames: (pin: string) => `room:${pin}:nicknames`,
  /** A banned normalized nickname (self-expiring key = the ban's length, RG-12). */
  ban: (pin: string, normalized: string) => `room:${pin}:ban:${normalized}`,
  /** Player session token → { pin, playerId } (reconnection). */
  session: (token: string) => `session:${token}`,
  /** Hash gameId → what each player did in it (JSON), once the game is over: the standings. */
  played: (pin: string) => `room:${pin}:played`,
  /** Set of the quiz ids the room played to their end: the console marks them when picking the next. */
  playedQuizzes: (pin: string) => `room:${pin}:played-quizzes`,
  /** Hash playerId → their session token, so the room keeps them alive while it lives. */
  tokens: (pin: string) => `room:${pin}:tokens`,
  /** Set of a host's open rooms, by PIN (resumed from the dashboard §6.2). */
  hostGames: (userId: string) => `host:${userId}:games`,

  // ── Game (game id) ──
  /** The game hash: state machine, current step, timings, pace. */
  game: (id: GameId) => `game:${id}`,
  /** The quiz snapshot (JSON), right answers included, server side only. */
  snapshot: (id: GameId) => `game:${id}:snapshot`,
  /** Hash playerId → { score, streak } in this game; its keys are who plays it. */
  scores: (id: GameId) => `game:${id}:scores`,
  /** Hash playerId → graded answer (HSETNX = the first answer wins, RG-06). */
  answers: (id: GameId, questionIndex: number) => `game:${id}:answers:${questionIndex}`,
  /** Set of the players who said they are ready in this game's lobby (#104). */
  pressed: (id: GameId) => `game:${id}:pressed`,
  /**
   * Set of the devices (playerId, or `screen:<socket id>`) that loaded a step's
   * sound or video. Step = question index, or `s<slideIndex>` for a slide (#125).
   */
  ready: (id: GameId, step: number | string) => `game:${id}:ready:${step}`,
  /** One way out of the media wait of a step (all ready, cap, host, resumed). */
  mediaWaitLock: (id: GameId, step: number | string) => `game:${id}:media-wait-lock:${step}`,
  /** Atomic lock of the move to REVEAL (one winner, no double reveal). */
  revealLock: (id: GameId, questionIndex: number) => `game:${id}:reveal-lock:${questionIndex}`,
  /** Where the host put a step's media (`MediaAnchor` JSON), replayed to late screens. */
  mediaAnchor: (id: GameId, step: number | string) => `game:${id}:media-anchor:${step}`,
  /**
   * Atomic lock of the move to the next step (no double click). Step = question
   * index, or `s<slideIndex>` for a content slide (#7).
   */
  advanceLock: (id: GameId, step: number | string) => `game:${id}:advance-lock:${step}`,
};

/** What `currentGameFields` needs of a Redis client (the CLI passes a bare one). */
export interface LiveReader {
  hget(key: string, field: string): Promise<string | null>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
}

/**
 * Fields of the game a room is playing, read from its PIN; all null when the
 * room is gone or has no game.
 */
export async function currentGameFields(
  redis: LiveReader,
  pin: string,
  ...fields: string[]
): Promise<(string | null)[]> {
  const gameId = await redis.hget(gameKeys.room(pin), 'gameId');
  if (!gameId) return fields.map(() => null);
  return redis.hmget(gameKeys.game(gameId as GameId), ...fields);
}

/** The PIN of the room where `ownerId` is playing `quizId` right now, or null. */
export async function livePinOf(
  redis: LiveReader & { smembers(key: string): Promise<string[]> },
  ownerId: string,
  quizId: string,
): Promise<string | null> {
  for (const pin of await redis.smembers(gameKeys.hostGames(ownerId))) {
    const [state, playing] = await currentGameFields(redis, pin, 'state', 'quizId');
    if (playing === quizId && state && state !== ENDED) return pin;
  }
  return null;
}
