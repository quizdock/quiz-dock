import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { GameState } from '@roux-quizz/contracts';
import type {
  AnswerValue,
  LeaderboardPayload,
  LeaderboardRow,
  QuestionRevealPayload,
  ServerToClientEvents,
} from '@roux-quizz/contracts';
import type { Server } from 'socket.io';
import { GameService } from './game.service';
import { GAME_TTL_S, GRACE_MS, READ_DELAY_MS, gameKeys } from './game.keys';
import type { AnswerRecord, GameMeta, PlayerRecord, QuizSnapshot } from './game.types';
import { RedisService } from '../redis/redis.service';
import { buildRevealCommon } from './reveal';
import { scoreAnswer } from './scoring';
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

  constructor(
    private readonly game: GameService,
    private readonly redis: RedisService,
  ) {}

  /** Lié par le gateway dans `afterInit` (le serveur Socket.IO porte les rooms). */
  bindServer(server: GameServer): void {
    this.server = server;
  }

  /** `host:start` : LOBBY → 1re question. Garde propriété hôte + état. */
  async start(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('La partie a déjà démarré.');
    }
    const snapshot = await this.requireSnapshot(pin);
    await this.beginQuestion(pin, snapshot, 0);
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

    await this.redis.hset(gameKeys.game(pin), {
      state: GameState.Answering,
      currentIndex: String(index),
      questionStartedAt: String(startedAt),
      questionEndsAt: String(endsAt),
    });

    this.server.to(pin).emit('game:state', {
      state: GameState.Answering,
      questionIndex: index,
      totalQuestions: snapshot.questions.length,
    });
    this.server
      .to(pin)
      .emit('question:start', buildQuestionStart(question, index, startedAt, endsAt));

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
      .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1 }));
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
      throw new BadRequestException('Action possible seulement après le reveal.');
    }
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
      .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1 }));

    this.server.to(pin).emit('game:state', {
      state: GameState.Podium,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });
    const sockets = await this.server.in(pin).fetchSockets();
    for (const socket of sockets) {
      const playerId = (socket.data as { playerId?: string }).playerId;
      socket.emit('game:podium', this.personalPodium(podium, ranked, rankOf, playerId));
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
    socket.emit('game:state', {
      state: meta.state as GameState,
      questionIndex: meta.currentIndex,
      totalQuestions: meta.totalQuestions,
    });
    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot || meta.currentIndex < 0) return;

    if (meta.state === GameState.Answering) {
      const question = snapshot.questions[meta.currentIndex];
      socket.emit(
        'question:start',
        buildQuestionStart(
          question,
          meta.currentIndex,
          meta.questionStartedAt,
          meta.questionEndsAt,
        ),
      );
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
    }
  }

  /**
   * Déconnexion d'un joueur (§8) : `connected=false`, diffusion `player:left` avec
   * le compte des **connectés**, puis **re-vérification de la convergence** — un
   * départ peut compléter « tous les connectés ont répondu » sans nouveau submit.
   */
  async handlePlayerDisconnect(pin: string, playerId: string): Promise<void> {
    const record = await this.game.setConnected(pin, playerId, false);
    if (!record) return;
    const playerCount = await this.game.connectedCount(pin);
    this.server.to(pin).emit('player:left', { playerId, playerCount });

    const meta = await this.game.getMeta(pin);
    if (meta && meta.state === GameState.Answering && playerCount > 0) {
      const answered = await this.redis.hlen(gameKeys.answers(pin, meta.currentIndex));
      if (answered >= playerCount) {
        await this.advanceToReveal(pin, meta.currentIndex, 'all');
      }
    }
  }

  /** `host:end` : termine la partie (tout état → ENDED) et invalide le PIN (§7). */
  async end(pin: string, hostUserId: string): Promise<void> {
    const meta = await this.requireHost(pin, hostUserId);
    this.clearTimer(pin);
    await this.redis.hset(gameKeys.game(pin), { state: GameState.Ended });
    await this.redis.del(gameKeys.pin(pin));
    await this.game.removeHostGame(meta.hostUserId, pin);
    this.server
      .to(pin)
      .emit('game:state', { state: GameState.Ended, questionIndex: -1, totalQuestions: 0 });
    this.server.to(pin).emit('game:ended', {});
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

    const answered = await this.redis.hlen(gameKeys.answers(pin, questionIndex));
    // §8 : convergence sur les **connectés**, pas le total jamais joint (sinon un
    // seul départ figerait la question jusqu'au timer).
    const total = await this.game.connectedCount(pin);
    this.server.to(pin).emit('answer:count', { answered, total });

    if (total > 0 && answered >= total) {
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
      throw new BadRequestException('Partie introuvable ou terminée.');
    }
    if (meta.hostUserId !== hostUserId) {
      throw new ForbiddenException("Vous n'êtes pas l'hôte de cette partie.");
    }
    return meta;
  }

  private async requireSnapshot(pin: string): Promise<QuizSnapshot> {
    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot) {
      throw new BadRequestException('Snapshot de partie introuvable.');
    }
    return snapshot;
  }
}
