import { AUDIO_TARGETS, type AudioTarget } from '@quiz-dock/contracts';
import type { GameId } from './game.keys';
import { liveMotionDefault } from './live-motion';
import { DEFAULT_ROOM_SOUNDS, type GameFields, type RoomMeta, type RoomSounds } from './game.types';

/**
 * How a room's and a game's fields sit in their Redis hashes, every one a
 * string: a flag as '1' or '0', a number as text, no value (null) as '', an
 * object as JSON. The same rule for a whole new hash and for the few fields a
 * step changes, so a field name is checked and never encoded by hand.
 */
type HashFields<T> = { [K in keyof T]?: T[K] | null };

function toHash(fields: object): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields) as [string, unknown][]) {
    if (value === undefined) continue;
    raw[name] =
      value === null
        ? ''
        : typeof value === 'boolean'
          ? value
            ? '1'
            : '0'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
  }
  return raw;
}

/** Room fields to write: all of a new room, or those that change. */
export function roomHash(fields: HashFields<RoomMeta>): Record<string, string> {
  return toHash(fields);
}

/** Game fields to write: all of a new game, or those a step changes. */
export function gameHash(fields: HashFields<GameFields>): Record<string, string> {
  return toHash(fields);
}

/** A room as its hash holds it. */
export function deserializeRoom(raw: Record<string, string>): RoomMeta {
  return {
    roomId: raw.roomId,
    hostUserId: raw.hostUserId,
    gameId: raw.gameId as GameId,
    ...(raw.previousGameId ? { previousGameId: raw.previousGameId as GameId } : {}),
    fullCapture: raw.fullCapture === '1',
    personalTracking: raw.personalTracking !== '0',
    pickOwnName: raw.pickOwnName === '1',
    participantAccess: raw.participantAccess === 'open' ? 'open' : 'account',
    joinLocked: raw.joinLocked === '1',
    joinBaseUrl: raw.joinBaseUrl ?? '',
    openedAt: Number(raw.openedAt),
    name: raw.name ?? '',
    hostName: raw.hostName ?? '',
    sounds: raw.sounds
      ? { ...DEFAULT_ROOM_SOUNDS, ...(JSON.parse(raw.sounds) as Partial<RoomSounds>) }
      : DEFAULT_ROOM_SOUNDS,
    // A room opened before the setting existed follows the instance.
    motion: raw.motion === undefined ? liveMotionDefault() : raw.motion === '1',
    audienceLanguage: raw.audienceLanguage ?? '',
  };
}

/** A game as its hash holds it (defaults for the fields a step never wrote). */
export function deserializeGame(raw: Record<string, string>): GameFields {
  return {
    quizId: raw.quizId,
    state: raw.state,
    currentIndex: Number(raw.currentIndex),
    totalQuestions: Number(raw.totalQuestions),
    audioTarget: (AUDIO_TARGETS as readonly string[]).includes(raw.audioTarget ?? '')
      ? (raw.audioTarget as AudioTarget)
      : '',
    mediaWaitUntil: raw.mediaWaitUntil ? Number(raw.mediaWaitUntil) : 0,
    lobbyStartAt: raw.lobbyStartAt ? Number(raw.lobbyStartAt) : 0,
    mediaLeadMs: raw.mediaLeadMs ? Number(raw.mediaLeadMs) : null,
    title: raw.title,
    language: raw.language,
    createdAt: Number(raw.createdAt),
    questionStartedAt: Number(raw.questionStartedAt ?? 0),
    questionEndsAt: Number(raw.questionEndsAt ?? 0),
    mode: raw.mode === 'auto' ? 'auto' : 'manual',
    paused: raw.paused === '1',
    clockFrozen: raw.clockFrozen === '1',
    autoNextAt: raw.autoNextAt ? Number(raw.autoNextAt) : 0,
    autoNextMs: raw.autoNextMs ? Number(raw.autoNextMs) : 0,
    slideIndex: raw.slideIndex ? Number(raw.slideIndex) : -1,
    slideMediaStartAt: raw.slideMediaStartAt ? Number(raw.slideMediaStartAt) : 0,
    slidePausedAt: raw.slidePausedAt ? Number(raw.slidePausedAt) : 0,
    prevState: raw.prevState,
    pausedRemainingMs: raw.pausedRemainingMs ? Number(raw.pausedRemainingMs) : undefined,
    reviewStep: raw.reviewStep ?? '',
  };
}
