import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AUDIO_TARGETS,
  LANGUAGE_RE,
  type AnswerAck,
  type AnswerRefusal,
  GameState,
  mediaDurationMs,
  slideHasPlayback,
  slideSoundMedia,
  SETTINGS,
} from '@quiz-dock/contracts';
import type {
  AnswerValue,
  AudioTarget,
  GameMode,
  GameModePayload,
  GameStep,
  HostMediaCommand,
  LiveQuestionMedia,
  MediaAnchor,
  MediaPreloadPayload,
  MediaReadinessPayload,
  PlayerPresence,
  QuestionRevealPayload,
  RoomSoundsPayload,
  RoomSoundsSettings,
  ServerToClientEvents,
} from '@quiz-dock/contracts';
import type { Server } from 'socket.io';
import { GameService, oneLine } from './game.service';
import {
  ANSWER_COUNT_EVERY_MS,
  CHRONO_FLOOR_MS,
  GAME_TTL_S,
  GRACE_MS,
  MEDIA_LEAD_MS,
  type GameId,
  ROOM_HASH_KEY,
  gameKeys,
} from './game.keys';
import { gameHash, roomHash } from './game-hash';
import type {
  AnswerRecord,
  GameMeta,
  PlayerRecord,
  QuizSnapshot,
  RoomSounds,
  SnapshotQuestion,
} from './game.types';
import { noticeOf } from './game.types';
import { RedisService } from '../redis/redis.service';
import { buildRevealCommon } from './reveal';
import { isDeferred, rankClosest, scoreAnswer } from './scoring';
import { SessionArchiveService } from './session-archive.service';
import { resumeQuestionWindow } from './chrono';
import {
  type PreloadDevice,
  type PreloadStep,
  firstStepOf,
  preloadFor,
  snapshotHasMedia,
  stepAfterSlide,
  stepHasPlayback,
  stepMediaForDevice,
} from './preload';
import {
  type Ranking,
  personalLeaderboard,
  personalPodium,
  personalReveal,
  rankingOf,
  scoreTable,
  topRows,
} from './results';
import { RoomTimers } from './room-timers';
import {
  buildQuestionStart,
  buildSlideShow,
  gameAudioTarget,
  hasSoundOrVideo,
  snapshotHasSound,
} from './snapshot';
import {
  isSettled,
  liveStepKey,
  mediaStepKey,
  navFor,
  parseStepKey,
  playedSteps,
  slideStep,
  standingsFollow,
  stepKey,
  stepRef,
  waitedStep,
} from './steps';
import { settings } from '../admin/settings/settings.service';

type GameServer = Server<Record<string, never>, ServerToClientEvents>;

/**
 * Records an answer (HSETNX) unless the question's reveal has taken its lock:
 * 1 recorded, 0 already answered, -1 too late (the reveal has started).
 */
