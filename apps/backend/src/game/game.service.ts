import { randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GameState } from '@roux-quizz/contracts';
import { QuizStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import { RedisService } from '../redis/redis.service';
import { GAME_TTL_S, gameKeys } from './game.keys';
import type { GameMeta, PlayerRecord } from './game.types';
import { QUIZ_SNAPSHOT_INCLUDE, buildSnapshot } from './snapshot';

const PIN_ALLOC_ATTEMPTS = 10;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;

export interface CreateSessionResult {
  pin: string;
}

export interface JoinSessionResult {
  pin: string;
  playerId: string;
  sessionToken: string;
  nickname: string;
  playerCount: number;
}

/**
 * Cycle de vie d'une partie sur l'état Redis (SPECIFICATIONS §8). Ce service ne
 * gère pas le transport : il est appelé par le gateway (`host:create`,
 * `player:join`) et renvoie des données ; la diffusion socket reste au gateway.
 */
@Injectable()
export class GameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Crée une partie pour un quiz `ready` possédé par l'hôte : fige le snapshot,
   * alloue un PIN unique atomiquement et initialise l'état en `LOBBY`.
   */
  async createSession(
    hostUserId: string,
    dto: { quizId: string; fullCapture?: boolean },
  ): Promise<CreateSessionResult> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: dto.quizId, ownerId: hostUserId },
      include: QUIZ_SNAPSHOT_INCLUDE,
    });
    if (!quiz) {
      throw new NotFoundException('Quiz introuvable.');
    }
    if (quiz.status !== QuizStatus.ready) {
      throw new BadRequestException('Le quiz doit être « prêt » pour lancer une partie (RG-02).');
    }
    if (quiz.questions.length < 1) {
      throw new BadRequestException('Le quiz ne comporte aucune question.');
    }

    const snapshot = buildSnapshot(quiz);
    const id = randomBytes(16).toString('hex');
    const pin = await this.allocatePin(id);

    const meta: GameMeta = {
      id,
      quizId: quiz.id,
      hostUserId,
      state: GameState.Lobby,
      currentIndex: -1,
      totalQuestions: snapshot.questions.length,
      fullCapture: dto.fullCapture === true,
      title: quiz.title,
      language: quiz.language,
      createdAt: Date.now(),
    };

    const pipe = this.redis.multi();
    pipe.hset(gameKeys.game(pin), serializeMeta(meta));
    pipe.set(gameKeys.snapshot(pin), JSON.stringify(snapshot));
    pipe.expire(gameKeys.game(pin), GAME_TTL_S);
    pipe.expire(gameKeys.snapshot(pin), GAME_TTL_S);
    await pipe.exec();

    return { pin };
  }

  /**
   * Inscrit un joueur dans le lobby : pseudo unique (atomique), création du
   * joueur (score 0) et d'un jeton de session pour la reconnexion.
   */
  async joinSession(
    pin: string,
    rawNickname: string,
    userId: string | null,
  ): Promise<JoinSessionResult> {
    const meta = await this.getMeta(pin);
    if (!meta) {
      throw new NotFoundException('Partie introuvable ou terminée.');
    }
    if (meta.state !== GameState.Lobby) {
      throw new BadRequestException('La partie a déjà démarré.');
    }

    const nickname = sanitizeNickname(rawNickname);
    const normalized = normalizeAnswer(nickname);
    const claimed = await this.redis.sadd(gameKeys.nicknames(pin), normalized);
    if (claimed === 0) {
      throw new ConflictException('Ce pseudo est déjà pris dans cette partie.');
    }

    const playerId = randomBytes(16).toString('hex');
    const sessionToken = randomBytes(24).toString('base64url');
    const record: PlayerRecord = {
      nickname,
      userId,
      score: 0,
      streak: 0,
      connected: true,
      joinedAt: Date.now(),
      latencyMs: 0,
    };

    const pipe = this.redis.multi();
    pipe.hset(gameKeys.players(pin), playerId, JSON.stringify(record));
    pipe.zadd(gameKeys.leaderboard(pin), 0, playerId);
    pipe.set(gameKeys.session(sessionToken), JSON.stringify({ pin, playerId }));
    pipe.hlen(gameKeys.players(pin));
    // TTL aligné sur le reste de la famille (clés créées au 1er joueur).
    for (const key of [
      gameKeys.players(pin),
      gameKeys.nicknames(pin),
      gameKeys.leaderboard(pin),
      gameKeys.session(sessionToken),
    ]) {
      pipe.expire(key, GAME_TTL_S);
    }
    const results = await pipe.exec();
    const playerCount = Number(results?.[3]?.[1] ?? 1);

    return { pin, playerId, sessionToken, nickname, playerCount };
  }

  /** Lit l'état scalaire d'une partie (null si inexistante/expirée). */
  async getMeta(pin: string): Promise<GameMeta | null> {
    const raw = await this.redis.hgetall(gameKeys.game(pin));
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }
    return deserializeMeta(raw);
  }

  /** Alloue un PIN à 6 chiffres unique (claim atomique auto-expirant). */
  private async allocatePin(gameId: string): Promise<string> {
    for (let i = 0; i < PIN_ALLOC_ATTEMPTS; i++) {
      const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const ok = await this.redis.set(gameKeys.pin(pin), gameId, 'EX', GAME_TTL_S, 'NX');
      if (ok === 'OK') {
        return pin;
      }
    }
    throw new ServiceUnavailableException('Impossible d’allouer un PIN, réessayez.');
  }
}

/** Valide et nettoie un pseudo (longueur, espaces) — anti-abus §7. */
export function sanitizeNickname(raw: string): string {
  const nickname = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    throw new BadRequestException(
      `Le pseudo doit faire entre ${NICKNAME_MIN} et ${NICKNAME_MAX} caractères.`,
    );
  }
  return nickname;
}

/** Sérialise les méta pour un hash Redis (tout en string). */
function serializeMeta(meta: GameMeta): Record<string, string> {
  return {
    id: meta.id,
    quizId: meta.quizId,
    hostUserId: meta.hostUserId,
    state: meta.state,
    currentIndex: String(meta.currentIndex),
    totalQuestions: String(meta.totalQuestions),
    fullCapture: meta.fullCapture ? '1' : '0',
    title: meta.title,
    language: meta.language,
    createdAt: String(meta.createdAt),
  };
}

function deserializeMeta(raw: Record<string, string>): GameMeta {
  return {
    id: raw.id,
    quizId: raw.quizId,
    hostUserId: raw.hostUserId,
    state: raw.state,
    currentIndex: Number(raw.currentIndex),
    totalQuestions: Number(raw.totalQuestions),
    fullCapture: raw.fullCapture === '1',
    title: raw.title,
    language: raw.language,
    createdAt: Number(raw.createdAt),
  };
}
