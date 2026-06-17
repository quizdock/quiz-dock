import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { GameState } from '@roux-quizz/contracts';
import type { ServerToClientEvents } from '@roux-quizz/contracts';
import type { Server } from 'socket.io';
import { GameService } from './game.service';
import { GAME_TTL_S, GRACE_MS, READ_DELAY_MS, gameKeys } from './game.keys';
import type { GameMeta, QuizSnapshot } from './game.types';
import { RedisService } from '../redis/redis.service';
import { buildQuestionStart } from './snapshot';

type GameServer = Server<Record<string, never>, ServerToClientEvents>;

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
    // TODO (P3-BACK-7) : question:reveal (distribution + résultat perso) + leaderboard.
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
