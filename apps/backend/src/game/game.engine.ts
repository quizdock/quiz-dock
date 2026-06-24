import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { GameState } from '@quiz-dock/contracts';
import type {
  AnswerValue,
  GameMode,
  GameModePayload,
  LeaderboardPayload,
  LeaderboardRow,
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
  READ_DELAY_MS,
  gameKeys,
} from './game.keys';
import type { AnswerRecord, GameMeta, PlayerRecord, QuizSnapshot } from './game.types';
import { RedisService } from '../redis/redis.service';
import { buildRevealCommon } from './reveal';
import { scoreAnswer } from './scoring';
import { SessionArchiveService } from './session-archive.service';
import { buildQuestionStart } from './snapshot';

type GameServer = Server<Record<string, never>, ServerToClientEvents>;

/**
 * Cible d'émission unitaire : satisfaite à la fois par un `Socket` local (gateway)
 * et un `RemoteSocket` (`fetchSockets()`). Permet de partager le calcul du reveal
 * personnel entre la diffusion live et la relecture d'état (reconnexion / late join).
 */
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

  constructor(
    private readonly game: GameService,
    private readonly redis: RedisService,
    private readonly archive: SessionArchiveService,
  ) {}

  /** Lié par le gateway dans `afterInit` (le serveur Socket.IO porte les rooms). */
  bindServer(server: GameServer): void {
    this.server = server;
  }

  /** `host:start` : LOBBY → 1re question. Garde propriété hôte + état. */
  async start(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('session.already_started');
    }
    const snapshot = await this.requireSnapshot(pin);
    await this.beginQuestion(pin, snapshot, 0);
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
    this.server.to(pin).emit('notice', { fullCapture });
  }

  /**
   * Ouvre la question `index` : fixe les timings serveur autoritatifs, diffuse
   * `game:state` (ANSWERING) + `question:start` (allowlist), arme le timer de fin.
   */
  private async beginQuestion(pin: string, snapshot: QuizSnapshot, index: number): Promise<void> {
    const question = snapshot.questions[index];
    const now = Date.now();
    // Délai de lecture configurable (§8, défaut 3 s) — lu au runtime (tests rapides).
    const readDelay = Number(process.env.GAME_READ_DELAY_MS ?? READ_DELAY_MS);
    const startedAt = now + readDelay; // fenêtre de lecture côté client
    const endsAt = startedAt + question.timeLimitS * 1000;

    // Nouvelle question : chrono qui tourne, ni gelé ni en pause (un enchaînement
    // manuel pendant une pause reprend implicitement la main).
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.Answering,
      currentIndex: String(index),
      questionStartedAt: String(startedAt),
      questionEndsAt: String(endsAt),
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
      .emit('question:start', buildQuestionStart(question, index, startedAt, endsAt));
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

    this.server.to(pin).emit('game:state', {
      state: GameState.Reveal,
      questionIndex: index,
      totalQuestions: meta.totalQuestions,
    });

    const snapshot = await this.game.getSnapshot(pin);
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
    const common = buildRevealCommon(question, [...records.values()]);

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
    if (meta.state !== GameState.Reveal) {
      throw new BadRequestException('session.reveal_required');
    }
    this.cancelTimer(this.autoNextTimers, pin); // un enchaînement (auto/manuel) annule l'autre
    const won = await this.redis.set(
      gameKeys.advanceLock(pin, meta.currentIndex),
      '1',
      'EX',
      GAME_TTL_S,
      'NX',
    );
    if (won !== 'OK') {
      return; // suivant déjà déclenché (double-clic)
    }
    const nextIndex = meta.currentIndex + 1;
    if (nextIndex >= meta.totalQuestions) {
      await this.toPodium(pin, meta);
      return;
    }
    const snapshot = await this.requireSnapshot(pin);
    await this.beginQuestion(pin, snapshot, nextIndex);
  }

  /** Dernière question révélée → PODIUM (top 3 + rang perso). */
  private async toPodium(pin: string, meta: GameMeta): Promise<void> {
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Podium });
    const ranked = await this.rankedPlayers(pin);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const podium = ranked
      .slice(0, 3)
      .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1, avatar: p.avatar }));

    this.server.to(pin).emit('game:state', {
      state: GameState.Podium,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });
    const top = this.topRows(ranked);
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit('game:podium', this.personalPodium(podium, ranked, rankOf, playerId));
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
  ): { podium: LeaderboardRow[]; you?: { score: number; rank: number } } {
    const me = playerId ? ranked.find((p) => p.id === playerId) : undefined;
    return {
      podium,
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
    // Consentement capture intégrale (§2.10) : tout (ré)attaché — dont les joueurs
    // arrivés après le host:create — doit voir l'avis « réponses conservées ».
    if (meta.fullCapture) socket.emit('notice', { fullCapture: true });
    socket.emit('game:state', {
      state: meta.state as GameState,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });
    // Instantané du lobby : sans lui, un host/projeté qui (re)charge verrait une
    // liste de joueurs vide (les `player:joined` passés sont perdus). §6/§9.
    socket.emit('game:roster', { players: await this.connectedRoster(pin) });
    // Mode/pause courants : un (ré)attache doit refléter auto/pause immédiatement.
    socket.emit('game:mode', this.buildModePayload(meta));

    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot || meta.currentIndex < 0) return;

    if (meta.state === GameState.Answering) {
      const question = snapshot.questions[meta.currentIndex];
      // Chrono gelé (pause / hôte parti) : recalcule un timing d'affichage cohérent
      // sur le restant figé plutôt que d'envoyer un `endsAt` déjà dépassé.
      const { startedAt, endsAt } = meta.clockFrozen
        ? this.resumeTimings(meta, Date.now())
        : { startedAt: meta.questionStartedAt, endsAt: meta.questionEndsAt };
      socket.emit(
        'question:start',
        buildQuestionStart(question, meta.currentIndex, startedAt, endsAt),
      );
      // Compteur courant : sinon un (re)attache mid-question afficherait « 0/N ».
      const { answered, total } = await this.connectedProgress(pin, meta.currentIndex);
      socket.emit('answer:count', { answered, total });
    } else if (meta.state === GameState.Reveal) {
      const index = meta.currentIndex;
      const records = await this.readAnswers(pin, index);
      const common = buildRevealCommon(snapshot.questions[index], [...records.values()]);
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
        .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1 }));
      socket.emit('game:podium', this.personalPodium(podium, ranked, rankOf, playerId));
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
  ): Promise<{ playerId: string; nickname: string; avatar: string }[]> {
    const players = await this.redis.hgetall(gameKeys.players(pin));
    const roster: { playerId: string; nickname: string; avatar: string }[] = [];
    for (const [playerId, json] of Object.entries(players)) {
      const rec = JSON.parse(json) as PlayerRecord;
      if (rec.connected) roster.push({ playerId, nickname: rec.nickname, avatar: rec.avatar });
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
    this.server.to(pin).emit('game:ended', {});
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

    if (prev === GameState.Answering) {
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
          .emit('question:start', buildQuestionStart(q, meta.currentIndex, startedAt, endsAt));
      }
    } else {
      // Reprise en REVEAL en mode auto : ré-arme l'enchaînement automatique.
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
    if (archive) await this.archive.archive(pin, meta, { interrupted: false });
    this.clearTimer(pin);
    this.cancelTimer(this.graceTimers, pin);
    this.cancelTimer(this.endWindowTimers, pin);
    this.cancelTimer(this.autoNextTimers, pin);
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Ended });
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(meta.hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', {});
  }

  // ── Mode / pause / chrono (§8) ─────────────────────────────────────────────

  /**
   * `host:mode` : bascule manuel ⇄ auto en cours de partie (le présentateur
   * reprend la main). Passer en manuel annule un enchaînement auto en attente ;
   * passer en auto ré-arme l'enchaînement si l'on est déjà sur un reveal.
   */
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
    });
  }

  /** Construit le payload mode/pause (restant figé + deadline d'enchaînement auto). */
  private buildModePayload(meta: GameMeta): GameModePayload {
    const autoNextActive =
      meta.mode === 'auto' &&
      !meta.paused &&
      meta.state === GameState.Reveal &&
      (meta.autoNextAt ?? 0) > 0;
    return {
      mode: meta.mode,
      paused: meta.paused,
      ...(meta.clockFrozen ? { remainingMs: meta.pausedRemainingMs ?? 0 } : {}),
      ...(autoNextActive
        ? {
            autoNextAt: meta.autoNextAt,
            autoNextMs: Number(process.env.GAME_AUTO_ADVANCE_MS ?? AUTO_ADVANCE_MS),
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

  /**
   * Timings d'affichage cohérents pour un chrono gelé : conserve le temps déjà
   * écoulé (fenêtre − restant) en repartant de `now` (timing §6 cohérent). Pur :
   * utilisé pour le dégel (avec persistance) comme pour l'affichage figé.
   */
  private resumeTimings(meta: GameMeta, now: number): { startedAt: number; endsAt: number } {
    const remaining = meta.pausedRemainingMs ?? 0;
    const windowLen = Math.max(0, meta.questionEndsAt - meta.questionStartedAt);
    const elapsed = Math.max(0, windowLen - remaining);
    return { startedAt: now - elapsed, endsAt: now + remaining };
  }

  /**
   * Arme l'enchaînement automatique vers la question suivante si la partie est en
   * mode auto, non en pause, et sur un reveal (§8). Plusieurs points d'entrée :
   * fin de `advanceToReveal`, passage en auto, ou reprise — d'où l'idempotence.
   */
  private async scheduleAutoNextIfNeeded(pin: string, meta?: GameMeta): Promise<void> {
    const m = meta ?? (await this.game.getMeta(pin));
    if (!m || m.mode !== 'auto' || m.paused || m.state !== GameState.Reveal) return;
    this.cancelTimer(this.autoNextTimers, pin);
    const delay = Number(process.env.GAME_AUTO_ADVANCE_MS ?? AUTO_ADVANCE_MS);
    // Deadline diffusée à la console (compte à rebours + barre de progression).
    const autoNextAt = Date.now() + delay;
    m.autoNextAt = autoNextAt;
    await this.redis.hset(gameKeys.game(pin), { autoNextAt: String(autoNextAt) });
    const hostUserId = m.hostUserId;
    const index = m.currentIndex;
    const timer = setTimeout(
      () => {
        this.autoNextTimers.delete(pin);
        this.autoAdvance(pin, hostUserId, index).catch((err: Error) =>
          this.log.error(`autoAdvance ${pin}: ${err.message}`),
        );
      },
      Math.max(0, delay),
    );
    timer.unref?.();
    this.autoNextTimers.set(pin, timer);
  }

  /** Tir du minuteur auto : enchaîne si l'on est toujours sur le même reveal auto. */
  private async autoAdvance(pin: string, hostUserId: string, index: number): Promise<void> {
    const meta = await this.game.getMeta(pin);
    if (!meta || meta.mode !== 'auto' || meta.paused) return;
    if (meta.state !== GameState.Reveal || meta.currentIndex !== index) return;
    await this.next(pin, hostUserId);
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

  private async requireSnapshot(pin: string): Promise<QuizSnapshot> {
    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot) {
      throw new BadRequestException('session.snapshot_not_found');
    }
    return snapshot;
  }
}