const ANSWER_ONCE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
return redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])
`;

/** Auto-mode delay on a REVEAL when the question sets none (#6): env override, else constant. */
const defaultAutoAdvanceMs = () => settings.get(SETTINGS.GAME_AUTO_ADVANCE_MS);
/** How long the next quiz's lobby waits before it starts on its own (#198). */
const NEXT_QUIZ_COUNTDOWN_MS = 30_000;

/** The media's start derived from `startedAt`, as a payload fragment (empty when silent). */
function mediaStartOf(
  mediaLeadMs: number | null | undefined,
  startedAt: number,
): { mediaStartAt?: number } {
  return mediaLeadMs == null ? {} : { mediaStartAt: startedAt - mediaLeadMs };
}

/**
 * `question:start` of question `index` at these timings, for a screen that
 * (re)attaches or a room that resumes: the game's audio target and the media's
 * distance to the answers as the game keeps them.
 */
function questionStartOf(
  meta: GameMeta,
  snapshot: QuizSnapshot,
  index: number,
  startedAt: number,
  endsAt: number,
) {
  return buildQuestionStart(
    snapshot.questions[index],
    index,
    startedAt,
    endsAt,
    gameAudioTarget(snapshot, meta.audioTarget),
    meta.mediaLeadMs ?? null,
  );
}

/**
 * Cible d'émission unitaire : satisfaite à la fois par un `Socket` local (gateway)
 * et un `RemoteSocket` (`fetchSockets()`). Permet de partager le calcul du reveal
 * personnel entre la diffusion live et la relecture d'état (reconnexion / late join).
 */
interface Emitter {
  data: { playerId?: string; isHostControl?: boolean };
  emit<E extends keyof ServerToClientEvents>(
    ev: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): unknown;
}

/**
 * A game in its room: where to broadcast (`pin`) and whose state to touch
 * (`id`). Carried by everything that runs after an await or on a timer, so a
 * step of one game can never write into the next one the room plays.
 */
interface GameRef {
  pin: string;
  id: GameId;
}

const refOf = (pin: string, meta: GameMeta): GameRef => ({ pin, id: meta.id });

/**
 * Machine à états de la partie (SPECIFICATIONS §8). Le timer n'est qu'un
 * **déclencheur** vers `advanceToReveal`, transition rendue **idempotente** par un
 * verrou atomique Redis (NX) : les deux chemins de convergence (timer écoulé /
 * tous ont répondu) et `host:reveal` passent par le même verrou — 1 seul gagnant,
 * pas de double `reveal`. Mono-instance v1 : les timers vivent en mémoire (`RoomTimers`)
 * et sont ré-armés depuis Redis après un redémarrage (`recoverTimers`).
 */
@Injectable()
export class GameEngine {
  private readonly log = new Logger(GameEngine.name);
  private server!: GameServer;
  private readonly timers = new RoomTimers(this.log);
  /**
   * Per room, the host's clock commands (pause, resume, time added or taken) one
   * after the other: each reads the clock the last one wrote. Sent back to back,
   * a resume would otherwise write over the time just added. One process only.
   */
  private readonly clockCommands = new Map<string, Promise<unknown>>();
  /** Per room, when the answer count last went out, and whether one waits (`countAnswers`). */
  private readonly answerCounts = new Map<string, { at: number; waiting: boolean }>();

  constructor(
    private readonly game: GameService,
    private readonly redis: RedisService,
    private readonly archive: SessionArchiveService,
  ) {}

  /** Lié par le gateway dans `afterInit` (le serveur Socket.IO porte les rooms). */
  bindServer(server: GameServer): void {
    this.server = server;
    this.recoverTimers().catch((err: Error) => this.log.error(`recoverTimers: ${err.message}`));
  }

  /**
   * Timers live in this process: after a restart (deploy, crash, dev reload)
   * every session mid-question would stay stuck at the end of its countdown,
   * and auto-paced sessions would stop advancing. Re-arm them from Redis.
   */
  private async recoverTimers(): Promise<void> {
    const keys = await this.redis.scanKeys(gameKeys.room('*'));
    let armed = 0;
    for (const key of keys) {
      if (!ROOM_HASH_KEY.test(key)) continue;
      const pin = key.slice('room:'.length);
      const meta = await this.game.getMeta(pin);
      if (!meta) continue;
      const ref = refOf(pin, meta);
      if (meta.state === GameState.Answering && !meta.clockFrozen) {
        this.scheduleReveal(ref, meta.currentIndex, meta.questionEndsAt + GRACE_MS - Date.now());
        armed++;
      } else if (meta.state === GameState.MediaLoading) {
        this.armMediaWait(ref, waitedStep(meta), (meta.mediaWaitUntil ?? 0) - Date.now());
        armed++;
      } else if (meta.state === GameState.Lobby && meta.lobbyStartAt) {
        this.timers.arm('lobbyStart', pin, meta.lobbyStartAt - Date.now(), () =>
          this.startOnItsOwn(ref),
        );
        armed++;
      } else if (isSettled(meta.state) || meta.state === GameState.SlideShow) {
        if (meta.mode === 'auto' && !meta.paused && !meta.reviewStep) {
          await this.scheduleAutoNextIfNeeded(ref, meta);
          armed++;
        }
      }
      // The host's absence, timed again: a dead process never saw their socket go. A
      // room left without its host ends after its window; any other has its grace,
      // which the host's console cancels as it reconnects (`host:attach`).
      if (meta.state === GameState.HostDisconnected) {
        const windowMs = settings.get(SETTINGS.GAME_HOST_WINDOW_MS);
        this.timers.arm('hostWindow', pin, windowMs, () => this.endOrphaned(ref, meta.hostUserId));
      } else if (meta.state !== GameState.Ended) {
        const graceMs = settings.get(SETTINGS.GAME_HOST_GRACE_MS);
        this.timers.arm('hostGrace', pin, graceMs, () =>
          this.declareHostDisconnected(ref, meta.hostUserId),
        );
      }
    }
    if (armed > 0) this.log.log(`Recovered ${armed} live timer(s) after restart`);
  }

  /** `host:start` : LOBBY → 1re question. Garde propriété hôte + état. */
  async start(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.already_started');
    }
    await this.startQuiz(refOf(pin, meta), Boolean(meta.lobbyStartAt));
  }

  /**
   * The quiz's first step, once: the host's **Start**, the next quiz's countdown and
   * everyone being ready may all come at the same moment (#198).
   */
  private async startQuiz(ref: GameRef, counting: boolean): Promise<void> {
    if (!(await this.firstThrough(gameKeys.advanceLock(ref.id, 'start')))) return;
    if (counting) await this.clearLobbyCountdown(ref);
    const snapshot = await this.requireSnapshot(ref.id, true);
    await this.enterStep(ref, snapshot, 0);
  }

  /** The next quiz's lobby starts on its own (#198), in `NEXT_QUIZ_COUNTDOWN_MS`. */
  private async armLobbyCountdown(ref: GameRef, startAt: number): Promise<void> {
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ lobbyStartAt: startAt }));
    this.timers.arm('lobbyStart', ref.pin, startAt - Date.now(), () => this.startOnItsOwn(ref));
  }

  private async clearLobbyCountdown(ref: GameRef): Promise<void> {
    this.timers.cancel('lobbyStart', ref.pin);
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ lobbyStartAt: 0 }));
    this.server.to(ref.pin).emit('lobby:countdown', { startAt: null });
  }

  /** The countdown is over, or everyone is ready: the quiz starts if its lobby still waits. */
  private async startOnItsOwn(ref: GameRef): Promise<void> {
    const meta = await this.currentMeta(ref);
    if (!meta || meta.state !== GameState.Lobby || !meta.lobbyStartAt) return;
    await this.startQuiz(ref, true);
  }

  /** `host:lobby-countdown-stop` (#198): the host takes the floor; **Start** launches the quiz. */
  async stopLobbyCountdown(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby || !meta.lobbyStartAt) return;
    await this.clearLobbyCountdown(refOf(pin, meta));
  }

  /**
   * `host:capture` : (dé)active la capture intégrale **avant** le démarrage (RG-13).
   * Refusé une fois la partie lancée (la décision est figée au start). Met à jour la
   * meta Redis et informe en direct la room (le host reflète l'état, les joueurs déjà
   * connectés voient/retirent l'avis de consentement §2.10).
   */
  async setCapture(pin: string, hostUserId: string, fullCapture: boolean): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.capture_locked');
    }
    await this.redis.hset(gameKeys.room(pin), roomHash({ fullCapture }));
    this.server.to(pin).emit('notice', noticeOf({ ...meta, fullCapture }));
  }

  /**
   * `host:options` : suivi individuel et nom affiché choisi, réglés **avant** le
   * démarrage comme la capture (RG-15, RG-16) — ce que la session enregistre ne
   * change pas en cours de route. La room revoit l'avis correspondant.
   */
  async setOptions(
    pin: string,
    hostUserId: string,
    opts: {
      personalTracking?: boolean;
      pickOwnName?: boolean;
      audioTarget?: AudioTarget;
      audienceLanguage?: string;
    },
  ): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.options_locked');
    }
    if (opts.audienceLanguage !== undefined) {
      await this.setAudienceLanguage(refOf(pin, meta), opts.audienceLanguage);
    }
    if (opts.audioTarget !== undefined) {
      await this.setAudioTarget(refOf(pin, meta), opts.audioTarget);
    }
    if (opts.personalTracking === undefined && opts.pickOwnName === undefined) return;
    // Open access (#57): guests only — nothing personal to track, no account to
    // take a name from. The console greys both out; a client insisting is refused.
    if (
      meta.participantAccess === 'open' &&
      (opts.personalTracking === true || opts.pickOwnName === false)
    ) {
      throw new BadRequestException('session.open_access_guests_only');
    }
    const next = {
      ...meta,
      personalTracking: opts.personalTracking ?? meta.personalTracking,
      pickOwnName: opts.pickOwnName ?? meta.pickOwnName,
    };
    await this.redis.hset(
      gameKeys.room(pin),
      roomHash({ personalTracking: next.personalTracking, pickOwnName: next.pickOwnName }),
    );
    this.server.to(pin).emit('notice', noticeOf(next));
  }

  /**
   * `host:lock`: closes the game to new participants, or reopens it, until it
   * ends. Those already in keep playing and come back through a reconnection;
   * the console (and the phones) see the notice change.
   */
  async setJoinLocked(pin: string, hostUserId: string, locked: boolean): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state === GameState.Ended) {
      throw new BadRequestException('session.ended');
    }
    await this.redis.hset(gameKeys.room(pin), roomHash({ joinLocked: locked }));
    this.server.to(pin).emit('notice', noticeOf({ ...meta, joinLocked: locked }));
  }

  /**
   * The language of the audience's screens for the whole room (#209): a BCP 47 tag, or
   * '' for each quiz's own. Every screen is told; a tag that is not one is ignored.
   */
  private async setAudienceLanguage(ref: GameRef, language: string): Promise<void> {
    if (language !== '' && !(LANGUAGE_RE.test(language) && language.length <= 10)) return;
    await this.redis.hset(gameKeys.room(ref.pin), roomHash({ audienceLanguage: language }));
    const [snapshot, meta] = await Promise.all([
      this.game.getSnapshot(ref.id),
      this.game.getMeta(ref.pin),
    ]);
    if (!snapshot || !meta) return;
    this.server
      .to(ref.pin)
      .emit('game:media', await this.mediaPayload(ref.pin, snapshot, meta.audioTarget ?? ''));
  }

  /** What every device is told of the quiz it plays: its media, sound, and language. */
  private async mediaPayload(
    pin: string,
    snapshot: QuizSnapshot,
    audioTarget: AudioTarget | '',
  ): Promise<Parameters<ServerToClientEvents['game:media']>[0]> {
    const roomLanguage = (await this.game.getRoom(pin))?.audienceLanguage ?? '';
    return {
      title: snapshot.title,
      hasSound: snapshotHasSound(snapshot),
      hasMedia: snapshotHasMedia(snapshot),
      audioTarget: gameAudioTarget(snapshot, audioTarget),
      language: roomLanguage || snapshot.language,
      roomLanguage,
    };
  }

  /**
   * The host replaces the quiz's default audio target for this game; the
   * screens that are not players hear of it (the console shows the choice).
   */
  private async setAudioTarget(ref: GameRef, target: AudioTarget): Promise<void> {
    if (!AUDIO_TARGETS.includes(target)) return; // not one of ours: nothing to change
    const { pin } = ref;
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ audioTarget: target }));
    const snapshot = await this.game.getSnapshot(ref.id);
    if (!snapshot) return;
    // Every device: a phone that never enabled sound asks for it when the quiz has some.
    this.server.to(pin).emit('game:media', await this.mediaPayload(pin, snapshot, target));
    // Who needs what may have changed (the phones in the room, for every device).
    await this.emitPreload(ref, snapshot, firstStepOf(snapshot, 0));
    await this.broadcastReadiness(pin);
  }

  /**
   * Tells each device (or `only` one) what to fetch ahead of a step — a question
   * or a slide: only what it will show or play (see `preloadFor`), never the
   * question itself.
   */
  private async emitPreload(
    ref: GameRef,
    snapshot: QuizSnapshot,
    step: PreloadStep | null,
    only?: Emitter,
  ): Promise<void> {
    if (!step) return;
    const { pin } = ref;
    const gameTarget = await this.gameTarget(ref.id, snapshot);
    // The whole room: every record, read once. One device (a join): its record alone,
    // or each of 400 joins would decode the whole room again.
    const players = only ? null : await this.game.players(pin);
    const payloads = new Map<PreloadDevice, MediaPreloadPayload | null>();
    const sockets: Emitter[] = only ? [only] : await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = socket.data.playerId;
      const record = !playerId
        ? null
        : players
          ? players.get(playerId)
          : await this.game.getPlayer(pin, playerId);
      const device: PreloadDevice = !playerId ? 'screen' : (record?.presence ?? 'room');
      if (!payloads.has(device)) {
        payloads.set(device, preloadFor(snapshot, step, gameTarget, device));
      }
      const payload = payloads.get(device);
      if (payload) socket.emit('media:preload', payload);
    }
  }

  /**
   * The step the room gets ready for: the first in the lobby, the next at a reveal
   * or on a slide, the one waited for during a media wait.
   */
  private upcomingStep(meta: GameMeta, snapshot: QuizSnapshot): PreloadStep | null {
    if (meta.state === GameState.Lobby) return firstStepOf(snapshot, 0);
    if (meta.state === GameState.Reveal || meta.state === GameState.Leaderboard) {
      return firstStepOf(snapshot, meta.currentIndex + 1);
    }
    if (meta.state === GameState.SlideShow) return stepAfterSlide(snapshot, meta.slideIndex ?? -1);
    if (meta.state === GameState.MediaLoading) return waitedStep(meta);
    return { questionIndex: Math.max(0, meta.currentIndex) };
  }

  /**
   * `media:ready`: a device has loaded what it fetched ahead of a step (a
   * question, or the slide `slideIndex`); the screens see the count move.
   */
  async markMediaReady(
    pin: string,
    socket: { id: string; data: { playerId?: string } },
    questionIndex: number,
    slideIndex?: number,
  ): Promise<void> {
    if (!Number.isInteger(questionIndex) || questionIndex < 0) return;
    const slide = Number.isInteger(slideIndex) && slideIndex! >= 0 ? slideIndex : undefined;
    const meta = await this.game.getMeta(pin);
    if (!meta) return;
    // A step of this game only: any other index would leave a set behind for hours.
    if (
      slide === undefined
        ? questionIndex >= meta.totalQuestions
        : slide >= (await this.slideCount(meta))
    ) {
      return;
    }
    const device = socket.data.playerId ?? `screen:${socket.id}`;
    const key = gameKeys.ready(meta.id, mediaStepKey({ questionIndex, slideIndex: slide }));
    await this.redis.multi().sadd(key, device).expire(key, GAME_TTL_S).exec();
    await this.broadcastReadiness(pin);
  }

  private async slideCount(meta: GameMeta): Promise<number> {
    return (await this.game.getSnapshot(meta.id))?.slides.length ?? 0;
  }

  /**
   * Who is waited for, and who is ready, ahead of a step: the projection windows
   * when it has a sound or a video, and the connected participants whose device
   * will play one. Null past the last question.
   */
  async readiness(
    ref: GameRef,
    step: PreloadStep | null,
    /**
     * The lobby's count (#104): every participant of the game, ready once they
     * said so **and** their device has loaded what it plays; the screens apart.
     * Otherwise (the wait for media), only the devices that play something.
     */
    lobby = false,
  ): Promise<MediaReadinessPayload | null> {
    const { pin } = ref;
    const snapshot = await this.game.getSnapshot(ref.id);
    if (!snapshot || !step || !stepMediaForDevice(snapshot, step, 'projection', 'screen')) {
      return null;
    }
    const gameTarget = await this.gameTarget(ref.id, snapshot);
    const ready = new Set(await this.redis.smembers(gameKeys.ready(ref.id, mediaStepKey(step))));
    const sockets = await this.server.in(pin).fetchSockets();
    const screens = stepHasPlayback(snapshot, step)
      ? sockets.filter((s) => {
          const d = s.data as { playerId?: string; isHostControl?: boolean; follower?: boolean };
          // The projection windows; not a console, not a participant's copy (#104).
          return !d.playerId && !d.isHostControl && !d.follower;
        })
      : [];
    const screensReady = screens.filter((s) => ready.has(`screen:${s.id}`)).length;
    const players: { playerId: string; ready: boolean; pressed?: boolean }[] = [];
    // The players of this game, as the answer count has them (not those waiting for the next).
    const inGame = new Set(await this.redis.hkeys(gameKeys.scores(ref.id)));
    const pressed = lobby ? new Set(await this.redis.smembers(gameKeys.pressed(ref.id))) : null;
    for (const [playerId, rec] of await this.connectedPlayers(pin)) {
      if (!inGame.has(playerId)) continue;
      const own = stepMediaForDevice(snapshot, step, gameTarget, rec.presence ?? 'room');
      const plays = !!own && (hasSoundOrVideo(own.media) || own.videos.length > 0);
      if (pressed) {
        const said = pressed.has(playerId);
        players.push({ playerId, ready: said && (!plays || ready.has(playerId)), pressed: said });
      } else if (plays) {
        players.push({ playerId, ready: ready.has(playerId) });
      }
    }
    if (pressed) {
      // One count for the host: the participants; the projection says its own state.
      return {
        ...stepRef(step),
        ready: players.filter((p) => p.ready).length,
        total: players.length,
        players,
        screens: { ready: screensReady, total: screens.length },
        lobby: true,
      };
    }
    return {
      ...stepRef(step),
      ready: screensReady + players.filter((p) => p.ready).length,
      total: screens.length + players.length,
      players,
      screens: { ready: screensReady, total: screens.length },
    };
  }

  /** Sends the readiness of the upcoming question to the screens (never to participants). */
  async broadcastReadiness(pin: string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state === GameState.Ended) return;
    const ref = refOf(pin, meta);
    const snapshot = await this.game.getSnapshot(meta.id);
    if (!snapshot) return;
    const payload = await this.readiness(
      ref,
      this.upcomingStep(meta, snapshot),
      meta.state === GameState.Lobby,
    );
    if (!payload) return;
    // The participants hear the lobby's count only: who said they are ready, not whose media.
    const lobbyCount = payload.lobby
      ? { ready: payload.players.filter((p) => p.pressed).length, total: payload.players.length }
      : null;
    for (const socket of await this.server.in(pin).fetchSockets()) {
      if (!(socket.data as { playerId?: string }).playerId) socket.emit('media:readiness', payload);
      else if (lobbyCount) socket.emit('lobby:count', lobbyCount);
    }
    // The last device waited for is ready (or the last one not ready left): go.
    if (meta.state === GameState.MediaLoading && payload.ready >= payload.total) {
      await this.endMediaWait(ref, waitedStep(meta));
    }
  }

  /** The game's default audio target, read fresh (the host may change it in the lobby). */
  private async gameTarget(gameId: GameId, snapshot: QuizSnapshot): Promise<AudioTarget> {
    const session = await this.redis.hget(gameKeys.game(gameId), 'audioTarget');
    return gameAudioTarget(snapshot, session as AudioTarget | null);
  }

  /**
   * Moves the sequence to question `index`: shows the slides anchored before it
   * first (#7), then the question itself; past the last question, the podium.
   */
  private async enterStep(ref: GameRef, snapshot: QuizSnapshot, index: number): Promise<void> {
    const slideIndex = snapshot.slides.findIndex((s) => s.beforeQuestionIndex === index);
    if (slideIndex >= 0) {
      await this.showSlide(ref, snapshot, slideIndex);
    } else if (index >= snapshot.questions.length) {
      const meta = await this.currentMeta(ref);
      if (meta) await this.toPodium(ref, meta);
    } else {
      await this.beginQuestion(ref, snapshot, index);
    }
  }

  /**
   * Shows content slide `slideIndex` (state `SLIDE_SHOW`, #7) — unless a device
   * that plays its sound or video has not loaded it (#125): the room then waits
   * first, as before a question.
   */
  private async showSlide(ref: GameRef, snapshot: QuizSnapshot, slideIndex: number): Promise<void> {
    const slide = snapshot.slides[slideIndex];
    const step = { questionIndex: slide.beforeQuestionIndex, slideIndex };
    if (slideHasPlayback(slide) && (await this.waitForMedia(ref, snapshot, step))) return;
    await this.startSlide(ref, snapshot, slideIndex);
  }

  /**
   * The slide on screen. `currentIndex` points at the question that follows, so
   * `game:state.questionIndex` stays meaningful for progress displays. Its media
   * start on one instant of the server's clock; the display timer is armed when
   * the slide has one; what comes next is fetched while it shows.
   */
  private async startSlide(
    ref: GameRef,
    snapshot: QuizSnapshot,
    slideIndex: number,
  ): Promise<void> {
    const { pin } = ref;
    const slide = snapshot.slides[slideIndex];
    this.timers.cancel('reveal', pin);
    this.timers.cancel('autoNext', pin);
    this.timers.cancel('mediaWait', pin);
    const now = Date.now();
    const plays = slideHasPlayback(slide);
    const before = await this.currentMeta(ref);
    await this.redis.hset(
      gameKeys.game(ref.id),
      gameHash({
        state: GameState.SlideShow,
        slideIndex,
        currentIndex: slide.beforeQuestionIndex,
        clockFrozen: false,
        pausedRemainingMs: null,
        autoNextAt: 0,
        mediaWaitUntil: 0,
        slideMediaStartAt: plays ? now + MEDIA_LEAD_MS : 0,
        // Shown while the game is paused: its media hold until the game resumes.
        slidePausedAt: plays && before?.paused ? now : 0,
      }),
    );
    const meta = await this.currentMeta(ref);
    this.server.to(pin).emit('game:state', {
      state: GameState.SlideShow,
      questionIndex: slide.beforeQuestionIndex,
      totalQuestions: snapshot.questions.length,
      nav: meta ? navFor(meta, snapshot) : undefined,
    });
    this.server
      .to(pin)
      .emit(
        'slide:show',
        buildSlideShow(
          slide,
          slideIndex,
          await this.gameTarget(ref.id, snapshot),
          plays ? now + MEDIA_LEAD_MS : 0,
        ),
      );
    if (meta) await this.scheduleAutoNextIfNeeded(ref, meta);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
    // One step ahead: what comes after the slide loads while it shows.
    await this.emitPreload(ref, snapshot, stepAfterSlide(snapshot, slideIndex));
    await this.broadcastReadiness(pin);
  }

  /** The `slide:show` of the slide on screen, as a screen (re)attaching gets it. */
  private async slideShowNow(ref: GameRef, meta: GameMeta, snapshot: QuizSnapshot) {
    const slide = snapshot.slides[meta.slideIndex ?? -1];
    if (!slide) return null;
    return buildSlideShow(
      slide,
      meta.slideIndex ?? 0,
      gameAudioTarget(snapshot, meta.audioTarget),
      this.slideStartShown(meta),
    );
  }

  /**
   * The slide's media start as the screens should take it: while the game is
   * paused, moved by the pause so far — a screen arriving then starts where the
   * room stands, not where the clock would have taken it.
   */
  private slideStartShown(meta: GameMeta): number {
    const start = meta.slideMediaStartAt ?? 0;
    if (!start || !meta.slidePausedAt) return start;
    return start + Math.max(0, Date.now() - meta.slidePausedAt);
  }

  /**
   * Opens question `index` — unless a device that plays its sound or video has
   * not loaded it: the room then waits (`MEDIA_LOADING`) until every such device
   * is ready, the cap runs out, or the host starts anyway. A silent question, or
   * a room already ready, starts at once.
   */
  private async beginQuestion(ref: GameRef, snapshot: QuizSnapshot, index: number): Promise<void> {
    if (await this.waitForMedia(ref, snapshot, { questionIndex: index })) return;
    await this.startQuestion(ref, snapshot, index);
  }

  /**
   * Holds the room in `MEDIA_LOADING` before a step when a device that plays its
   * sound or video has not loaded it; false (nothing held) when every device is
   * ready or the wait is off.
   */
  private async waitForMedia(
    ref: GameRef,
    snapshot: QuizSnapshot,
    step: PreloadStep,
  ): Promise<boolean> {
    const { pin } = ref;
    const waitS = settings.get(SETTINGS.GAME_MEDIA_WAIT_S);
    const readiness = waitS > 0 ? await this.readiness(ref, step) : null;
    if (!readiness || readiness.ready >= readiness.total) return false;
    const until = Date.now() + waitS * 1000;
    this.timers.cancel('autoNext', pin);
    await this.redis.hset(
      gameKeys.game(ref.id),
      gameHash({
        state: GameState.MediaLoading,
        currentIndex: step.questionIndex,
        slideIndex: step.slideIndex ?? -1,
        mediaWaitUntil: until,
        autoNextAt: 0,
      }),
    );
    this.server.to(pin).emit('game:state', {
      state: GameState.MediaLoading,
      questionIndex: step.questionIndex,
      totalQuestions: snapshot.questions.length,
    });
    this.server.to(pin).emit('media:wait', { ...stepRef(step), until });
    this.armMediaWait(ref, step, until - Date.now());
    // Asked again: a phone whose own element was busy with the step before loads it now.
    await this.emitPreload(ref, snapshot, step);
    await this.broadcastReadiness(pin);
    return true;
  }

  private armMediaWait(ref: GameRef, step: PreloadStep, delayMs: number): void {
    this.timers.arm('mediaWait', ref.pin, delayMs, () => this.endMediaWait(ref, step));
  }

  /**
   * Leaves the media wait of a step and opens it — once, whoever gets there
   * first: every device ready, the cap, the host, the host coming back.
   */
  private async endMediaWait(ref: GameRef, step: PreloadStep): Promise<void> {
    const { pin } = ref;
    const meta = await this.currentMeta(ref);
    if (!meta || meta.state !== GameState.MediaLoading) return;
    const waited = waitedStep(meta);
    if (waited.questionIndex !== step.questionIndex || waited.slideIndex !== step.slideIndex) {
      return;
    }
    if (!(await this.firstThrough(gameKeys.mediaWaitLock(ref.id, mediaStepKey(step))))) return;
    this.timers.cancel('mediaWait', pin);
    const snapshot = await this.game.getSnapshot(ref.id);
    if (!snapshot) return;
    if (step.slideIndex !== undefined) await this.startSlide(ref, snapshot, step.slideIndex);
    else await this.startQuestion(ref, snapshot, step.questionIndex);
  }

  private async startQuestion(ref: GameRef, snapshot: QuizSnapshot, index: number): Promise<void> {
    const { pin } = ref;
    const question = snapshot.questions[index];
    const now = Date.now();
    // Délai de lecture configurable (§8, défaut 3 s) — lu au runtime (tests rapides).
    const readDelay = settings.get(SETTINGS.GAME_READ_DELAY_MS);
    // Every device starts the sound or video on the same instant of the server's clock.
    const mediaStartAt = now + MEDIA_LEAD_MS;
    // Listen first: the answers open once the media has played, not after the reading.
    const listenMs = question.timerAfterMedia ? (mediaDurationMs(question.media) ?? 0) : 0;
    const startedAt = Math.max(now + readDelay, mediaStartAt + listenMs); // fenêtre de lecture
    const endsAt = startedAt + question.timeLimitS * 1000;
    const mediaLeadMs = hasSoundOrVideo(question.media) ? startedAt - mediaStartAt : null;

    // Nouvelle question : chrono qui tourne, ni gelé ni en pause (un enchaînement
    // manuel pendant une pause reprend implicitement la main).
    this.timers.cancel('autoNext', pin);
    await this.redis.hset(
      gameKeys.game(ref.id),
      gameHash({
        state: GameState.Answering,
        mediaWaitUntil: 0,
        currentIndex: index,
        slideIndex: -1,
        questionStartedAt: startedAt,
        questionEndsAt: endsAt,
        mediaLeadMs,
        clockFrozen: false,
        paused: false,
        pausedRemainingMs: null,
      }),
    );

    this.server.to(pin).emit('game:state', {
      state: GameState.Answering,
      questionIndex: index,
      totalQuestions: snapshot.questions.length,
    });
    this.server
      .to(pin)
      .emit(
        'question:start',
        buildQuestionStart(
          question,
          index,
          startedAt,
          endsAt,
          await this.gameTarget(ref.id, snapshot),
          mediaLeadMs,
        ),
      );
    this.server.to(pin).emit('game:mode', await this.readMode(pin));

    this.scheduleReveal(ref, index, endsAt + GRACE_MS - now);
    // An evening of quizzes outlives one TTL: each question keeps the room alive.
    await this.game.touchRoom(pin);
  }

  /** Arme (ou ré-arme) le timer de fin de question → `advanceToReveal`. */
  private scheduleReveal(
    ref: GameRef,
    index: number,
    delayMs: number,
    trigger: 'timer' | 'all' = 'timer',
  ): void {
    this.timers.arm('reveal', ref.pin, delayMs, () =>
      this.advanceToReveal(ref.pin, index, trigger, ref.id),
    );
  }

  /**
   * ANSWERING → REVEAL. **Idempotente** : seul le 1er appelant qui pose le verrou
   * NX `reveal-lock:{index}` poursuit ; les autres (2e chemin, double-clic) sont
   * de vrais no-op. Émet l'état REVEAL, puis le résultat de chacun et le classement.
   */
  async advanceToReveal(
    pin: string,
    index: number,
    trigger: 'timer' | 'all' | 'host',
    gameId: GameId,
  ): Promise<void> {
    const ref: GameRef = { pin, id: gameId };
    const meta = await this.currentMeta(ref);
    if (!meta || meta.state !== GameState.Answering || meta.currentIndex !== index) {
      return; // état déjà dépassé, partie finie, ou une autre partie du salon
    }
    if (!(await this.firstThrough(gameKeys.revealLock(gameId, index)))) {
      return; // un autre chemin a déjà révélé cette question
    }
    this.timers.cancel('reveal', pin);
    // A count waiting for its window goes out before the reveal: the screens then show
    // every answer the reveal counts (the lock taken above closes the answers).
    if (this.answerCounts.get(pin)?.waiting) await this.sendAnswerCount(ref, index, false);
    const snapshot = await this.game.getSnapshot(gameId);
    // Numeric `closest`: the points wait for every answer — settled before the state
    // says REVEAL, so a screen (re)attaching meanwhile never reads them unsettled. The
    // lock taken above already closes the answers (see `submit`).
    if (snapshot && isDeferred(snapshot.questions[index])) {
      await this.settleClosest(ref, snapshot.questions[index], index);
    }
    await this.redis.hset(gameKeys.game(gameId), gameHash({ state: GameState.Reveal }));
    this.log.debug(`REVEAL ${pin} q${index} (${trigger})`);
    this.server.to(pin).emit('game:state', {
      state: GameState.Reveal,
      questionIndex: index,
      totalQuestions: meta.totalQuestions,
      nav: snapshot ? navFor({ ...meta, state: GameState.Reveal }, snapshot) : undefined,
    });
    if (snapshot) {
      await this.emitReveal(ref, snapshot, index);
    }
    // Mode auto : enchaîne seul après le temps d'affichage du reveal (§8). On
    // rediffuse game:mode pour transmettre la deadline (compte à rebours console).
    await this.scheduleAutoNextIfNeeded(ref);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  /**
   * Diffuse `question:reveal` (résultat **personnel** par socket — §9) puis
   * `leaderboard`. Le reveal commun (bonnes réponses + répartition) est calculé
   * une fois ; `yourResult`/`you` sont ciblés socket par socket.
   */
  private async emitReveal(ref: GameRef, snapshot: QuizSnapshot, index: number): Promise<void> {
    const { pin } = ref;
    const question = snapshot.questions[index];
    const records = await this.game.answers(ref.id, index);
    const common = await this.revealCommon(pin, question, records);

    const ranking = await this.ranking(ref);

    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit('question:reveal', personalReveal(common, records, ranking, playerId));
      socket.emit('leaderboard', personalLeaderboard(ranking, playerId));
    }
    await this.emitHostScores(ref, sockets);
    // What comes next, fetched by every device while the leaderboard is up.
    await this.emitPreload(ref, snapshot, firstStepOf(snapshot, index + 1));
    await this.broadcastReadiness(pin);
  }

  /** Common reveal + the proximity ranking of a numeric `closest` question (with nicknames). */
  private async revealCommon(
    pin: string,
    question: SnapshotQuestion,
    records: Map<string, AnswerRecord>,
  ): Promise<QuestionRevealPayload> {
    const common: QuestionRevealPayload = buildRevealCommon(question, [...records.values()]);
    if (!isDeferred(question)) return common;
    const players = await this.game.players(pin);
    const rows = rankClosest(
      question,
      [...records.entries()].map(([key, r]) => ({ key, answer: r.answer })),
    );
    common.closest = rows.slice(0, 10).map((row) => {
      const p = players.get(row.key);
      return {
        nickname: p?.nickname ?? '?',
        avatar: p?.avatar,
        value: row.value,
        distance: row.distance,
        rank: row.rank,
        points: row.points,
      };
    });
    return common;
  }

  /**
   * Numeric `closest`: once the answering window is closed, rank the answers
   * by distance and award the points (exact = full, then by rank). Records,
   * player scores and the leaderboard are updated here, once.
   */
  private async settleClosest(
    ref: GameRef,
    question: SnapshotQuestion,
    index: number,
  ): Promise<void> {
    const records = await this.game.answers(ref.id, index);
    if (records.size === 0) return;
    const rows = rankClosest(
      question,
      [...records.entries()].map(([key, r]) => ({ key, answer: r.answer })),
    );
    for (const row of rows) {
      const rec = records.get(row.key);
      const player = await this.game.getScore(ref.id, row.key);
      if (!rec || !player) continue;
      rec.pointsAwarded = row.points;
      rec.isCorrect = row.exact;
      rec.credit = row.points / (question.basePoints || 1);
      rec.closestRank = row.rank;
      rec.distance = row.distance;
      await this.redis.hset(gameKeys.answers(ref.id, index), row.key, JSON.stringify(rec));
      player.score += row.points;
      // Exact = a right answer for the streak; a near miss neither grows nor breaks it.
      if (row.exact) player.streak += 1;
      await this.redis.hset(gameKeys.scores(ref.id), row.key, JSON.stringify(player));
    }
  }

  /** `host:reveal` : force le passage en REVEAL (idempotent via le verrou). */
  async reveal(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.advanceToReveal(pin, meta.currentIndex, 'host', meta.id);
  }

  /**
   * `host:next` : depuis REVEAL, passe au classement du quiz (#198) quand il suit, sinon
   * à la question suivante ou au PODIUM (dernière) ; depuis LEADERBOARD, à la suite.
   * Verrou atomique `advance-lock:{step}` → un double-clic ne saute pas d'étape.
   */
  async next(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    const ref = refOf(pin, meta);
    // Looking back: "next" brings every screen back to the live position.
    if (meta.reviewStep) {
      await this.resume(ref);
      return;
    }
    // Waiting for media: the host starts the question anyway.
    if (meta.state === GameState.MediaLoading) {
      await this.endMediaWait(ref, waitedStep(meta));
      return;
    }
    if (!isSettled(meta.state) && meta.state !== GameState.SlideShow) {
      throw new BadRequestException('session.reveal_required');
    }
    this.timers.cancel('autoNext', pin); // un enchaînement (auto/manuel) annule l'autre
    // A slide gets its own lock key: it shares `currentIndex` with the question it precedes;
    // so do the standings that follow a reveal.
    const lockStep =
      meta.state === GameState.SlideShow
        ? `s${meta.slideIndex ?? 0}`
        : meta.state === GameState.Leaderboard
          ? `l${meta.currentIndex}`
          : String(meta.currentIndex);
    if (!(await this.firstThrough(gameKeys.advanceLock(meta.id, lockStep)))) {
      return; // suivant déjà déclenché (double-clic)
    }
    const snapshot = await this.requireSnapshot(meta.id, true);
    if (meta.state === GameState.SlideShow) {
      // Next slide sharing the anchor, else the anchored question (or the podium).
      const current = meta.slideIndex ?? 0;
      const following = snapshot.slides[current + 1];
      if (following && following.beforeQuestionIndex === meta.currentIndex) {
        await this.showSlide(ref, snapshot, current + 1);
      } else if (meta.currentIndex >= meta.totalQuestions) {
        await this.toPodium(ref, meta);
      } else {
        await this.beginQuestion(ref, snapshot, meta.currentIndex);
      }
      return;
    }
    if (meta.state === GameState.Reveal && standingsFollow(snapshot, meta.currentIndex)) {
      await this.toStandings(ref, meta, snapshot);
      return;
    }
    await this.enterStep(ref, snapshot, meta.currentIndex + 1);
  }

  /**
   * The quiz's standings after a reveal (#198), a step of their own: every screen is
   * told the state, and gets the leaderboard again (a screen may have missed it).
   */
  private async toStandings(ref: GameRef, meta: GameMeta, snapshot: QuizSnapshot): Promise<void> {
    const { pin } = ref;
    const fresh = { ...meta, state: GameState.Leaderboard, autoNextAt: 0 };
    await this.redis.hset(
      gameKeys.game(ref.id),
      gameHash({ state: GameState.Leaderboard, autoNextAt: 0 }),
    );
    this.server.to(pin).emit('game:state', {
      state: GameState.Leaderboard,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
      nav: navFor(fresh, snapshot),
    });
    const ranking = await this.ranking(ref);
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      socket.emit('leaderboard', personalLeaderboard(ranking, socket.data.playerId));
    }
    await this.scheduleAutoNextIfNeeded(ref);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  // ── Looking back (host navigation) ──────────────────────────────────────────

  /**
   * `host:review`: shows a played step again on every screen — a question's
   * reveal (archived answers, no chrono, nothing accepted) or a shown slide.
   * Nothing is replayed or rescored; the live position is kept in `state` /
   * `currentIndex` and `host:next` resumes it. Only from a settled state
   * (reveal, slide, podium), never mid-question.
   */
  async review(pin: string, hostUserId: string, step: GameStep): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (
      ![GameState.Reveal, GameState.Leaderboard, GameState.SlideShow, GameState.Podium].includes(
        meta.state as GameState,
      )
    ) {
      throw new BadRequestException('session.review_unavailable');
    }
    const snapshot = await this.requireSnapshot(meta.id, true);
    const ref = refOf(pin, meta);
    const played = playedSteps(meta, snapshot);
    const key = stepKey(step);
    if (!played.includes(key)) throw new BadRequestException('session.step_not_played');
    if (key === liveStepKey(meta)) {
      await this.resume(ref);
      return;
    }
    this.timers.cancel('autoNext', pin);
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ reviewStep: key, autoNextAt: 0 }));
    const fresh = { ...meta, reviewStep: key, autoNextAt: 0 };
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) await this.emitReviewTo(socket, ref, fresh, snapshot);
    this.server.to(pin).emit('game:mode', this.buildModePayload(fresh));
  }

  /** Back to the live position on every screen; re-arms the auto pace if it applies. */
  private async resume(ref: GameRef): Promise<void> {
    const { pin } = ref;
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ reviewStep: '' }));
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) await this.sendStateTo(socket, pin);
    await this.scheduleAutoNextIfNeeded(ref);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  /** The reviewed step as the live screens should show it (state + content + nav). */
  private async emitReviewTo(
    socket: Emitter,
    ref: GameRef,
    meta: GameMeta,
    snapshot: QuizSnapshot,
  ): Promise<void> {
    const step = parseStepKey(meta.reviewStep ?? '');
    if (!step) return;
    const nav = navFor(meta, snapshot);
    if ('slideIndex' in step) {
      const slide = snapshot.slides[step.slideIndex];
      if (!slide) return;
      socket.emit('game:state', {
        state: GameState.SlideShow,
        questionIndex: slide.beforeQuestionIndex,
        totalQuestions: meta.totalQuestions,
        nav,
      });
      socket.emit(
        'slide:show',
        buildSlideShow(slide, step.slideIndex, gameAudioTarget(snapshot, meta.audioTarget)),
      );
      return;
    }
    const index = step.questionIndex;
    const question = snapshot.questions[index];
    if (!question) return;
    // The question itself (prompt, options) with a chrono already over, then its reveal.
    socket.emit(
      'question:start',
      buildQuestionStart(question, index, 0, 0, gameAudioTarget(snapshot, meta.audioTarget), null),
    );
    socket.emit('game:state', {
      state: GameState.Reveal,
      questionIndex: index,
      totalQuestions: meta.totalQuestions,
      nav,
    });
    await this.emitRevealTo(socket, ref, snapshot, index);
  }

  /** The reveal of question `index` to one socket, its own result in it, then the leaderboard. */
  private async emitRevealTo(
    socket: Emitter,
    ref: GameRef,
    snapshot: QuizSnapshot,
    index: number,
  ): Promise<void> {
    const records = await this.game.answers(ref.id, index);
    const common = await this.revealCommon(ref.pin, snapshot.questions[index], records);
    const ranking = await this.ranking(ref);
    const playerId = socket.data.playerId;
    socket.emit('question:reveal', personalReveal(common, records, ranking, playerId));
    socket.emit('leaderboard', personalLeaderboard(ranking, playerId));
  }

  /** Dernière question révélée → PODIUM (top 3 + rang perso). */
  private async toPodium(ref: GameRef, meta: GameMeta): Promise<void> {
    const { pin } = ref;
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ state: GameState.Podium }));
    await this.foldGame(ref, meta);
    const ranking = await this.ranking(ref);

    const snapshot = await this.game.getSnapshot(ref.id);
    this.server.to(pin).emit('game:state', {
      state: GameState.Podium,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
      nav: snapshot ? navFor({ ...meta, state: GameState.Podium }, snapshot) : undefined,
    });
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit('game:podium', personalPodium(ranking, playerId, snapshot));
      // Classement général (top 10) aussi au podium : alimente l'écran projeté et
      // survit à un rechargement (sendStateTo le ré-émet en PODIUM).
      socket.emit('leaderboard', personalLeaderboard(ranking, playerId));
    }
    await this.emitStandings(pin);
    await this.emitHostScores(ref, sockets);
  }

  /**
   * Every player's quiz and room scores (#198), to the host's consoles among `sockets`
   * (every socket of the room when omitted).
   */
  private async emitHostScores(ref: GameRef, sockets?: Emitter[]): Promise<void> {
    const targets = (sockets ?? (await this.server.in(ref.pin).fetchSockets())).filter(
      (socket) => socket.data.isHostControl,
    );
    if (targets.length === 0) return;
    const [quiz, { ranked: room }, folded] = await Promise.all([
      this.game.rankedPlayers(ref.pin, ref.id),
      this.game.standings(ref.pin),
      this.game.isFolded(ref.pin, ref.id),
    ]);
    const payload = { rows: scoreTable(quiz, room, folded) };
    for (const socket of targets) socket.emit('game:scores', payload);
  }

  /**
   * Records a game that is over in the room's standings — one that started;
   * a quiz replaced in its lobby was never played. The room goes on if it fails.
   */
  private async foldGame(ref: GameRef, meta: GameMeta): Promise<void> {
    if (meta.currentIndex < 0) return;
    try {
      await this.game.foldGame(ref.pin, ref.id);
    } catch (err) {
      this.log.error(`foldGame ${ref.pin}: ${(err as Error).message}`);
    }
  }

  /** The room's standings, to every socket (or `only` one), each with its own line. */
  private async emitStandings(pin: string, only?: Emitter): Promise<void> {
    const { quizzesPlayed, playedQuizIds, ranked } = await this.game.standings(pin);
    if (quizzesPlayed === 0) return;
    const top = topRows(ranked);
    const sockets: Emitter[] = only ? [only] : await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = socket.data.playerId;
      const at = playerId ? ranked.findIndex((p) => p.id === playerId) : -1;
      const me = ranked[at];
      socket.emit('room:standings', {
        quizzesPlayed,
        // Which quizzes: the host's own ids, for the console only.
        ...(socket.data.isHostControl ? { playedQuizIds } : {}),
        top,
        ...(me
          ? {
              you: {
                score: me.score,
                rank: at + 1,
                correct: me.correct,
                answered: me.answered,
                avgResponseMs: me.answered > 0 ? Math.round(me.totalMs / me.answered) : null,
                maxStreak: me.maxStreak,
                quizzes: me.quizzes,
              },
            }
          : {}),
      });
    }
  }

  /**
   * Renvoie l'état courant à un **seul** socket (reconnexion / late join §5/§6 /
   * spectateur §3) : `game:state` puis, selon l'état, `question:start` (ANSWERING),
   * `question:reveal` + `leaderboard` (REVEAL) ou `game:podium` (PODIUM). Le résultat
   * personnel n'est inclus que si le socket porte un `playerId`.
   */
  async sendStateTo(socket: Emitter, pin: string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta) return;
    const ref = refOf(pin, meta);
    const playerId = socket.data.playerId;
    // Transparence (§2.10, RG-16) : tout (ré)attaché — dont les joueurs arrivés après
    // le host:create — doit voir ce que la session enregistre de lui.
    socket.emit('notice', noticeOf(meta));
    socket.emit('room:info', { name: meta.roomName || null, hostName: meta.hostName });
    const room = await this.game.getRoom(pin);
    if (room) socket.emit('room:sounds', soundsPayload(room.sounds));
    if (room) socket.emit('room:motion', { on: room.motion });
    const snapshot = await this.game.getSnapshot(meta.id);
    if (snapshot) {
      // Every device asks for sound at once when the quiz will need it (a phone too:
      // the next quiz of a room may play sound where the first did not).
      socket.emit('game:media', await this.mediaPayload(pin, snapshot, meta.audioTarget ?? ''));
    }
    // A participant back in a lobby: whether they already said they are ready (#104),
    // sent after the state (a new lobby clears the last quiz's on the phone).
    const saidReady =
      playerId && meta.state === GameState.Lobby
        ? (await this.redis.sismember(gameKeys.pressed(meta.id), playerId)) === 1
        : null;
    socket.emit('game:state', {
      state: meta.state as GameState,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
      nav: snapshot && !meta.reviewStep ? navFor(meta, snapshot) : undefined,
    });
    if (saidReady !== null) socket.emit('lobby:you', { ready: saidReady });
    if (meta.state === GameState.Lobby) {
      socket.emit('lobby:countdown', { startAt: meta.lobbyStartAt || null });
    }
    // Instantané du lobby : sans lui, un host/projeté qui (re)charge verrait une
    // liste de joueurs vide (les `player:joined` passés sont perdus). §6/§9.
    socket.emit('game:roster', { players: await this.connectedRoster(pin) });
    if (socket.data.isHostControl) await this.emitHostScores(ref, [socket]);
    // Mode/pause courants : un (ré)attache doit refléter auto/pause immédiatement.
    socket.emit('game:mode', this.buildModePayload(meta));
    if (meta.joinBaseUrl) socket.emit('game:join-url', { baseUrl: meta.joinBaseUrl });
    // Between quizzes, the room's standings so far.
    if (meta.state === GameState.Lobby || meta.state === GameState.Podium) {
      await this.emitStandings(pin, socket);
    }
    // In the lobby, every device fetches what the first question needs while people wait;
    // arriving during a wait for media, what the coming question needs, and how long.
    if (meta.state === GameState.Lobby && snapshot) {
      await this.emitPreload(ref, snapshot, firstStepOf(snapshot, 0), socket);
    } else if (meta.state === GameState.MediaLoading && snapshot) {
      socket.emit('media:wait', {
        ...stepRef(waitedStep(meta)),
        until: meta.mediaWaitUntil ?? 0,
      });
      await this.emitPreload(ref, snapshot, waitedStep(meta), socket);
    } else if (meta.state === GameState.SlideShow && snapshot && !meta.reviewStep) {
      // On a slide, what comes after it (a device arriving now fetches it too).
      const next = stepAfterSlide(snapshot, meta.slideIndex ?? -1);
      await this.emitPreload(ref, snapshot, next, socket);
    }

    if (!snapshot || meta.currentIndex < 0) return;

    // Looking back: every (re)attached screen shows the reviewed step, not the live one.
    if (meta.reviewStep) {
      await this.emitReviewTo(socket, ref, meta, snapshot);
      return;
    }
    if (meta.state === GameState.SlideShow) {
      const show = await this.slideShowNow(ref, meta, snapshot);
      if (!show) return;
      socket.emit('slide:show', show);
      // Where the host put the slide's media (#125): it wins over the common start.
      const step = slideStep(meta);
      const anchor = await this.readAnchor(meta.id, mediaStepKey(step));
      if (anchor) socket.emit('media:control', { ...stepRef(step), ...anchor });
      return;
    }
    if (meta.state === GameState.Answering) {
      // Chrono gelé (pause / hôte parti) : recalcule un timing d'affichage cohérent
      // sur le restant figé plutôt que d'envoyer un `endsAt` déjà dépassé.
      const { startedAt, endsAt } = meta.clockFrozen
        ? resumeQuestionWindow(meta, Date.now())
        : { startedAt: meta.questionStartedAt, endsAt: meta.questionEndsAt };
      socket.emit(
        'question:start',
        questionStartOf(meta, snapshot, meta.currentIndex, startedAt, endsAt),
      );
      // Compteur courant : sinon un (re)attache mid-question afficherait « 0/N ».
      const { answered, total } = await this.connectedProgress(ref, meta.currentIndex);
      socket.emit('answer:count', { answered, total });
      // Where the host put the media, after the question: it wins over the common start.
      const anchor = await this.readAnchor(meta.id, meta.currentIndex);
      if (anchor) socket.emit('media:control', { questionIndex: meta.currentIndex, ...anchor });
    } else if (meta.state === GameState.Reveal) {
      const index = meta.currentIndex;
      // The question itself first (prompt, options): a screen that (re)attaches at
      // the reveal has nothing to show the answers against otherwise.
      socket.emit(
        'question:start',
        questionStartOf(meta, snapshot, index, meta.questionStartedAt, meta.questionEndsAt),
      );
      await this.emitRevealTo(socket, ref, snapshot, index);
    } else if (meta.state === GameState.Leaderboard) {
      socket.emit('leaderboard', personalLeaderboard(await this.ranking(ref), playerId));
    } else if (meta.state === GameState.Podium) {
      const ranking = await this.ranking(ref);
      socket.emit('game:podium', personalPodium(ranking, playerId, snapshot));
      // Classement général : un projecteur qui (re)charge au podium doit le revoir.
      socket.emit('leaderboard', personalLeaderboard(ranking, playerId));
    }
  }

  /** The room's connected players (playerId, record), whether they play this game or wait. */
  private async connectedPlayers(pin: string): Promise<[string, PlayerRecord][]> {
    return [...(await this.game.players(pin))].filter(([, rec]) => rec.connected);
  }

  /** Joueurs **connectés** (playerId + pseudo + avatar) pour l'instantané de lobby (§6/§9). */
  private async connectedRoster(
    pin: string,
  ): Promise<{ playerId: string; nickname: string; avatar: string; presence: PlayerPresence }[]> {
    return (await this.connectedPlayers(pin)).map(([playerId, rec]) => ({
      playerId,
      nickname: rec.nickname,
      avatar: rec.avatar,
      presence: rec.presence ?? 'room',
    }));
  }

  /**
   * `player:avatar` : change la graine d'avatar d'un joueur (cosmétique) avant le
   * démarrage, puis re-diffuse le roster pour que l'hôte et l'écran projeté
   * reflètent le nouvel avatar immédiatement.
   */
  async setAvatar(pin: string, playerId: string, avatar: string): Promise<void> {
    const record = await this.game.setAvatar(pin, playerId, avatar);
    if (!record) return; // partie démarrée / joueur inconnu
    this.server.to(pin).emit('game:roster', { players: await this.connectedRoster(pin) });
  }

  /**
   * Progression de la question **sur les joueurs connectés** (§8). `answered` et
   * `total` ne comptent QUE les connectés : une réponse persiste dans le hash après
   * le départ de son auteur, donc comparer `hlen(answers)` au nombre de connectés
   * révélerait à tort alors qu'un connecté n'a pas encore répondu. `allAnswered` est
   * vrai seulement si **aucun connecté n'est en attente**.
   */
  private async connectedProgress(
    ref: GameRef,
    questionIndex: number,
  ): Promise<{ answered: number; total: number; allAnswered: boolean }> {
    const connected = await this.connectedPlayers(ref.pin);
    const inGame = new Set(await this.redis.hkeys(gameKeys.scores(ref.id)));
    const answeredIds = new Set(await this.redis.hkeys(gameKeys.answers(ref.id, questionIndex)));
    let total = 0;
    let answered = 0;
    for (const [id] of connected) {
      if (!inGame.has(id)) continue;
      total++;
      if (answeredIds.has(id)) answered++;
    }
    return { answered, total, allAnswered: total > 0 && answered >= total };
  }

  /**
   * `host:ban` : exclut un joueur pour `minutes` minutes (RG-12). Retire son état
   * (service : ban TTL + purge record/pseudo/classement), déconnecte ses sockets
   * avec un `kicked`, diffuse le roster, puis — en ANSWERING — re-vérifie la
   * convergence (bannir le dernier non-répondant ne doit pas figer la question).
   */
  async banPlayer(
    pin: string,
    hostUserId: string,
    playerId: string,
    minutes: number,
  ): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    requireNumber(minutes);
    const nickname = await this.game.banPlayer(pin, meta.id, playerId, minutes);
    if (!nickname) return; // déjà parti / inconnu
    const sockets = await this.server.in(pin).fetchSockets();
    for (const s of sockets) {
      if ((s.data as { playerId?: string }).playerId === playerId) {
        s.emit('kicked', { minutes });
        await s.leave(pin);
      }
    }
    this.server
      .to(pin)
      .emit('player:left', { playerId, playerCount: await this.game.connectedCount(pin) });
    if (meta.state === GameState.Answering) {
      const progress = await this.connectedProgress(refOf(pin, meta), meta.currentIndex);
      const { answered, total, allAnswered } = progress;
      this.server.to(pin).emit('answer:count', { answered, total });
      if (allAnswered) await this.advanceToReveal(pin, meta.currentIndex, 'all', meta.id);
    }
  }

  /**
   * Déconnexion d'un joueur (§8) : `connected=false`, diffusion `player:left` avec
   * le compte des **connectés**, puis **re-vérification de la convergence** — un
   * départ peut compléter « tous les connectés ont répondu » sans nouveau submit
   * (le départ ne déclenche le REVEAL que si aucun connecté restant n'est en attente).
   */
  async handlePlayerDisconnect(pin: string, playerId: string): Promise<void> {
    // An old socket timing out after the player came back on a new one (network
    // switch): the player is still here. A socket that dropped has left the room.
    const sockets = await this.server.in(pin).fetchSockets();
    if (sockets.some((s) => (s.data as { playerId?: string }).playerId === playerId)) return;
    const record = await this.game.setConnected(pin, playerId, false);
    if (!record) return;
    const playerCount = await this.game.connectedCount(pin);
    this.server.to(pin).emit('player:left', { playerId, playerCount });
    await this.broadcastReadiness(pin);

    const meta = await this.game.getMeta(pin);
    if (meta && meta.state === GameState.Answering) {
      const progress = await this.connectedProgress(refOf(pin, meta), meta.currentIndex);
      const { answered, total, allAnswered } = progress;
      this.server.to(pin).emit('answer:count', { answered, total }); // total a baissé
      if (allAnswered) {
        await this.advanceToReveal(pin, meta.currentIndex, 'all', meta.id);
      }
    }
  }

  /**
   * Déconnexion d'un socket de **contrôle hôte** (§7.1). Si plus aucune autre
   * fenêtre de contrôle de cette partie n'est connectée, arme un délai de grâce :
   * un simple rechargement (retour < grâce via `host:attach`) l'annule ; sinon on
   * bascule en `HOST_DISCONNECTED`.
   */
  async handleHostDisconnect(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.hostUserId !== hostUserId) return;
    if (meta.state === GameState.Ended || meta.state === GameState.HostDisconnected) return;
    if ((await this.countHostSockets(pin, hostUserId)) > 0) return;

    const ref = refOf(pin, meta);
    const graceMs = settings.get(SETTINGS.GAME_HOST_GRACE_MS);
    this.timers.arm('hostGrace', pin, graceMs, () => this.declareHostDisconnected(ref, hostUserId));
  }

  /**
   * Fin du délai de grâce : re-vérifie (l'hôte a pu revenir entre-temps), puis fige
   * la partie en `HOST_DISCONNECTED` — timer de question mis en pause (ms restantes
   * conservées), état précédent mémorisé pour la reprise — et arme la fenêtre de
   * reconnexion (§7.3) au-delà de laquelle la partie se termine.
   */
  private async declareHostDisconnected(ref: GameRef, hostUserId: string): Promise<void> {
    const { pin } = ref;
    const meta = await this.currentMeta(ref);
    if (!meta || meta.hostUserId !== hostUserId) return;
    if (meta.state === GameState.Ended || meta.state === GameState.HostDisconnected) return;
    if ((await this.countHostSockets(pin, hostUserId)) > 0) return; // revenu pendant la grâce

    // Gèle le chrono via la primitive partagée (idempotente : si l'hôte avait
    // déjà mis en pause, le restant figé est préservé, pas écrasé).
    this.timers.cancel('autoNext', pin);
    this.timers.cancel('mediaWait', pin);
    await this.freezeClock(pin, meta);
    await this.redis.hset(
      gameKeys.game(ref.id),
      gameHash({ state: GameState.HostDisconnected, prevState: meta.state }),
    );
    this.log.debug(`HOST_DISCONNECTED ${pin} (depuis ${meta.state})`);

    this.server.to(pin).emit('game:state', {
      state: GameState.HostDisconnected,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });

    const windowMs = settings.get(SETTINGS.GAME_HOST_WINDOW_MS);
    this.timers.arm('hostWindow', pin, windowMs, () => this.endOrphaned(ref, hostUserId));
  }

  /** L'hôte n'est pas revenu dans la fenêtre (§7.3) → fin de partie en l'état. */
  private async endOrphaned(ref: GameRef, hostUserId: string): Promise<void> {
    const { pin } = ref;
    const meta = await this.currentMeta(ref);
    if (!meta || meta.state !== GameState.HostDisconnected) return; // repris entre-temps
    // Fin subie : on archive ce qui a été joué, marqué « interrompu » (§7.3). Best-effort —
    // l'hôte est absent, un échec ne doit pas bloquer la fin (journalisé, avalé).
    await this.archive.archive(pin, meta, { interrupted: true, bestEffort: true });
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ state: GameState.Ended }));
    await this.foldGame(ref, meta);
    await this.emitStandings(pin);
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', await this.endedPayload(ref.id));
  }

  /**
   * `host:attach` : l'hôte est de retour. Annule les minuteries de grâce/fin et,
   * si la partie était figée en `HOST_DISCONNECTED`, reprend là où elle en était
   * (§7.3) — en ANSWERING avec un `questionEndsAt` recalculé sur le temps restant.
   */
  async onHostAttached(pin: string): Promise<void> {
    this.timers.cancel('hostGrace', pin);
    this.timers.cancel('hostWindow', pin);

    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.HostDisconnected) return;
    const ref = refOf(pin, meta);
    const prev = (meta.prevState as GameState) ?? GameState.Lobby;

    await this.redis.hset(gameKeys.game(meta.id), gameHash({ state: prev, prevState: '' }));
    meta.state = prev;
    this.server.to(pin).emit('game:state', {
      state: prev,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });

    if (prev === GameState.MediaLoading) {
      // Back after a wait for media: no more waiting, the step starts.
      await this.endMediaWait(ref, waitedStep(meta));
    } else if (prev === GameState.Answering) {
      const snapshot = await this.game.getSnapshot(meta.id);
      // Toujours en pause à la reprise : on garde le chrono gelé (pas de ré-arme),
      // l'affichage du restant figé passe par `game:mode`. Sinon on dégèle.
      const now = Date.now();
      const { startedAt, endsAt } = meta.paused
        ? resumeQuestionWindow(meta, now)
        : ((await this.thawClock(pin, meta)) ?? resumeQuestionWindow(meta, now));
      if (snapshot) {
        this.server
          .to(pin)
          .emit(
            'question:start',
            questionStartOf(meta, snapshot, meta.currentIndex, startedAt, endsAt),
          );
      }
    } else {
      if (prev === GameState.SlideShow) {
        // Its media held while the host was away: they go on from there, unless paused.
        if (!meta.paused) await this.thawSlide(pin, meta);
        const snapshot = await this.game.getSnapshot(meta.id);
        const show = snapshot ? await this.slideShowNow(ref, meta, snapshot) : null;
        if (show) this.server.to(pin).emit('slide:show', show);
      }
      // Reprise en REVEAL en mode auto (ou sur une slide minutée) : ré-arme l'enchaînement.
      await this.scheduleAutoNextIfNeeded(ref, meta);
    }
    this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
  }

  /** Compte les sockets de **contrôle hôte** encore présents dans la room (mono-instance v1). */
  private async countHostSockets(pin: string, hostUserId: string): Promise<number> {
    const sockets = await this.server.in(pin).fetchSockets();
    return sockets.filter((s) => {
      const d = s.data as { isHostControl?: boolean; user?: { id?: string } };
      return d.isHostControl === true && d.user?.id === hostUserId;
    }).length;
  }

  /** `host:end` : termine la partie (tout état → ENDED) et invalide le PIN (§7). */
  async end(pin: string, hostUserId: string, archive = false): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state === GameState.Ended) return; // déjà terminée (ré-entrée / double-clic) → pas de double archive
    if (archive) await this.archiveAsked(pin, meta);
    this.timers.cancelAll(pin);
    this.answerCounts.delete(pin);
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ state: GameState.Ended }));
    // After the state: an answer arriving meanwhile can no longer be scored and missed.
    await this.foldGame(refOf(pin, meta), meta);
    await this.emitStandings(pin);
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(meta.hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', await this.endedPayload(meta.id));
  }

  /**
   * `host:next-quiz`: the room plays `quizId` next, from its lobby. In the lobby
   * the quiz picked is replaced (nothing was played); at the podium `archive`
   * keeps the results of the quiz just played, as `host:end` does. During a quiz
   * the host closes it: `archive` keeps what was played so far (archived as
   * interrupted, counted in the room's standings), otherwise nothing of it stays.
   * The players stay in, at 0; every screen is sent the new lobby.
   */
  async nextQuiz(pin: string, hostUserId: string, quizId: string, archive = false): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state === GameState.Ended) {
      throw new BadRequestException('session.next_quiz_unavailable');
    }
    const midQuiz = meta.state !== GameState.Lobby && meta.state !== GameState.Podium;
    // Checked before anything is archived: a quiz that cannot be played changes nothing.
    const snapshot = await this.game.snapshotFor(pin, quizId);
    const lock = gameKeys.advanceLock(meta.id, 'next-quiz');
    if (!(await this.firstThrough(lock))) return; // double click
    try {
      if (archive && meta.state === GameState.Podium) await this.archiveAsked(pin, meta);
      if (midQuiz) {
        // Closed before its end. Archived first: a failed write throws with nothing moved
        // (the quiz goes on, the host can retry); then no answer is scored any more.
        if (archive) await this.archiveAsked(pin, meta, true);
        this.timers.cancelAll(pin);
        this.answerCounts.delete(pin);
        await this.redis.hset(gameKeys.game(meta.id), gameHash({ state: GameState.Ended }));
        if (archive) await this.foldGame(refOf(pin, meta), meta);
      }
      this.timers.cancelAll(pin);
      this.answerCounts.delete(pin);
      await this.game.openGameWith(pin, snapshot);
      // A quiz that follows another starts on its own (#198); so does one replacing it.
      const follows = meta.state !== GameState.Lobby || Boolean(meta.lobbyStartAt);
      const opened = await this.game.getMeta(pin);
      if (follows && opened) {
        await this.armLobbyCountdown(refOf(pin, opened), Date.now() + NEXT_QUIZ_COUNTDOWN_MS);
      }
    } catch (err) {
      await this.redis.del(lock); // nothing moved: the host can try again
      throw err;
    }
    for (const socket of await this.server.in(pin).fetchSockets()) {
      await this.sendStateTo(socket, pin);
    }
    await this.broadcastReadiness(pin);
  }

  /**
   * Archives a game at the host's request (§2.7). Deliberately NOT best-effort:
   * a failed write is thrown and nothing is destroyed (the host can retry) — no
   * silent loss. A quiz deleted meanwhile will never archive: say so and go on.
   */
  private async archiveAsked(pin: string, meta: GameMeta, interrupted = false): Promise<void> {
    try {
      await this.archive.archive(pin, meta, { interrupted });
    } catch (err) {
      if (!isForeignKeyViolation(err)) throw err;
      this.log.warn(`Session ${pin}: quiz ${meta.quizId} no longer exists, ended without archive`);
      this.server.to(pin).emit('error', { code: 'session.archive_quiz_gone' });
    }
  }

  /**
   * `host:room-name`: the room's own name, in the lobby only (never during a
   * quiz). Blank = the default the screens show ("<host>'s room"). Every screen
   * is told.
   */
  async setRoomName(pin: string, hostUserId: string, raw: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) throw new BadRequestException('session.already_started');
    const name = oneLine(raw).slice(0, ROOM_NAME_MAX);
    await this.redis.hset(gameKeys.room(pin), roomHash({ name }));
    this.server.to(pin).emit('room:info', { name: name || null, hostName: meta.hostName });
  }

  /**
   * `player:ready` (#104): a participant says they are ready, or not yet, in the
   * lobby. It never blocks anything: the host sees one count and starts when
   * they choose. Kept per game, so each quiz of a room asks again.
   */
  async setReady(pin: string, playerId: string, isReady: boolean): Promise<boolean> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.Lobby) return false;
    if (!(await this.game.getScore(meta.id, playerId))) return false; // not in this game
    const key = gameKeys.pressed(meta.id);
    if (isReady) await this.redis.multi().sadd(key, playerId).expire(key, GAME_TTL_S).exec();
    else await this.redis.srem(key, playerId);
    await this.broadcastReadiness(pin);
    // The next quiz goes as soon as everyone in its lobby is ready (#198).
    if (isReady && meta.lobbyStartAt) {
      const pressed = new Set(await this.redis.smembers(key));
      const players = await this.connectedPlayers(pin);
      if (players.length > 0 && players.every(([id]) => pressed.has(id))) {
        await this.startOnItsOwn(refOf(pin, meta));
      }
    }
    return true;
  }

  /** `host:sounds` (#93): the room's game sounds, at any time; every screen is told. */
  /**
   * `host:motion`: whether the room's screens move between steps (UI system §1.8),
   * at any time — the host sees what the projector copes with. Every device follows.
   */
  async setMotion(pin: string, hostUserId: string, on: boolean): Promise<void> {
    await this.requireHost(pin, hostUserId);
    await this.redis.hset(gameKeys.room(pin), roomHash({ motion: on === true }));
    this.server.to(pin).emit('room:motion', { on: on === true });
  }

  async setSounds(pin: string, hostUserId: string, patch: RoomSoundsSettings): Promise<void> {
    await this.requireHost(pin, hostUserId);
    const sounds = await this.game.setSounds(pin, hostUserId, patch);
    this.server.to(pin).emit('room:sounds', soundsPayload(sounds));
  }

  // ── Mode / pause / chrono (§8) ─────────────────────────────────────────────

  /**
   * `host:join-url`: the address the invitations point at (a console opened on
   * localhost would otherwise print localhost on the QR code). Lobby only —
   * once people are in, the address on the projection must not move.
   */
  async setJoinUrl(pin: string, hostUserId: string, baseUrl: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.already_started');
    }
    const clean = normalizeBaseUrl(baseUrl);
    if (baseUrl && !clean) throw new BadRequestException('session.join_url_invalid');
    await this.redis.hset(gameKeys.room(pin), roomHash({ joinBaseUrl: clean }));
    this.server.to(pin).emit('game:join-url', { baseUrl: clean || null });
  }

  /**
   * `host:mode` : bascule manuel ⇄ auto en cours de partie (le présentateur
   * reprend la main). Passer en manuel annule un enchaînement auto en attente ;
   * passer en auto ré-arme l'enchaînement si l'on est déjà sur un reveal.
   */
  async setMode(pin: string, hostUserId: string, mode: GameMode): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ mode }));
    meta.mode = mode;
    if (mode === 'manual') {
      this.timers.cancel('autoNext', pin);
    } else {
      await this.scheduleAutoNextIfNeeded(refOf(pin, meta), meta);
    }
    this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
  }

  /**
   * `host:media` : the host steers the current question's media from the console
   * — back to the top, play, pause, or a point in it. The command becomes an
   * anchor (a position at an instant of the server's clock, playing or held),
   * kept for the question so a screen that loads late lands on it too.
   * While a listen-first question plays before its answers open, only the top
   * is allowed: the answers open on a time the server fixed from the sound.
   */
  async mediaControl(pin: string, hostUserId: string, command: HostMediaCommand): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    const target = await this.steerable(meta);
    if (!target) return;
    const { step, media, listenFirst } = target;
    const now = Date.now();
    let anchor: MediaAnchor;
    if (command.action === 'restart') {
      anchor = { t: 0, at: now, playing: true };
    } else {
      if (listenFirst && this.listening(meta, now)) return;
      const durationS = (mediaDurationMs(media) ?? 0) / 1000;
      const t = command.t;
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return;
      if (durationS > 0 && t > durationS) return;
      const playing =
        command.action === 'play' || (command.action === 'seek' && command.playing !== false);
      anchor = { t, at: now, playing };
    }
    await this.saveAnchor(meta.id, mediaStepKey(step), anchor);
    this.server.to(pin).emit('media:control', { ...stepRef(step), ...anchor });
  }

  /**
   * The media the host can steer now: the running question's sound or video
   * played from its file (an embed is its provider's to steer), or the sound of
   * the slide on screen (#125) — a muted video has nothing to steer.
   */
  private async steerable(meta: GameMeta): Promise<{
    step: PreloadStep;
    media: LiveQuestionMedia;
    listenFirst: boolean;
  } | null> {
    if (meta.reviewStep) return null;
    const snapshot = await this.game.getSnapshot(meta.id);
    if (!snapshot) return null;
    if (meta.state === GameState.SlideShow) {
      const slide = snapshot.slides[meta.slideIndex ?? -1];
      const media = slide ? slideSoundMedia(slide) : null;
      if (!media) return null;
      const step = slideStep(meta);
      return { step, media, listenFirst: false };
    }
    if (meta.state !== GameState.Answering) return null;
    const question = snapshot.questions[meta.currentIndex];
    const media = question?.media;
    if (
      !media ||
      !(media.audio || (media.visual?.kind === 'video' && media.visual.source === 'upload'))
    ) {
      return null;
    }
    return {
      step: { questionIndex: meta.currentIndex },
      media,
      listenFirst: !!question.timerAfterMedia,
    };
  }

  /**
   * A listen-first question still before its answers: frozen (the game's pause),
   * by what is left of the clock, since the start itself only moves at the thaw.
   */
  private listening(meta: GameMeta, now: number): boolean {
    if (meta.clockFrozen) {
      return (meta.pausedRemainingMs ?? 0) > meta.questionEndsAt - meta.questionStartedAt;
    }
    return now < meta.questionStartedAt;
  }

  private async saveAnchor(
    gameId: GameId,
    step: number | string,
    anchor: MediaAnchor,
  ): Promise<void> {
    await this.redis.set(
      gameKeys.mediaAnchor(gameId, step),
      JSON.stringify(anchor),
      'EX',
      GAME_TTL_S,
    );
  }

  private async readAnchor(gameId: GameId, step: number | string): Promise<MediaAnchor | null> {
    const raw = await this.redis.get(gameKeys.mediaAnchor(gameId, step));
    return raw ? (JSON.parse(raw) as MediaAnchor) : null;
  }

  /**
   * The clock freezes or thaws (the game's pause, the host gone): a media the host
   * anchored playing is re-anchored where it stands, so a screen that joins after
   * the pause does not count the pause as played. `step`: a slide's (#125), else
   * the current question's.
   */
  private async reanchor(
    pin: string,
    meta: GameMeta,
    phase: 'freeze' | 'thaw',
    step: PreloadStep = { questionIndex: meta.currentIndex },
  ): Promise<void> {
    const anchor = await this.readAnchor(meta.id, mediaStepKey(step));
    if (!anchor?.playing) return;
    const now = Date.now();
    const next =
      phase === 'freeze'
        ? { ...anchor, t: anchor.t + (now - anchor.at) / 1000, at: now }
        : { ...anchor, at: now };
    await this.saveAnchor(meta.id, mediaStepKey(step), next);
    if (phase === 'thaw') {
      this.server.to(pin).emit('media:control', { ...stepRef(step), ...next });
    }
  }

  /**
   * A slide that plays holds (#125) — the game's pause, the host gone: when it
   * stopped is kept, so the start moves by the pause at the thaw. Idempotent,
   * like the question's clock: the two causes may nest.
   */
  private async freezeSlide(pin: string, meta: GameMeta): Promise<void> {
    if (meta.state !== GameState.SlideShow || !meta.slideMediaStartAt || meta.slidePausedAt) return;
    const now = Date.now();
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ slidePausedAt: now }));
    meta.slidePausedAt = now;
    const step = slideStep(meta);
    await this.reanchor(pin, meta, 'freeze', step);
  }

  /** The slide's media go on (#125): their common start moves by the pause, every screen is told. */
  private async thawSlide(pin: string, meta: GameMeta): Promise<void> {
    if (!meta.slidePausedAt || !meta.slideMediaStartAt) return;
    const now = Date.now();
    const start = meta.slideMediaStartAt + Math.max(0, now - meta.slidePausedAt);
    await this.redis.hset(
      gameKeys.game(meta.id),
      gameHash({ slideMediaStartAt: start, slidePausedAt: 0 }),
    );
    meta.slideMediaStartAt = start;
    meta.slidePausedAt = 0;
    const step = slideStep(meta);
    await this.reanchor(pin, meta, 'thaw', step);
  }

  /** Runs `command` once the room's previous clock command is done (see `clockCommands`). */
  private oneClockCommandAtATime(pin: string, command: () => Promise<void>): Promise<void> {
    const previous = this.clockCommands.get(pin) ?? Promise.resolve();
    // A command that failed (refused, say) does not hold back the next one.
    const run = previous.catch(() => undefined).then(command);
    const settled = run.catch(() => undefined);
    this.clockCommands.set(pin, settled);
    void settled.then(() => {
      if (this.clockCommands.get(pin) === settled) this.clockCommands.delete(pin);
    });
    return run;
  }

  /**
   * `host:pause` : suspend/reprend l'auto-progression. En ANSWERING, gèle aussi
   * le chrono (primitive partagée avec le `HOST_DISCONNECTED`), sur une slide qui
   * joue, ses médias. La reprise dégèle (nouveau timing diffusé) et ré-arme
   * l'enchaînement auto si besoin. Idempotent : re-pauser/re-reprendre est sans
   * effet (hors diffusion d'état).
   */
  setPaused(pin: string, hostUserId: string, paused: boolean): Promise<void> {
    return this.oneClockCommandAtATime(pin, () => this.pauseOrResume(pin, hostUserId, paused));
  }

  private async pauseOrResume(pin: string, hostUserId: string, paused: boolean): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ paused }));
    meta.paused = paused;
    if (paused) {
      this.timers.cancel('autoNext', pin);
      await this.freezeClock(pin, meta);
    } else if (meta.state === GameState.SlideShow && meta.slidePausedAt) {
      // A slide's media go on from where they stood (#125); a screen looking back
      // at another step gets the slide again only when it comes back to it.
      await this.thawSlide(pin, meta);
      const snapshot = await this.game.getSnapshot(meta.id);
      const show =
        snapshot && !meta.reviewStep
          ? await this.slideShowNow(refOf(pin, meta), meta, snapshot)
          : null;
      if (show) this.server.to(pin).emit('slide:show', show);
      await this.scheduleAutoNextIfNeeded(refOf(pin, meta), meta);
    } else {
      if (meta.state === GameState.Answering && meta.clockFrozen) {
        const t = await this.thawClock(pin, meta);
        if (t) {
          this.server.to(pin).emit('question:time', {
            questionIndex: meta.currentIndex,
            startedAt: t.startedAt,
            endsAt: t.endsAt,
            ...mediaStartOf(meta.mediaLeadMs, t.startedAt),
          });
        }
      }
      await this.scheduleAutoNextIfNeeded(refOf(pin, meta), meta);
    }
    this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
  }

  /**
   * `host:adjust-time` : ajoute/retire `deltaS` secondes au chrono de la question
   * courante (boutons ±). Retirer au-delà du restant révèle immédiatement (pas de
   * timer mort). Si le chrono est gelé (pause), on ajuste le restant figé.
   */
  adjustTime(pin: string, hostUserId: string, deltaS: number): Promise<void> {
    return this.oneClockCommandAtATime(pin, () => this.moveEnd(pin, hostUserId, deltaS));
  }

  private async moveEnd(pin: string, hostUserId: string, deltaS: number): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Answering) {
      throw new BadRequestException('session.timer_not_adjustable');
    }
    requireNumber(deltaS);
    const deltaMs = Math.trunc(deltaS) * 1000;

    if (meta.clockFrozen) {
      const remaining = Math.max(CHRONO_FLOOR_MS, (meta.pausedRemainingMs ?? 0) + deltaMs);
      await this.redis.hset(gameKeys.game(meta.id), gameHash({ pausedRemainingMs: remaining }));
      meta.pausedRemainingMs = remaining;
      this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
      return;
    }

    const now = Date.now();
    const newEndsAt = meta.questionEndsAt + deltaMs;
    if (newEndsAt - now <= CHRONO_FLOOR_MS) {
      await this.advanceToReveal(pin, meta.currentIndex, 'host', meta.id); // restant épuisé → reveal
      return;
    }
    await this.redis.hset(gameKeys.game(meta.id), gameHash({ questionEndsAt: newEndsAt }));
    meta.questionEndsAt = newEndsAt;
    this.scheduleReveal(refOf(pin, meta), meta.currentIndex, newEndsAt + GRACE_MS - now);
    this.server.to(pin).emit('question:time', {
      questionIndex: meta.currentIndex,
      startedAt: meta.questionStartedAt,
      endsAt: newEndsAt,
      ...mediaStartOf(meta.mediaLeadMs, meta.questionStartedAt),
    });
  }

  /** Construit le payload mode/pause (restant figé + deadline d'enchaînement auto). */
  private buildModePayload(meta: GameMeta): GameModePayload {
    // Countdown shown on a reveal in auto mode, or on a timed slide in any mode (#7).
    const onTimedStep =
      meta.mode === 'auto' && (isSettled(meta.state) || meta.state === GameState.SlideShow);
    const autoNextActive = onTimedStep && !meta.paused && (meta.autoNextAt ?? 0) > 0;
    return {
      mode: meta.mode,
      paused: meta.paused,
      ...(meta.clockFrozen ? { remainingMs: meta.pausedRemainingMs ?? 0 } : {}),
      ...(autoNextActive
        ? {
            autoNextAt: meta.autoNextAt,
            autoNextMs: meta.autoNextMs || defaultAutoAdvanceMs(),
          }
        : {}),
    };
  }

  /** Lit le mode/pause courant (fallback `manual` si la partie a disparu). */
  private async readMode(pin: string): Promise<GameModePayload> {
    const meta = await this.game.getMeta(pin);
    return meta ? this.buildModePayload(meta) : { mode: 'manual', paused: false };
  }

  /**
   * Gèle le chrono de la question (ms restantes figées). **Idempotent** : si déjà
   * gelé (l'autre chemin — pause ou hôte parti — l'a fait), ne réécrit rien, le
   * restant est préservé. No-op hors ANSWERING (les autres états n'ont pas d'horloge).
   */
  private async freezeClock(pin: string, meta: GameMeta): Promise<void> {
    if (meta.state === GameState.SlideShow) await this.freezeSlide(pin, meta);
    if (meta.clockFrozen || meta.state !== GameState.Answering) return;
    const remaining = Math.max(0, meta.questionEndsAt - Date.now());
    this.timers.cancel('reveal', pin);
    await this.redis.hset(
      gameKeys.game(meta.id),
      gameHash({ clockFrozen: true, pausedRemainingMs: remaining }),
    );
    meta.clockFrozen = true;
    meta.pausedRemainingMs = remaining;
    await this.reanchor(pin, meta, 'freeze');
  }

  /**
   * Dégèle le chrono : recalcule des timings serveur sur le restant figé et ré-arme
   * la fin de question. **Idempotent** : no-op (renvoie `null`) si non gelé.
   */
  private async thawClock(
    pin: string,
    meta: GameMeta,
  ): Promise<{ startedAt: number; endsAt: number } | null> {
    if (!meta.clockFrozen) return null;
    const now = Date.now();
    const { startedAt, endsAt } = resumeQuestionWindow(meta, now);
    await this.redis.hset(
      gameKeys.game(meta.id),
      gameHash({
        clockFrozen: false,
        pausedRemainingMs: null,
        questionStartedAt: startedAt,
        questionEndsAt: endsAt,
      }),
    );
    meta.clockFrozen = false;
    meta.pausedRemainingMs = undefined;
    meta.questionStartedAt = startedAt;
    meta.questionEndsAt = endsAt;
    this.scheduleReveal(refOf(pin, meta), meta.currentIndex, endsAt + GRACE_MS - now);
    await this.reanchor(pin, meta, 'thaw');
    return { startedAt, endsAt };
  }

  /**
   * Arme l'enchaînement automatique vers la question suivante si la partie est en
   * mode auto, non en pause, et sur un reveal (§8). Plusieurs points d'entrée :
   * fin de `advanceToReveal`, passage en auto, ou reprise — d'où l'idempotence.
   */
  private async scheduleAutoNextIfNeeded(ref: GameRef, meta?: GameMeta): Promise<void> {
    const { pin } = ref;
    const m = meta ?? (await this.currentMeta(ref));
    // Auto mode only: in manual mode the host clicks through slides and reveals alike.
    if (!m || m.paused || m.mode !== 'auto') return;
    const snapshot = await this.game.getSnapshot(ref.id);
    let delay: number;
    if (m.state === GameState.SlideShow) {
      // Slide (#7): null = engine default, N = N seconds, 0 = the host clicks (manual override).
      const slide = snapshot?.slides[m.slideIndex ?? -1];
      const slideDelay = slide?.displayDelayS ?? null;
      if (slideDelay === 0) return;
      delay = slideDelay ? slideDelay * 1000 : defaultAutoAdvanceMs();
      // Stretched until its timed media has played, and the quiz's pause after it (#125).
      if (slide?.mediaHoldMs && m.slideMediaStartAt) {
        delay = Math.max(delay, m.slideMediaStartAt + slide.mediaHoldMs - Date.now());
      }
    } else if (m.state === GameState.Reveal) {
      // Per-question override (#6), else the engine default.
      const perQuestion = snapshot?.questions[m.currentIndex]?.revealDelayS;
      delay = perQuestion ? perQuestion * 1000 : defaultAutoAdvanceMs();
    } else if (m.state === GameState.Leaderboard) {
      delay = defaultAutoAdvanceMs();
    } else {
      return;
    }
    this.timers.cancel('autoNext', pin);
    // Deadline diffusée à la console (compte à rebours + barre de progression).
    const autoNextAt = Date.now() + delay;
    m.autoNextAt = autoNextAt;
    m.autoNextMs = delay;
    await this.redis.hset(gameKeys.game(ref.id), gameHash({ autoNextAt, autoNextMs: delay }));
    const hostUserId = m.hostUserId;
    // The timer only fires for the exact step it was armed on (question or slide).
    const step =
      m.state === GameState.SlideShow
        ? `s${m.slideIndex ?? 0}`
        : m.state === GameState.Leaderboard
          ? `l${m.currentIndex}`
          : m.currentIndex;
    this.timers.arm('autoNext', pin, delay, () => this.autoAdvance(ref, hostUserId, step));
  }

  /** Timer fired: advance only if the game still sits on the step it was armed for. */
  private async autoAdvance(
    ref: GameRef,
    hostUserId: string,
    step: number | string,
  ): Promise<void> {
    const { pin } = ref;
    const meta = await this.currentMeta(ref);
    if (!meta || meta.paused) return;
    if (meta.mode !== 'auto') return;
    const onSlide = meta.state === GameState.SlideShow && step === `s${meta.slideIndex ?? 0}`;
    const onReveal = meta.state === GameState.Reveal && step === meta.currentIndex;
    const onStandings = meta.state === GameState.Leaderboard && step === `l${meta.currentIndex}`;
    if (!onSlide && !onReveal && !onStandings) return;
    await this.next(pin, hostUserId);
  }

  /** `game:ended`: whether players may rate the quiz (§2.11; yes when the snapshot is gone), and which. */
  private async endedPayload(
    gameId: GameId,
  ): Promise<{ feedbackEnabled: boolean; quizId?: string }> {
    const snapshot = await this.game.getSnapshot(gameId);
    return {
      feedbackEnabled: snapshot?.feedbackEnabled ?? true,
      ...(snapshot ? { quizId: snapshot.quizId } : {}),
    };
  }

  /** The game's ranking (see `rankPlayers`), indexed once for every socket of an event. */
  private async ranking(ref: GameRef): Promise<Ranking> {
    return rankingOf(await this.game.rankedPlayers(ref.pin, ref.id));
  }

  /**
   * `player:submit` : note une réponse avec **timing serveur autoritatif** (§6).
   * Rejette (accepted=false, sans scorer) si hors fenêtre [startedAt, endsAt+grace]
   * ou si le joueur a déjà répondu (unicité atomique `HSETNX`, RG-06). Le résultat
   * gradé est stocké (REVEAL le relit, pas de re-notation), le score de la partie
   * est mis à jour, et `answer:count` est diffusé. Si tous les joueurs connectés ont
   * répondu, arme le REVEAL anticipé (2e chemin de convergence).
   *
   * @returns accusé à renvoyer au socket émetteur (answer:ack).
   */
  async submit(
    pin: string,
    playerId: string,
    questionIndex: number,
    answer: AnswerValue,
    receivedAt: number,
  ): Promise<AnswerAck> {
    const meta = await this.game.getMeta(pin);
    // A refused answer is not counted, and the player's device says so: logged, so a
    // lost answer can be traced (it would otherwise only show as a question timed out).
    const reject = (reason: AnswerRefusal): AnswerAck => {
      this.log.log(`answer refused ${pin} q${questionIndex} ${playerId}: ${reason}`);
      return { accepted: false, receivedAt, reason };
    };
    if (!meta || meta.state !== GameState.Answering || meta.currentIndex !== questionIndex) {
      return reject('closed'); // mauvaise question / fenêtre fermée
    }
    if (receivedAt < meta.questionStartedAt) {
      return reject('early'); // trop tôt : fenêtre de lecture (§6)
    }
    if (receivedAt > meta.questionEndsAt + GRACE_MS) {
      return reject('late'); // hors délai (§6)
    }

    const player = await this.game.getPlayer(pin, playerId);
    const scored = await this.game.getScore(meta.id, playerId);
    const snapshot = await this.game.getSnapshot(meta.id);
    if (!player || !scored || !snapshot) {
      return reject('unknown'); // gone, not in this game, or the game is gone
    }
    const question = snapshot.questions[questionIndex];
    // Already answered: refused before grading (the script below stays the guard).
    if (await this.redis.hexists(gameKeys.answers(meta.id, questionIndex), playerId)) {
      return reject('duplicate');
    }

    // Temps serveur compensé de la latence (§6) ; latencyMs = RTT/2 (0 tant que non câblé).
    const tMs = Math.max(0, receivedAt - meta.questionStartedAt - player.latencyMs);
    const score = scoreAnswer({ question, answer, tMs, prevStreak: scored.streak });
    const record: AnswerRecord = {
      answer,
      isCorrect: score.correct,
      pointsAwarded: score.points,
      credit: score.credit,
      tMs,
      receivedAt,
    };

    // Unicité : 1re réponse gagne (RG-06), tant que le reveal n'a pas commencé : il
    // compte alors exactement les réponses qu'il montre (atomique avec son verrou).
    const won = await this.redis.eval(
      ANSWER_ONCE_SCRIPT,
      2,
      gameKeys.answers(meta.id, questionIndex),
      gameKeys.revealLock(meta.id, questionIndex),
      playerId,
      JSON.stringify(record),
    );
    if (won === -1) return reject('closed');
    if (won === 0) {
      return reject('duplicate');
    }
    await this.redis.expire(gameKeys.answers(meta.id, questionIndex), GAME_TTL_S);

    // Applique le score (read-modify-write sûr : 1 seul socket par joueur).
    scored.score += score.points;
    scored.streak = score.newStreak;
    await this.redis.hset(gameKeys.scores(meta.id), playerId, JSON.stringify(scored));

    await this.countAnswers(refOf(pin, meta), questionIndex);
    return { accepted: true, receivedAt };
  }

  /**
   * After an answer: the count to the room, and the reveal armed once everyone
   * answered. At most one count every `ANSWER_COUNT_EVERY_MS` per room: an answer
   * in a quiet moment goes out at once, those that follow within the window go
   * out together at its end, the last one always. At 400 players the room got a
   * message per answer to every device, 160,000 a question, and the players were
   * counted on every answer; now about ten times a second at most.
   */
  private async countAnswers(ref: GameRef, questionIndex: number): Promise<void> {
    const last = this.answerCounts.get(ref.pin);
    const sinceMs = Date.now() - (last?.at ?? 0);
    if (last && (last.waiting || sinceMs < ANSWER_COUNT_EVERY_MS)) {
      if (!last.waiting) {
        last.waiting = true;
        this.timers.arm('answerCount', ref.pin, ANSWER_COUNT_EVERY_MS - sinceMs, () =>
          this.sendAnswerCount(ref, questionIndex, true),
        );
      }
      return;
    }
    await this.sendAnswerCount(ref, questionIndex, true);
  }

  /**
   * The answer count out now. §8: over the players **connected**, not all who ever
   * joined (one departure would otherwise hold the question until its timer). With
   * `converge`, everyone answered arms the reveal a moment later, the last tick heard
   * apart from the gong. A count sent once the question is revealed still goes out (an
   * answer taken just before), but arms nothing.
   */
  private async sendAnswerCount(
    ref: GameRef,
    questionIndex: number,
    converge: boolean,
  ): Promise<void> {
    this.timers.cancel('answerCount', ref.pin);
    this.answerCounts.set(ref.pin, { at: Date.now(), waiting: false });
    const meta = await this.currentMeta(ref);
    if (!meta || meta.currentIndex !== questionIndex) return;
    if (meta.state !== GameState.Answering && meta.state !== GameState.Reveal) return;
    const { answered, total, allAnswered } = await this.connectedProgress(ref, questionIndex);
    this.server.to(ref.pin).emit('answer:count', { answered, total });
    if (converge && allAnswered && meta.state === GameState.Answering) {
      const delay = settings.get(SETTINGS.GAME_ALL_ANSWERED_DELAY_MS);
      this.scheduleReveal(ref, questionIndex, delay, 'all');
    }
  }

  /**
   * Takes a one-time lock (Redis `SET NX`, kept as long as the game): true for
   * the first caller only. How two ways to one transition — a timer and the
   * host, a double click — end up with one winner.
   */
  private async firstThrough(lock: string): Promise<boolean> {
    return (await this.redis.set(lock, '1', 'EX', GAME_TTL_S, 'NX')) === 'OK';
  }

  /** The room's game, as long as it is still `ref`'s (null once the room plays another). */
  private async currentMeta(ref: GameRef): Promise<GameMeta | null> {
    const meta = await this.game.getMeta(ref.pin);
    return meta && meta.id === ref.id ? meta : null;
  }

  /**
   * Charge les méta en exigeant que l'appelant soit l'hôte propriétaire : la seule
   * garde d'hôte, pour le moteur, la gateway (`host:attach`) et l'API REST.
   */
  async requireHost(pin: string, hostUserId: string): Promise<GameMeta> {
    const meta = await this.game.getMeta(pin);
    if (!meta) {
      throw new NotFoundException('session.not_found');
    }
    if (meta.hostUserId !== hostUserId) {
      throw new ForbiddenException('host.forbidden');
    }
    return meta;
  }

  /**
   * The session's snapshot; `refresh` re-reads the quiz first so the form of
   * the steps still to come follows the editor (substance stays frozen).
   */
  private async requireSnapshot(gameId: GameId, refresh = false): Promise<QuizSnapshot> {
    const snapshot = refresh
      ? await this.game.refreshSnapshot(gameId)
      : await this.game.getSnapshot(gameId);
    if (!snapshot) {
      throw new BadRequestException('session.snapshot_not_found');
    }
    return snapshot;
  }
}

/** What the screens are sent of the room's sounds: URLs and levels, never media ids. */
function soundsPayload(s: RoomSounds): RoomSoundsPayload {
  return {
    tick: s.tick,
    gong: s.gong,
    countdown: s.countdown,
    ding: s.ding,
    tickUrl: s.tickUrl,
    gongUrl: s.gongUrl,
    dingUrl: s.dingUrl,
    countdownUrl: s.countdownUrl,
    musicUrl: s.musicUrl,
    musicLevel: s.musicLevel,
    sfxLevel: s.sfxLevel,
    musicMuted: s.musicMuted,
    sfxMuted: s.sfxMuted,
    mediaLevel: s.mediaLevel,
    mediaMuted: s.mediaMuted,
    muted: s.muted,
  };
}

/** The longest room name kept (the projection shows it as a title). */
const ROOM_NAME_MAX = 60;

/** `http(s)://host[:port]`, no path, no trailing slash; '' when not a URL. */
export function normalizeBaseUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    if (u.username || u.password || u.search || u.hash) return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** A number sent by a client (a ban's minutes, a time adjustment): anything else is refused. */
function requireNumber(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException('validation');
  }
}

/** Prisma's foreign-key violation (P2003), e.g. archiving a session whose quiz was deleted. */
function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2003';
}
