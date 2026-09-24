import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AUDIO_TARGETS, GameState, mediaDurationMs } from '@quiz-dock/contracts';
import type {
  AnswerValue,
  AudioTarget,
  GameMode,
  GameModePayload,
  GameStatePayload,
  GameStep,
  LeaderboardPayload,
  LeaderboardRow,
  MediaPreloadPayload,
  MediaReadinessPayload,
  PlayerPresence,
  PodiumPayload,
  QuestionRevealPayload,
  ServerToClientEvents,
} from '@quiz-dock/contracts';
import type { Server } from 'socket.io';
import { GameService } from './game.service';
import {
  AUTO_ADVANCE_MS,
  CHRONO_FLOOR_MS,
  GAME_TTL_S,
  GRACE_MS,
  HOST_GRACE_MS,
  HOST_RECONNECT_WINDOW_MS,
  MEDIA_LEAD_MS,
  MEDIA_WAIT_S,
  READ_DELAY_MS,
  gameKeys,
} from './game.keys';
import type {
  AnswerRecord,
  GameMeta,
  PlayerRecord,
  QuizSnapshot,
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
  hasSoundOrVideo,
  mediaForDevice,
  preloadFor,
  snapshotHasMedia,
} from './preload';
import {
  buildQuestionStart,
  buildSlideShow,
  gameAudioTarget,
  questionAudioTarget,
  questionHasSound,
  snapshotHasSound,
} from './snapshot';

type GameServer = Server<Record<string, never>, ServerToClientEvents>;

/** Auto-mode delay on a REVEAL when the question sets none (#6): env override, else constant. */
const defaultAutoAdvanceMs = () => Number(process.env.GAME_AUTO_ADVANCE_MS ?? AUTO_ADVANCE_MS);

/**
 * Cible d'émission unitaire : satisfaite à la fois par un `Socket` local (gateway)
 * et un `RemoteSocket` (`fetchSockets()`). Permet de partager le calcul du reveal
 * personnel entre la diffusion live et la relecture d'état (reconnexion / late join).
 */
/** The media's start derived from `startedAt`, as a payload fragment (empty when silent). */
function mediaStartOf(
  mediaLeadMs: number | null | undefined,
  startedAt: number,
): { mediaStartAt?: number } {
  return mediaLeadMs == null ? {} : { mediaStartAt: startedAt - mediaLeadMs };
}

interface Emitter {
  data: { playerId?: string };
  emit<E extends keyof ServerToClientEvents>(
    ev: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): unknown;
}

type RankedPlayer = PlayerRecord & { id: string };

/**
 * Machine à états de la partie (SPECIFICATIONS §8). Le timer n'est qu'un
 * **déclencheur** vers `advanceToReveal`, transition rendue **idempotente** par un
 * verrou atomique Redis (NX) : les deux chemins de convergence (timer écoulé /
 * tous ont répondu) et `host:reveal` passent par le même verrou — 1 seul gagnant,
 * pas de double `reveal`. Mono-instance v1 : les timers vivent en mémoire (le gap
 * « restart process perd le timer » est adressé en P4, cf. mémoire gameplay-v0-3).
 */
@Injectable()
export class GameEngine {
  private readonly log = new Logger(GameEngine.name);
  private server!: GameServer;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Délai de grâce avant `HOST_DISCONNECTED` (§7.1) — par PIN. */
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  /** Fenêtre de reconnexion hôte avant fin auto (§7.3) — par PIN. */
  private readonly endWindowTimers = new Map<string, NodeJS.Timeout>();
  /** Minuterie d'enchaînement automatique en mode auto (§8) — par PIN. */
  private readonly autoNextTimers = new Map<string, NodeJS.Timeout>();
  /** End of a media wait (`MEDIA_LOADING`): the cap, after which the question starts anyway. */
  private readonly mediaWaitTimers = new Map<string, NodeJS.Timeout>();

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
    const keys = await this.redis.keys('game:[0-9]*');
    let armed = 0;
    for (const key of keys) {
      if (!/^game:\d+$/.test(key)) continue;
      const pin = key.slice('game:'.length);
      const meta = await this.game.getMeta(pin);
      if (!meta) continue;
      if (meta.state === GameState.Answering && !meta.clockFrozen) {
        this.scheduleReveal(pin, meta.currentIndex, meta.questionEndsAt + GRACE_MS - Date.now());
        armed++;
      } else if (meta.state === GameState.MediaLoading) {
        this.armMediaWait(pin, meta.currentIndex, (meta.mediaWaitUntil ?? 0) - Date.now());
        armed++;
      } else if (meta.state === GameState.Reveal || meta.state === GameState.SlideShow) {
        if (meta.mode === 'auto' && !meta.paused && !meta.reviewStep) {
          await this.scheduleAutoNextIfNeeded(pin, meta);
          armed++;
        }
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
    const snapshot = await this.requireSnapshot(pin, true);
    await this.enterStep(pin, snapshot, 0);
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
    await this.redis.hset(gameKeys.game(pin), { fullCapture: fullCapture ? '1' : '0' });
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
    opts: { personalTracking?: boolean; pickOwnName?: boolean; audioTarget?: AudioTarget },
  ): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.options_locked');
    }
    if (opts.audioTarget !== undefined) await this.setAudioTarget(pin, opts.audioTarget);
    if (opts.personalTracking === undefined && opts.pickOwnName === undefined) return;
    const next = {
      ...meta,
      personalTracking: opts.personalTracking ?? meta.personalTracking,
      pickOwnName: opts.pickOwnName ?? meta.pickOwnName,
    };
    await this.redis.hset(gameKeys.game(pin), {
      personalTracking: next.personalTracking ? '1' : '0',
      pickOwnName: next.pickOwnName ? '1' : '0',
    });
    this.server.to(pin).emit('notice', noticeOf(next));
  }

  /**
   * The host replaces the quiz's default audio target for this game; the
   * screens that are not players hear of it (the console shows the choice).
   */
  private async setAudioTarget(pin: string, target: AudioTarget): Promise<void> {
    if (!AUDIO_TARGETS.includes(target)) return; // not one of ours: nothing to change
    await this.redis.hset(gameKeys.game(pin), { audioTarget: target });
    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot) return;
    const payload = {
      hasSound: snapshotHasSound(snapshot),
      hasMedia: snapshotHasMedia(snapshot),
      audioTarget: gameAudioTarget(snapshot, target),
    };
    for (const socket of await this.server.in(pin).fetchSockets()) {
      if (!(socket.data as { playerId?: string }).playerId) socket.emit('game:media', payload);
    }
    // Who needs what may have changed (the phones in the room, for every device).
    await this.emitPreload(pin, snapshot, 0);
    await this.broadcastReadiness(pin);
  }

  /**
   * Tells each device (or `only` one) what to fetch ahead of question `index`:
   * only what it will show or play (see `preloadFor`), never the question itself.
   */
  private async emitPreload(
    pin: string,
    snapshot: QuizSnapshot,
    index: number,
    only?: Emitter,
  ): Promise<void> {
    if (index > snapshot.questions.length) return;
    const gameTarget = await this.gameTarget(pin, snapshot);
    const players = await this.redis.hgetall(gameKeys.players(pin));
    const payloads = new Map<PreloadDevice, MediaPreloadPayload | null>();
    const sockets: Emitter[] = only ? [only] : await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = socket.data.playerId;
      const record = playerId && players[playerId];
      const device: PreloadDevice = !playerId
        ? 'screen'
        : ((record ? (JSON.parse(record) as PlayerRecord).presence : undefined) ?? 'room');
      if (!payloads.has(device)) {
        payloads.set(device, preloadFor(snapshot, index, gameTarget, device));
      }
      const payload = payloads.get(device);
      if (payload) socket.emit('media:preload', payload);
    }
  }

  /** The question the room gets ready for: the first in the lobby, the next at a reveal. */
  private upcomingIndex(meta: GameMeta): number {
    if (meta.state === GameState.Lobby) return 0;
    if (meta.state === GameState.Reveal || meta.state === GameState.Leaderboard) {
      return meta.currentIndex + 1;
    }
    return Math.max(0, meta.currentIndex);
  }

  /**
   * `media:ready`: a device has loaded what it fetched ahead of a question; the
   * screens see the count move.
   */
  async markMediaReady(
    pin: string,
    socket: { id: string; data: { playerId?: string } },
    questionIndex: number,
  ): Promise<void> {
    if (!Number.isInteger(questionIndex) || questionIndex < 0) return;
    const device = socket.data.playerId ?? `screen:${socket.id}`;
    const key = gameKeys.ready(pin, questionIndex);
    await this.redis.multi().sadd(key, device).expire(key, GAME_TTL_S).exec();
    await this.broadcastReadiness(pin);
  }

  /**
   * Who is waited for, and who is ready, ahead of question `index`: the
   * projection windows when it has a sound or a video, and the connected
   * participants whose device will play one. Null past the last question.
   */
  async readiness(pin: string, index: number): Promise<MediaReadinessPayload | null> {
    const snapshot = await this.game.getSnapshot(pin);
    const question = snapshot?.questions[index];
    if (!snapshot || !question) return null;
    const target = questionHasSound(question)
      ? questionAudioTarget(question, await this.gameTarget(pin, snapshot))
      : undefined;
    const ready = new Set(await this.redis.smembers(gameKeys.ready(pin, index)));
    const sockets = await this.server.in(pin).fetchSockets();
    const screens = hasSoundOrVideo(question.media)
      ? sockets.filter(
          (s) =>
            !(s.data as { playerId?: string }).playerId &&
            !(s.data as { isHostControl?: boolean }).isHostControl,
        )
      : [];
    const screensReady = screens.filter((s) => ready.has(`screen:${s.id}`)).length;
    const players: { playerId: string; ready: boolean }[] = [];
    for (const [playerId, json] of Object.entries(
      await this.redis.hgetall(gameKeys.players(pin)),
    )) {
      const rec = JSON.parse(json) as PlayerRecord;
      if (!rec.connected) continue;
      if (hasSoundOrVideo(mediaForDevice(question.media, target, rec.presence ?? 'room'))) {
        players.push({ playerId, ready: ready.has(playerId) });
      }
    }
    return {
      questionIndex: index,
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
    const payload = await this.readiness(pin, this.upcomingIndex(meta));
    if (!payload) return;
    for (const socket of await this.server.in(pin).fetchSockets()) {
      if (!(socket.data as { playerId?: string }).playerId) socket.emit('media:readiness', payload);
    }
    // The last device waited for is ready (or the last one not ready left): go.
    if (meta.state === GameState.MediaLoading && payload.ready >= payload.total) {
      await this.endMediaWait(pin, meta.currentIndex);
    }
  }

  /** The game's default audio target, read fresh (the host may change it in the lobby). */
  private async gameTarget(pin: string, snapshot: QuizSnapshot): Promise<AudioTarget> {
    const session = await this.redis.hget(gameKeys.game(pin), 'audioTarget');
    return gameAudioTarget(snapshot, session as AudioTarget | null);
  }

  /**
   * Moves the sequence to question `index`: shows the slides anchored before it
   * first (#7), then the question itself; past the last question, the podium.
   */
  private async enterStep(pin: string, snapshot: QuizSnapshot, index: number): Promise<void> {
    const slideIndex = snapshot.slides.findIndex((s) => s.beforeQuestionIndex === index);
    if (slideIndex >= 0) {
      await this.showSlide(pin, snapshot, slideIndex);
    } else if (index >= snapshot.questions.length) {
      const meta = await this.game.getMeta(pin);
      if (meta) await this.toPodium(pin, meta);
    } else {
      await this.beginQuestion(pin, snapshot, index);
    }
  }

  /**
   * Shows content slide `slideIndex` (state `SLIDE_SHOW`, #7). `currentIndex`
   * points at the question that follows, so `game:state.questionIndex` stays
   * meaningful for progress displays. Arms the display timer when the slide has one.
   */
  private async showSlide(pin: string, snapshot: QuizSnapshot, slideIndex: number): Promise<void> {
    const slide = snapshot.slides[slideIndex];
    this.clearTimer(pin);
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.SlideShow,
      slideIndex: String(slideIndex),
      currentIndex: String(slide.beforeQuestionIndex),
      clockFrozen: '0',
      pausedRemainingMs: '',
      autoNextAt: '0',
    });
    const meta = await this.game.getMeta(pin);
    this.server.to(pin).emit('game:state', {
      state: GameState.SlideShow,
      questionIndex: slide.beforeQuestionIndex,
      totalQuestions: snapshot.questions.length,
      nav: meta ? this.navFor(meta, snapshot) : undefined,
    });
    this.server.to(pin).emit('slide:show', buildSlideShow(slide, slideIndex));
    if (meta) await this.scheduleAutoNextIfNeeded(pin, meta);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  /**
   * Ouvre la question `index` : fixe les timings serveur autoritatifs, diffuse
   * `game:state` (ANSWERING) + `question:start` (allowlist), arme le timer de fin.
   */
  /**
   * Opens question `index` — unless a device that plays its sound or video has
   * not loaded it: the room then waits (`MEDIA_LOADING`) until every such device
   * is ready, the cap runs out, or the host starts anyway. A silent question, or
   * a room already ready, starts at once.
   */
  private async beginQuestion(pin: string, snapshot: QuizSnapshot, index: number): Promise<void> {
    const waitS = Number(process.env.GAME_MEDIA_WAIT_S ?? MEDIA_WAIT_S);
    const readiness = waitS > 0 ? await this.readiness(pin, index) : null;
    if (!readiness || readiness.ready >= readiness.total) {
      await this.startQuestion(pin, snapshot, index);
      return;
    }
    const until = Date.now() + waitS * 1000;
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.MediaLoading,
      currentIndex: String(index),
      slideIndex: '-1',
      mediaWaitUntil: String(until),
      autoNextAt: '0',
    });
    this.server.to(pin).emit('game:state', {
      state: GameState.MediaLoading,
      questionIndex: index,
      totalQuestions: snapshot.questions.length,
    });
    this.server.to(pin).emit('media:wait', { questionIndex: index, until });
    this.armMediaWait(pin, index, until - Date.now());
    await this.broadcastReadiness(pin);
  }

  private armMediaWait(pin: string, index: number, delayMs: number): void {
    this.cancelTimer(this.mediaWaitTimers, pin);
    this.mediaWaitTimers.set(
      pin,
      setTimeout(
        () => {
          this.mediaWaitTimers.delete(pin);
          this.endMediaWait(pin, index).catch((err: Error) =>
            this.log.error(`endMediaWait ${pin}: ${err.message}`),
          );
        },
        Math.max(0, delayMs),
      ),
    );
  }

  /**
   * Leaves the media wait of question `index` and opens it — once, whoever gets
   * there first: every device ready, the cap, the host, the host coming back.
   */
  private async endMediaWait(pin: string, index: number): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.MediaLoading || meta.currentIndex !== index) return;
    const won = await this.redis.set(
      gameKeys.mediaWaitLock(pin, index),
      '1',
      'EX',
      GAME_TTL_S,
      'NX',
    );
    if (won !== 'OK') return;
    this.cancelTimer(this.mediaWaitTimers, pin);
    const snapshot = await this.game.getSnapshot(pin);
    if (snapshot) await this.startQuestion(pin, snapshot, index);
  }

  private async startQuestion(pin: string, snapshot: QuizSnapshot, index: number): Promise<void> {
    const question = snapshot.questions[index];
    const now = Date.now();
    // Délai de lecture configurable (§8, défaut 3 s) — lu au runtime (tests rapides).
    const readDelay = Number(process.env.GAME_READ_DELAY_MS ?? READ_DELAY_MS);
    // Every device starts the sound or video on the same instant of the server's clock.
    const mediaStartAt = now + MEDIA_LEAD_MS;
    // Listen first: the answers open once the media has played, not after the reading.
    const listenMs = question.timerAfterMedia ? (mediaDurationMs(question.media) ?? 0) : 0;
    const startedAt = Math.max(now + readDelay, mediaStartAt + listenMs); // fenêtre de lecture
    const endsAt = startedAt + question.timeLimitS * 1000;
    const mediaLeadMs = hasSoundOrVideo(question.media) ? startedAt - mediaStartAt : null;

    // Nouvelle question : chrono qui tourne, ni gelé ni en pause (un enchaînement
    // manuel pendant une pause reprend implicitement la main).
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.Answering,
      mediaWaitUntil: '0',
      currentIndex: String(index),
      slideIndex: '-1',
      questionStartedAt: String(startedAt),
      questionEndsAt: String(endsAt),
      mediaLeadMs: mediaLeadMs === null ? '' : String(mediaLeadMs),
      clockFrozen: '0',
      paused: '0',
      pausedRemainingMs: '',
    });

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
          await this.gameTarget(pin, snapshot),
          mediaLeadMs,
        ),
      );
    this.server.to(pin).emit('game:mode', await this.readMode(pin));

    this.scheduleReveal(pin, index, endsAt + GRACE_MS - now);
  }

  /** Arme (ou ré-arme) le timer de fin de question → `advanceToReveal`. */
  private scheduleReveal(pin: string, index: number, delayMs: number): void {
    this.clearTimer(pin);
    const timer = setTimeout(
      () => {
        this.timers.delete(pin);
        this.advanceToReveal(pin, index, 'timer').catch((err: Error) =>
          this.log.error(`advanceToReveal(timer) ${pin}: ${err.message}`),
        );
      },
      Math.max(0, delayMs),
    );
    timer.unref?.();
    this.timers.set(pin, timer);
  }

  private clearTimer(pin: string): void {
    const existing = this.timers.get(pin);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(pin);
    }
  }

  /**
   * ANSWERING → REVEAL. **Idempotente** : seul le 1er appelant qui pose le verrou
   * NX `reveal-lock:{index}` poursuit ; les autres (2e chemin, double-clic) sont
   * de vrais no-op. Émet l'état REVEAL (les payloads riches arrivent en P3-BACK-7).
   */
  async advanceToReveal(
    pin: string,
    index: number,
    trigger: 'timer' | 'all' | 'host',
  ): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.Answering || meta.currentIndex !== index) {
      return; // état déjà dépassé ou partie finie
    }
    const won = await this.redis.set(gameKeys.revealLock(pin, index), '1', 'EX', GAME_TTL_S, 'NX');
    if (won !== 'OK') {
      return; // un autre chemin a déjà révélé cette question
    }
    this.clearTimer(pin);
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Reveal });
    this.log.debug(`REVEAL ${pin} q${index} (${trigger})`);

    const snapshot = await this.game.getSnapshot(pin);
    // Numeric `closest`: the points wait for every answer — settle them now.
    if (snapshot && isDeferred(snapshot.questions[index])) {
      await this.settleClosest(pin, snapshot.questions[index], index);
    }
    this.server.to(pin).emit('game:state', {
      state: GameState.Reveal,
      questionIndex: index,
      totalQuestions: meta.totalQuestions,
      nav: snapshot ? this.navFor({ ...meta, state: GameState.Reveal }, snapshot) : undefined,
    });
    if (snapshot) {
      await this.emitReveal(pin, snapshot, index);
    }
    // Mode auto : enchaîne seul après le temps d'affichage du reveal (§8). On
    // rediffuse game:mode pour transmettre la deadline (compte à rebours console).
    await this.scheduleAutoNextIfNeeded(pin);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  /**
   * Diffuse `question:reveal` (résultat **personnel** par socket — §9) puis
   * `leaderboard`. Le reveal commun (bonnes réponses + répartition) est calculé
   * une fois ; `yourResult`/`you` sont ciblés socket par socket.
   */
  private async emitReveal(pin: string, snapshot: QuizSnapshot, index: number): Promise<void> {
    const question = snapshot.questions[index];
    const records = await this.readAnswers(pin, index);
    const common = await this.revealCommon(pin, question, records);

    const ranked = await this.rankedPlayers(pin);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const top = this.topRows(ranked);

    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit(
        'question:reveal',
        this.personalReveal(common, records, ranked, rankOf, playerId),
      );
      socket.emit('leaderboard', this.personalLeaderboard(top, ranked, rankOf, playerId));
    }
    // What comes next, fetched by every device while the leaderboard is up.
    await this.emitPreload(pin, snapshot, index + 1);
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
    const players = await this.redis.hgetall(gameKeys.players(pin));
    const rows = rankClosest(
      question,
      [...records.entries()].map(([key, r]) => ({ key, answer: r.answer })),
    );
    common.closest = rows.slice(0, 10).map((row) => {
      const p = players[row.key] ? (JSON.parse(players[row.key]) as PlayerRecord) : null;
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
    pin: string,
    question: SnapshotQuestion,
    index: number,
  ): Promise<void> {
    const records = await this.readAnswers(pin, index);
    if (records.size === 0) return;
    const rows = rankClosest(
      question,
      [...records.entries()].map(([key, r]) => ({ key, answer: r.answer })),
    );
    for (const row of rows) {
      const rec = records.get(row.key);
      const player = await this.getPlayer(pin, row.key);
      if (!rec || !player) continue;
      rec.pointsAwarded = row.points;
      rec.isCorrect = row.exact;
      rec.credit = row.points / (question.basePoints || 1);
      rec.closestRank = row.rank;
      rec.distance = row.distance;
      await this.redis.hset(gameKeys.answers(pin, index), row.key, JSON.stringify(rec));
      player.score += row.points;
      // Exact = a right answer for the streak; a near miss neither grows nor breaks it.
      if (row.exact) player.streak += 1;
      await this.redis.hset(gameKeys.players(pin), row.key, JSON.stringify(player));
      await this.redis.zadd(gameKeys.leaderboard(pin), player.score, row.key);
    }
  }

  /** Top 10 du classement (lignes publiques, sans rang personnel). */
  private topRows(ranked: RankedPlayer[]): LeaderboardRow[] {
    return ranked
      .slice(0, 10)
      .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1, avatar: p.avatar }));
  }

  /** Reveal commun + `yourResult` ciblé sur le joueur de ce socket (s'il en a un). */
  private personalReveal(
    common: QuestionRevealPayload,
    records: Map<string, AnswerRecord>,
    ranked: RankedPlayer[],
    rankOf: Map<string, number>,
    playerId: string | undefined,
  ): QuestionRevealPayload {
    const me = playerId ? ranked.find((p) => p.id === playerId) : undefined;
    if (!me) return { ...common };
    const rec = records.get(playerId!);
    return {
      ...common,
      yourResult: {
        correct: rec?.isCorrect ?? false,
        points: rec?.pointsAwarded ?? 0,
        totalScore: me.score,
        rank: rankOf.get(playerId!) ?? ranked.length,
        ...(rec?.credit !== undefined && rec.credit > 0 && rec.credit < 1
          ? { credit: rec.credit }
          : {}),
        ...(rec?.closestRank !== undefined
          ? { closestRank: rec.closestRank, distance: rec.distance }
          : {}),
      },
    };
  }

  /** Classement public + `you` ciblé sur le joueur de ce socket (s'il en a un). */
  private personalLeaderboard(
    top: LeaderboardRow[],
    ranked: RankedPlayer[],
    rankOf: Map<string, number>,
    playerId: string | undefined,
  ): LeaderboardPayload {
    const me = playerId ? ranked.find((p) => p.id === playerId) : undefined;
    return {
      top,
      you: me ? { score: me.score, rank: rankOf.get(me.id) ?? ranked.length } : undefined,
    };
  }

  /** `host:reveal` : force le passage en REVEAL (idempotent via le verrou). */
  async reveal(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.advanceToReveal(pin, meta.currentIndex, 'host');
  }

  /**
   * `host:next` : depuis REVEAL, passe à la question suivante ou au PODIUM (dernière).
   * Verrou atomique `advance-lock:{index}` → un double-clic ne saute pas de question.
   */
  async next(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    // Looking back: "next" brings every screen back to the live position.
    if (meta.reviewStep) {
      await this.resume(pin);
      return;
    }
    // Waiting for media: the host starts the question anyway.
    if (meta.state === GameState.MediaLoading) {
      await this.endMediaWait(pin, meta.currentIndex);
      return;
    }
    if (meta.state !== GameState.Reveal && meta.state !== GameState.SlideShow) {
      throw new BadRequestException('session.reveal_required');
    }
    this.cancelTimer(this.autoNextTimers, pin); // un enchaînement (auto/manuel) annule l'autre
    // A slide gets its own lock key: it shares `currentIndex` with the question it precedes.
    const lockStep =
      meta.state === GameState.SlideShow ? `s${meta.slideIndex ?? 0}` : String(meta.currentIndex);
    const won = await this.redis.set(
      gameKeys.advanceLock(pin, lockStep),
      '1',
      'EX',
      GAME_TTL_S,
      'NX',
    );
    if (won !== 'OK') {
      return; // suivant déjà déclenché (double-clic)
    }
    const snapshot = await this.requireSnapshot(pin, true);
    if (meta.state === GameState.SlideShow) {
      // Next slide sharing the anchor, else the anchored question (or the podium).
      const current = meta.slideIndex ?? 0;
      const following = snapshot.slides[current + 1];
      if (following && following.beforeQuestionIndex === meta.currentIndex) {
        await this.showSlide(pin, snapshot, current + 1);
      } else if (meta.currentIndex >= meta.totalQuestions) {
        await this.toPodium(pin, meta);
      } else {
        await this.beginQuestion(pin, snapshot, meta.currentIndex);
      }
      return;
    }
    await this.enterStep(pin, snapshot, meta.currentIndex + 1);
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
      ![GameState.Reveal, GameState.SlideShow, GameState.Podium].includes(meta.state as GameState)
    ) {
      throw new BadRequestException('session.review_unavailable');
    }
    const snapshot = await this.requireSnapshot(pin, true);
    const played = this.playedSteps(meta, snapshot);
    const key = stepKey(step);
    if (!played.includes(key)) throw new BadRequestException('session.step_not_played');
    if (key === this.liveStepKey(meta)) {
      await this.resume(pin);
      return;
    }
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), { reviewStep: key, autoNextAt: '0' });
    const fresh = { ...meta, reviewStep: key, autoNextAt: 0 };
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) await this.emitReviewTo(socket, pin, fresh, snapshot);
    this.server.to(pin).emit('game:mode', this.buildModePayload(fresh));
  }

  /** Back to the live position on every screen; re-arms the auto pace if it applies. */
  private async resume(pin: string): Promise<void> {
    await this.redis.hset(gameKeys.game(pin), { reviewStep: '' });
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) await this.sendStateTo(socket, pin);
    await this.scheduleAutoNextIfNeeded(pin);
    this.server.to(pin).emit('game:mode', await this.readMode(pin));
  }

  /** The reviewed step as the live screens should show it (state + content + nav). */
  private async emitReviewTo(
    socket: Emitter,
    pin: string,
    meta: GameMeta,
    snapshot: QuizSnapshot,
  ): Promise<void> {
    const step = parseStepKey(meta.reviewStep ?? '');
    if (!step) return;
    const nav = this.navFor(meta, snapshot);
    if ('slideIndex' in step) {
      const slide = snapshot.slides[step.slideIndex];
      if (!slide) return;
      socket.emit('game:state', {
        state: GameState.SlideShow,
        questionIndex: slide.beforeQuestionIndex,
        totalQuestions: meta.totalQuestions,
        nav,
      });
      socket.emit('slide:show', buildSlideShow(slide, step.slideIndex));
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
    const records = await this.readAnswers(pin, index);
    const common = await this.revealCommon(pin, question, records);
    const ranked = await this.rankedPlayers(pin);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const playerId = socket.data.playerId;
    socket.emit('question:reveal', this.personalReveal(common, records, ranked, rankOf, playerId));
    socket.emit(
      'leaderboard',
      this.personalLeaderboard(this.topRows(ranked), ranked, rankOf, playerId),
    );
  }

  /** The step the live position sits on (`q<i>` / `s<i>`), '' in the lobby or at the podium. */
  private liveStepKey(meta: GameMeta): string {
    if (meta.state === GameState.SlideShow) return `s${meta.slideIndex ?? 0}`;
    if (meta.state === GameState.Reveal || meta.state === GameState.Answering) {
      return `q${meta.currentIndex}`;
    }
    return '';
  }

  /**
   * Every step shown so far, in sequence order: slides anchored before a
   * question come first, then the question once its reveal happened.
   */
  private playedSteps(meta: GameMeta, snapshot: QuizSnapshot): string[] {
    const steps: string[] = [];
    const liveKey = this.liveStepKey(meta);
    const reached = (k: string) => steps.push(k);
    for (let q = 0; q <= snapshot.questions.length; q++) {
      snapshot.slides.forEach((s, i) => {
        if (s.beforeQuestionIndex === q) reached(`s${i}`);
      });
      if (q < snapshot.questions.length) reached(`q${q}`);
    }
    if (meta.state === GameState.Podium) return steps;
    const at = steps.indexOf(liveKey);
    if (at < 0) return [];
    // A question counts as played once revealed; mid-question it is not a target.
    return steps.slice(
      0,
      meta.state === GameState.Reveal ? at + 1 : at + (liveKey.startsWith('s') ? 1 : 0),
    );
  }

  /** Previous / next targets for the host, around the reviewed step or the live position. */
  private navFor(meta: GameMeta, snapshot: QuizSnapshot): NonNullable<GameStatePayload['nav']> {
    const played = this.playedSteps(meta, snapshot);
    const review = Boolean(meta.reviewStep);
    const here = review ? (meta.reviewStep as string) : this.liveStepKey(meta);
    const at = review || here ? played.indexOf(here) : played.length;
    const prev =
      at > 0 ? played[at - 1] : at < 0 && played.length ? played[played.length - 1] : null;
    const next = review && at >= 0 && at < played.length - 1 ? played[at + 1] : null;
    return {
      prev: prev ? parseStepKey(prev) : null,
      next: next ? parseStepKey(next) : null,
      review,
    };
  }

  /** Dernière question révélée → PODIUM (top 3 + rang perso). */
  private async toPodium(pin: string, meta: GameMeta): Promise<void> {
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Podium });
    const ranked = await this.rankedPlayers(pin);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const podium = ranked
      .slice(0, 3)
      .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1, avatar: p.avatar }));

    const snapshot = await this.game.getSnapshot(pin);
    this.server.to(pin).emit('game:state', {
      state: GameState.Podium,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
      nav: snapshot ? this.navFor({ ...meta, state: GameState.Podium }, snapshot) : undefined,
    });
    const top = this.topRows(ranked);
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit('game:podium', this.personalPodium(podium, ranked, rankOf, playerId, snapshot));
      // Classement général (top 10) aussi au podium : alimente l'écran projeté et
      // survit à un rechargement (sendStateTo le ré-émet en PODIUM).
      socket.emit('leaderboard', this.personalLeaderboard(top, ranked, rankOf, playerId));
    }
  }

  /** Podium top 3 + `you` ciblé sur le joueur de ce socket (s'il en a un). */
  private personalPodium(
    podium: LeaderboardRow[],
    ranked: RankedPlayer[],
    rankOf: Map<string, number>,
    playerId: string | undefined,
    snapshot: QuizSnapshot | null,
  ): PodiumPayload {
    const me = playerId ? ranked.find((p) => p.id === playerId) : undefined;
    return {
      podium,
      feedbackEnabled: snapshot?.feedbackEnabled ?? true,
      ...(snapshot?.credits?.length ? { credits: snapshot.credits } : {}),
      you: me ? { score: me.score, rank: rankOf.get(me.id) ?? ranked.length } : undefined,
    };
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
    const playerId = socket.data.playerId;
    // Transparence (§2.10, RG-16) : tout (ré)attaché — dont les joueurs arrivés après
    // le host:create — doit voir ce que la session enregistre de lui.
    socket.emit('notice', noticeOf(meta));
    const snapshotForNav = await this.game.getSnapshot(pin);
    if (!playerId && snapshotForNav) {
      // The projection asks for sound at once when the quiz will need it.
      socket.emit('game:media', {
        hasSound: snapshotHasSound(snapshotForNav),
        hasMedia: snapshotHasMedia(snapshotForNav),
        audioTarget: gameAudioTarget(snapshotForNav, meta.audioTarget),
      });
    }
    socket.emit('game:state', {
      state: meta.state as GameState,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
      nav: snapshotForNav && !meta.reviewStep ? this.navFor(meta, snapshotForNav) : undefined,
    });
    // Instantané du lobby : sans lui, un host/projeté qui (re)charge verrait une
    // liste de joueurs vide (les `player:joined` passés sont perdus). §6/§9.
    socket.emit('game:roster', { players: await this.connectedRoster(pin) });
    // Mode/pause courants : un (ré)attache doit refléter auto/pause immédiatement.
    socket.emit('game:mode', this.buildModePayload(meta));
    if (meta.joinBaseUrl) socket.emit('game:join-url', { baseUrl: meta.joinBaseUrl });
    // In the lobby, every device fetches what the first question needs while people wait;
    // arriving during a wait for media, what the coming question needs, and how long.
    if (meta.state === GameState.Lobby && snapshotForNav) {
      await this.emitPreload(pin, snapshotForNav, 0, socket);
    } else if (meta.state === GameState.MediaLoading && snapshotForNav) {
      socket.emit('media:wait', {
        questionIndex: meta.currentIndex,
        until: meta.mediaWaitUntil ?? 0,
      });
      await this.emitPreload(pin, snapshotForNav, meta.currentIndex, socket);
    }

    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot || meta.currentIndex < 0) return;

    // Looking back: every (re)attached screen shows the reviewed step, not the live one.
    if (meta.reviewStep) {
      await this.emitReviewTo(socket, pin, meta, snapshot);
      return;
    }
    if (meta.state === GameState.SlideShow) {
      const slide = snapshot.slides[meta.slideIndex ?? -1];
      if (slide) socket.emit('slide:show', buildSlideShow(slide, meta.slideIndex ?? 0));
      return;
    }
    if (meta.state === GameState.Answering) {
      const question = snapshot.questions[meta.currentIndex];
      // Chrono gelé (pause / hôte parti) : recalcule un timing d'affichage cohérent
      // sur le restant figé plutôt que d'envoyer un `endsAt` déjà dépassé.
      const { startedAt, endsAt } = meta.clockFrozen
        ? this.resumeTimings(meta, Date.now())
        : { startedAt: meta.questionStartedAt, endsAt: meta.questionEndsAt };
      socket.emit(
        'question:start',
        buildQuestionStart(
          question,
          meta.currentIndex,
          startedAt,
          endsAt,
          gameAudioTarget(snapshot, meta.audioTarget),
          meta.mediaLeadMs ?? null,
        ),
      );
      // Compteur courant : sinon un (re)attache mid-question afficherait « 0/N ».
      const { answered, total } = await this.connectedProgress(pin, meta.currentIndex);
      socket.emit('answer:count', { answered, total });
    } else if (meta.state === GameState.Reveal) {
      const index = meta.currentIndex;
      // The question itself first (prompt, options): a screen that (re)attaches at
      // the reveal has nothing to show the answers against otherwise.
      socket.emit(
        'question:start',
        buildQuestionStart(
          snapshot.questions[index],
          index,
          meta.questionStartedAt,
          meta.questionEndsAt,
          gameAudioTarget(snapshot, meta.audioTarget),
          meta.mediaLeadMs ?? null,
        ),
      );
      const records = await this.readAnswers(pin, index);
      const common = await this.revealCommon(pin, snapshot.questions[index], records);
      const ranked = await this.rankedPlayers(pin);
      const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
      socket.emit(
        'question:reveal',
        this.personalReveal(common, records, ranked, rankOf, playerId),
      );
      socket.emit(
        'leaderboard',
        this.personalLeaderboard(this.topRows(ranked), ranked, rankOf, playerId),
      );
    } else if (meta.state === GameState.Podium) {
      const ranked = await this.rankedPlayers(pin);
      const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
      const podium = ranked
        .slice(0, 3)
        .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1, avatar: p.avatar }));
      socket.emit(
        'game:podium',
        this.personalPodium(podium, ranked, rankOf, playerId, await this.game.getSnapshot(pin)),
      );
      // Classement général : un projecteur qui (re)charge au podium doit le revoir.
      socket.emit(
        'leaderboard',
        this.personalLeaderboard(this.topRows(ranked), ranked, rankOf, playerId),
      );
    }
  }

  /**
   * Progression de la question **sur les joueurs connectés** (§8). `answered` et
   * `total` ne comptent QUE les connectés : une réponse persiste dans le hash après
   * le départ de son auteur, donc comparer `hlen(answers)` au nombre de connectés
   * révélerait à tort alors qu'un connecté n'a pas encore répondu. `allAnswered` est
   * vrai seulement si **aucun connecté n'est en attente**.
   */
  /** Joueurs **connectés** (playerId + pseudo + avatar) pour l'instantané de lobby (§6/§9). */
  private async connectedRoster(
    pin: string,
  ): Promise<{ playerId: string; nickname: string; avatar: string; presence: PlayerPresence }[]> {
    const players = await this.redis.hgetall(gameKeys.players(pin));
    const roster: {
      playerId: string;
      nickname: string;
      avatar: string;
      presence: PlayerPresence;
    }[] = [];
    for (const [playerId, json] of Object.entries(players)) {
      const rec = JSON.parse(json) as PlayerRecord;
      if (rec.connected) {
        roster.push({
          playerId,
          nickname: rec.nickname,
          avatar: rec.avatar,
          presence: rec.presence ?? 'room',
        });
      }
    }
    return roster;
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

  private async connectedProgress(
    pin: string,
    questionIndex: number,
  ): Promise<{ answered: number; total: number; allAnswered: boolean }> {
    const players = await this.redis.hgetall(gameKeys.players(pin));
    const answeredIds = new Set(await this.redis.hkeys(gameKeys.answers(pin, questionIndex)));
    let total = 0;
    let answered = 0;
    for (const [id, json] of Object.entries(players)) {
      if (!(JSON.parse(json) as PlayerRecord).connected) continue;
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
    const nickname = await this.game.banPlayer(pin, playerId, minutes);
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
      const { answered, total, allAnswered } = await this.connectedProgress(pin, meta.currentIndex);
      this.server.to(pin).emit('answer:count', { answered, total });
      if (allAnswered) await this.advanceToReveal(pin, meta.currentIndex, 'all');
    }
  }

  /**
   * Déconnexion d'un joueur (§8) : `connected=false`, diffusion `player:left` avec
   * le compte des **connectés**, puis **re-vérification de la convergence** — un
   * départ peut compléter « tous les connectés ont répondu » sans nouveau submit
   * (le départ ne déclenche le REVEAL que si aucun connecté restant n'est en attente).
   */
  async handlePlayerDisconnect(pin: string, playerId: string): Promise<void> {
    const record = await this.game.setConnected(pin, playerId, false);
    if (!record) return;
    const playerCount = await this.game.connectedCount(pin);
    this.server.to(pin).emit('player:left', { playerId, playerCount });
    await this.broadcastReadiness(pin);

    const meta = await this.game.getMeta(pin);
    if (meta && meta.state === GameState.Answering) {
      const { answered, total, allAnswered } = await this.connectedProgress(pin, meta.currentIndex);
      this.server.to(pin).emit('answer:count', { answered, total }); // total a baissé
      if (allAnswered) {
        await this.advanceToReveal(pin, meta.currentIndex, 'all');
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

    const graceMs = Number(process.env.GAME_HOST_GRACE_MS ?? HOST_GRACE_MS);
    this.cancelTimer(this.graceTimers, pin);
    const timer = setTimeout(
      () => {
        this.graceTimers.delete(pin);
        this.declareHostDisconnected(pin, hostUserId).catch((err: Error) =>
          this.log.error(`declareHostDisconnected ${pin}: ${err.message}`),
        );
      },
      Math.max(0, graceMs),
    );
    timer.unref?.();
    this.graceTimers.set(pin, timer);
  }

  /**
   * Fin du délai de grâce : re-vérifie (l'hôte a pu revenir entre-temps), puis fige
   * la partie en `HOST_DISCONNECTED` — timer de question mis en pause (ms restantes
   * conservées), état précédent mémorisé pour la reprise — et arme la fenêtre de
   * reconnexion (§7.3) au-delà de laquelle la partie se termine.
   */
  private async declareHostDisconnected(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.hostUserId !== hostUserId) return;
    if (meta.state === GameState.Ended || meta.state === GameState.HostDisconnected) return;
    if ((await this.countHostSockets(pin, hostUserId)) > 0) return; // revenu pendant la grâce

    // Gèle le chrono via la primitive partagée (idempotente : si l'hôte avait
    // déjà mis en pause, le restant figé est préservé, pas écrasé).
    this.cancelTimer(this.autoNextTimers, pin);
    this.cancelTimer(this.mediaWaitTimers, pin);
    await this.freezeClock(pin, meta);
    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.HostDisconnected,
      prevState: meta.state,
    });
    this.log.debug(`HOST_DISCONNECTED ${pin} (depuis ${meta.state})`);

    this.server.to(pin).emit('game:state', {
      state: GameState.HostDisconnected,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });

    const windowMs = Number(process.env.GAME_HOST_WINDOW_MS ?? HOST_RECONNECT_WINDOW_MS);
    this.cancelTimer(this.endWindowTimers, pin);
    const timer = setTimeout(
      () => {
        this.endWindowTimers.delete(pin);
        this.endOrphaned(pin, hostUserId).catch((err: Error) =>
          this.log.error(`endOrphaned ${pin}: ${err.message}`),
        );
      },
      Math.max(0, windowMs),
    );
    timer.unref?.();
    this.endWindowTimers.set(pin, timer);
  }

  /** L'hôte n'est pas revenu dans la fenêtre (§7.3) → fin de partie en l'état. */
  private async endOrphaned(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.HostDisconnected) return; // repris entre-temps
    // Fin subie : on archive ce qui a été joué, marqué « interrompu » (§7.3). Best-effort —
    // l'hôte est absent, un échec ne doit pas bloquer la fin (journalisé, avalé).
    await this.archive.archive(pin, meta, { interrupted: true, bestEffort: true });
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Ended });
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', { feedbackEnabled: await this.feedbackEnabled(pin) });
  }

  /**
   * `host:attach` : l'hôte est de retour. Annule les minuteries de grâce/fin et,
   * si la partie était figée en `HOST_DISCONNECTED`, reprend là où elle en était
   * (§7.3) — en ANSWERING avec un `questionEndsAt` recalculé sur le temps restant.
   */
  async onHostAttached(pin: string): Promise<void> {
    this.cancelTimer(this.graceTimers, pin);
    this.cancelTimer(this.endWindowTimers, pin);

    const meta = await this.game.getMeta(pin);
    if (!meta || meta.state !== GameState.HostDisconnected) return;
    const prev = (meta.prevState as GameState) ?? GameState.Lobby;

    await this.redis.hset(gameKeys.game(pin), { state: prev, prevState: '' });
    meta.state = prev;
    this.server.to(pin).emit('game:state', {
      state: prev,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });

    if (prev === GameState.MediaLoading) {
      // Back after a wait for media: no more waiting, the question starts.
      await this.endMediaWait(pin, meta.currentIndex);
    } else if (prev === GameState.Answering) {
      const snapshot = await this.game.getSnapshot(pin);
      // Toujours en pause à la reprise : on garde le chrono gelé (pas de ré-arme),
      // l'affichage du restant figé passe par `game:mode`. Sinon on dégèle.
      const now = Date.now();
      const { startedAt, endsAt } = meta.paused
        ? this.resumeTimings(meta, now)
        : ((await this.thawClock(pin, meta)) ?? this.resumeTimings(meta, now));
      if (snapshot) {
        const q = snapshot.questions[meta.currentIndex];
        this.server
          .to(pin)
          .emit(
            'question:start',
            buildQuestionStart(
              q,
              meta.currentIndex,
              startedAt,
              endsAt,
              gameAudioTarget(snapshot, meta.audioTarget),
              meta.mediaLeadMs ?? null,
            ),
          );
      }
    } else {
      if (prev === GameState.SlideShow) {
        const snapshot = await this.game.getSnapshot(pin);
        const slide = snapshot?.slides[meta.slideIndex ?? -1];
        if (slide)
          this.server.to(pin).emit('slide:show', buildSlideShow(slide, meta.slideIndex ?? 0));
      }
      // Reprise en REVEAL en mode auto (ou sur une slide minutée) : ré-arme l'enchaînement.
      await this.scheduleAutoNextIfNeeded(pin, meta);
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

  private cancelTimer(map: Map<string, NodeJS.Timeout>, pin: string): void {
    const existing = map.get(pin);
    if (existing) {
      clearTimeout(existing);
      map.delete(pin);
    }
  }

  /** `host:end` : termine la partie (tout état → ENDED) et invalide le PIN (§7). */
  async end(pin: string, hostUserId: string, archive = false): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state === GameState.Ended) return; // déjà terminée (ré-entrée / double-clic) → pas de double archive
    // Archivage explicite choisi par l'hôte (§2.7). Volontairement NON best-effort :
    // si la persistance échoue, on laisse remonter et on ne détruit PAS la partie
    // (le PIN reste valide, l'hôte peut réessayer) — pas de perte silencieuse.
    if (archive) {
      try {
        await this.archive.archive(pin, meta, { interrupted: false });
      } catch (err) {
        // The quiz is gone (deleted meanwhile): nothing will ever archive, end anyway
        // and say so; any other failure keeps the session so the host can retry.
        if (!isForeignKeyViolation(err)) throw err;
        this.log.warn(
          `Session ${pin}: quiz ${meta.quizId} no longer exists, ended without archive`,
        );
        this.server.to(pin).emit('error', { code: 'session.archive_quiz_gone' });
      }
    }
    this.clearTimer(pin);
    this.cancelTimer(this.graceTimers, pin);
    this.cancelTimer(this.endWindowTimers, pin);
    this.cancelTimer(this.autoNextTimers, pin);
    this.cancelTimer(this.mediaWaitTimers, pin);
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Ended });
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(meta.hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', { feedbackEnabled: await this.feedbackEnabled(pin) });
  }

  // ── Mode / pause / chrono (§8) ─────────────────────────────────────────────

  /**
   * `host:mode` : bascule manuel ⇄ auto en cours de partie (le présentateur
   * reprend la main). Passer en manuel annule un enchaînement auto en attente ;
   * passer en auto ré-arme l'enchaînement si l'on est déjà sur un reveal.
   */
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
    await this.redis.hset(gameKeys.game(pin), { joinBaseUrl: clean });
    this.server.to(pin).emit('game:join-url', { baseUrl: clean || null });
  }

  async setMode(pin: string, hostUserId: string, mode: GameMode): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.redis.hset(gameKeys.game(pin), { mode });
    meta.mode = mode;
    if (mode === 'manual') {
      this.cancelTimer(this.autoNextTimers, pin);
    } else {
      await this.scheduleAutoNextIfNeeded(pin, meta);
    }
    this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
  }

  /**
   * `host:pause` : suspend/reprend l'auto-progression. En ANSWERING, gèle aussi
   * le chrono (primitive partagée avec le `HOST_DISCONNECTED`). La reprise dégèle
   * le chrono (nouveau timing diffusé) et ré-arme l'enchaînement auto si besoin.
   * Idempotent : re-pauser/re-reprendre est sans effet (hors diffusion d'état).
   */
  /**
   * `host:media` : relays a host command on the current question's media to
   * the screens — after an interruption the projection resumes a second before
   * where it was, and this lets the host take the room back to the top.
   */
  async mediaControl(pin: string, hostUserId: string, action: 'restart'): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Answering) return;
    this.server.to(pin).emit('media:control', { questionIndex: meta.currentIndex, action });
  }

  async setPaused(pin: string, hostUserId: string, paused: boolean): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    await this.redis.hset(gameKeys.game(pin), { paused: paused ? '1' : '0' });
    meta.paused = paused;
    if (paused) {
      this.cancelTimer(this.autoNextTimers, pin);
      await this.freezeClock(pin, meta);
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
      await this.scheduleAutoNextIfNeeded(pin, meta);
    }
    this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
  }

  /**
   * `host:adjust-time` : ajoute/retire `deltaS` secondes au chrono de la question
   * courante (boutons ±). Retirer au-delà du restant révèle immédiatement (pas de
   * timer mort). Si le chrono est gelé (pause), on ajuste le restant figé.
   */
  async adjustTime(pin: string, hostUserId: string, deltaS: number): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Answering) {
      throw new BadRequestException('session.timer_not_adjustable');
    }
    const deltaMs = Math.trunc(deltaS) * 1000;

    if (meta.clockFrozen) {
      const remaining = Math.max(CHRONO_FLOOR_MS, (meta.pausedRemainingMs ?? 0) + deltaMs);
      await this.redis.hset(gameKeys.game(pin), { pausedRemainingMs: String(remaining) });
      meta.pausedRemainingMs = remaining;
      this.server.to(pin).emit('game:mode', this.buildModePayload(meta));
      return;
    }

    const now = Date.now();
    const newEndsAt = meta.questionEndsAt + deltaMs;
    if (newEndsAt - now <= CHRONO_FLOOR_MS) {
      await this.advanceToReveal(pin, meta.currentIndex, 'host'); // restant épuisé → reveal
      return;
    }
    await this.redis.hset(gameKeys.game(pin), { questionEndsAt: String(newEndsAt) });
    meta.questionEndsAt = newEndsAt;
    this.scheduleReveal(pin, meta.currentIndex, newEndsAt + GRACE_MS - now);
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
      meta.mode === 'auto' &&
      (meta.state === GameState.Reveal || meta.state === GameState.SlideShow);
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
    if (meta.clockFrozen || meta.state !== GameState.Answering) return;
    const remaining = Math.max(0, meta.questionEndsAt - Date.now());
    this.clearTimer(pin);
    await this.redis.hset(gameKeys.game(pin), {
      clockFrozen: '1',
      pausedRemainingMs: String(remaining),
    });
    meta.clockFrozen = true;
    meta.pausedRemainingMs = remaining;
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
    const { startedAt, endsAt } = this.resumeTimings(meta, now);
    await this.redis.hset(gameKeys.game(pin), {
      clockFrozen: '0',
      pausedRemainingMs: '',
      questionStartedAt: String(startedAt),
      questionEndsAt: String(endsAt),
    });
    meta.clockFrozen = false;
    meta.pausedRemainingMs = undefined;
    meta.questionStartedAt = startedAt;
    meta.questionEndsAt = endsAt;
    this.scheduleReveal(pin, meta.currentIndex, endsAt + GRACE_MS - now);
    return { startedAt, endsAt };
  }

  /** Timings d'affichage d'un chrono gelé — voir `resumeQuestionWindow`. */
  private resumeTimings(meta: GameMeta, now: number): { startedAt: number; endsAt: number } {
    return resumeQuestionWindow(meta, now);
  }

  /**
   * Arme l'enchaînement automatique vers la question suivante si la partie est en
   * mode auto, non en pause, et sur un reveal (§8). Plusieurs points d'entrée :
   * fin de `advanceToReveal`, passage en auto, ou reprise — d'où l'idempotence.
   */
  private async scheduleAutoNextIfNeeded(pin: string, meta?: GameMeta): Promise<void> {
    const m = meta ?? (await this.game.getMeta(pin));
    // Auto mode only: in manual mode the host clicks through slides and reveals alike.
    if (!m || m.paused || m.mode !== 'auto') return;
    const snapshot = await this.game.getSnapshot(pin);
    let delay: number;
    if (m.state === GameState.SlideShow) {
      // Slide (#7): null = engine default, N = N seconds, 0 = the host clicks (manual override).
      const slideDelay = snapshot?.slides[m.slideIndex ?? -1]?.displayDelayS ?? null;
      if (slideDelay === 0) return;
      delay = slideDelay ? slideDelay * 1000 : defaultAutoAdvanceMs();
    } else if (m.state === GameState.Reveal) {
      // Per-question override (#6), else the engine default.
      const perQuestion = snapshot?.questions[m.currentIndex]?.revealDelayS;
      delay = perQuestion ? perQuestion * 1000 : defaultAutoAdvanceMs();
    } else {
      return;
    }
    this.cancelTimer(this.autoNextTimers, pin);
    // Deadline diffusée à la console (compte à rebours + barre de progression).
    const autoNextAt = Date.now() + delay;
    m.autoNextAt = autoNextAt;
    m.autoNextMs = delay;
    await this.redis.hset(gameKeys.game(pin), {
      autoNextAt: String(autoNextAt),
      autoNextMs: String(delay),
    });
    const hostUserId = m.hostUserId;
    // The timer only fires for the exact step it was armed on (question or slide).
    const step = m.state === GameState.SlideShow ? `s${m.slideIndex ?? 0}` : m.currentIndex;
    const timer = setTimeout(
      () => {
        this.autoNextTimers.delete(pin);
        this.autoAdvance(pin, hostUserId, step).catch((err: Error) =>
          this.log.error(`autoAdvance ${pin}: ${err.message}`),
        );
      },
      Math.max(0, delay),
    );
    timer.unref?.();
    this.autoNextTimers.set(pin, timer);
  }

  /** Timer fired: advance only if the game still sits on the step it was armed for. */
  private async autoAdvance(pin: string, hostUserId: string, step: number | string): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.paused) return;
    if (meta.mode !== 'auto') return;
    const onSlide = meta.state === GameState.SlideShow && step === `s${meta.slideIndex ?? 0}`;
    const onReveal = meta.state === GameState.Reveal && step === meta.currentIndex;
    if (!onSlide && !onReveal) return;
    await this.next(pin, hostUserId);
  }

  /** Whether players may rate this quiz (§2.11); defaults to true when the snapshot is gone. */
  private async feedbackEnabled(pin: string): Promise<boolean> {
    const snapshot = await this.game.getSnapshot(pin);
    return snapshot?.feedbackEnabled ?? true;
  }

  /** Lit les réponses gradées d'une question (playerId → enregistrement). */
  private async readAnswers(pin: string, index: number): Promise<Map<string, AnswerRecord>> {
    const raw = await this.redis.hgetall(gameKeys.answers(pin, index));
    return new Map(Object.entries(raw).map(([id, json]) => [id, JSON.parse(json) as AnswerRecord]));
  }

  /** Joueurs triés par score décroissant, départage par ordre d'arrivée (§5). */
  private async rankedPlayers(pin: string): Promise<RankedPlayer[]> {
    const raw = await this.redis.hgetall(gameKeys.players(pin));
    return Object.entries(raw)
      .map(([id, json]) => ({ id, ...(JSON.parse(json) as PlayerRecord) }))
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  }

  /**
   * `player:submit` : note une réponse avec **timing serveur autoritatif** (§6).
   * Rejette (accepted=false, sans scorer) si hors fenêtre [startedAt, endsAt+grace]
   * ou si le joueur a déjà répondu (unicité atomique `HSETNX`, RG-06). Le résultat
   * gradé est stocké (REVEAL le relit, pas de re-notation), le score + le ZSet
   * classement sont mis à jour, et `answer:count` est diffusé. Si tous les joueurs
   * connectés ont répondu, déclenche le REVEAL anticipé (2e chemin de convergence).
   *
   * @returns accusé à renvoyer au socket émetteur (answer:ack).
   */
  async submit(
    pin: string,
    playerId: string,
    questionIndex: number,
    answer: AnswerValue,
    receivedAt: number,
  ): Promise<{ accepted: boolean; receivedAt: number }> {
    const meta = await this.game.getMeta(pin);
    const reject = { accepted: false, receivedAt };
    if (!meta || meta.state !== GameState.Answering || meta.currentIndex !== questionIndex) {
      return reject; // mauvaise question / fenêtre fermée
    }
    if (receivedAt < meta.questionStartedAt || receivedAt > meta.questionEndsAt + GRACE_MS) {
      return reject; // trop tôt (lecture) ou hors délai (§6)
    }

    const player = await this.getPlayer(pin, playerId);
    const snapshot = await this.game.getSnapshot(pin);
    if (!player || !snapshot) {
      return reject;
    }
    const question = snapshot.questions[questionIndex];

    // Temps serveur compensé de la latence (§6) ; latencyMs = RTT/2 (0 tant que non câblé).
    const tMs = Math.max(0, receivedAt - meta.questionStartedAt - player.latencyMs);
    const score = scoreAnswer({ question, answer, tMs, prevStreak: player.streak });
    const record: AnswerRecord = {
      answer,
      isCorrect: score.correct,
      pointsAwarded: score.points,
      credit: score.credit,
      tMs,
      receivedAt,
    };

    // Unicité : 1re réponse gagne (RG-06). Si déjà répondu, on ne score pas.
    const won = await this.redis.hsetnx(
      gameKeys.answers(pin, questionIndex),
      playerId,
      JSON.stringify(record),
    );
    if (won === 0) {
      return reject;
    }
    await this.redis.expire(gameKeys.answers(pin, questionIndex), GAME_TTL_S);

    // Applique le score (read-modify-write sûr : 1 seul socket par joueur).
    player.score += score.points;
    player.streak = score.newStreak;
    await this.redis.hset(gameKeys.players(pin), playerId, JSON.stringify(player));
    await this.redis.zadd(gameKeys.leaderboard(pin), player.score, playerId);

    // §8 : convergence sur les **connectés en attente**, pas le total jamais joint
    // (sinon un seul départ figerait la question jusqu'au timer).
    const { answered, total, allAnswered } = await this.connectedProgress(pin, questionIndex);
    this.server.to(pin).emit('answer:count', { answered, total });

    if (allAnswered) {
      await this.advanceToReveal(pin, questionIndex, 'all');
    }
    return { accepted: true, receivedAt };
  }

  private async getPlayer(pin: string, playerId: string): Promise<PlayerRecord | null> {
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    return raw ? (JSON.parse(raw) as PlayerRecord) : null;
  }

  /** Charge les méta en exigeant que l'appelant soit l'hôte propriétaire. */
  private async requireHost(pin: string, hostUserId: string): Promise<GameMeta> {
    const meta = await this.game.getMeta(pin);
    if (!meta) {
      throw new BadRequestException('session.not_found');
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
  private async requireSnapshot(pin: string, refresh = false): Promise<QuizSnapshot> {
    const snapshot = refresh
      ? await this.game.refreshSnapshot(pin)
      : await this.game.getSnapshot(pin);
    if (!snapshot) {
      throw new BadRequestException('session.snapshot_not_found');
    }
    return snapshot;
  }
}

/** `q<i>` / `s<i>` ↔ GameStep. */
function stepKey(step: GameStep): string {
  return 'slideIndex' in step ? `s${step.slideIndex}` : `q${step.questionIndex}`;
}
function parseStepKey(key: string): GameStep | null {
  const m = /^([qs])(\d+)$/.exec(key);
  if (!m) return null;
  return m[1] === 's' ? { slideIndex: Number(m[2]) } : { questionIndex: Number(m[2]) };
}

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

/** Prisma's foreign-key violation (P2003), e.g. archiving a session whose quiz was deleted. */
function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2003';
}
