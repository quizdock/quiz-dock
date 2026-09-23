import { randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GameState } from '@quiz-dock/contracts';
import { QuizStatus } from '@prisma/client';
import { isOidcMode } from '../auth/auth-mode';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import { RedisService } from '../redis/redis.service';
import { GAME_TTL_S, gameKeys } from './game.keys';
import type { GameMeta, PlayerRecord, QuizSnapshot } from './game.types';
import { QUIZ_SNAPSHOT_INCLUDE, buildSnapshot, refreshSnapshotForm } from './snapshot';

const PIN_ALLOC_ATTEMPTS = 10;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
/** Homonymes distingués par un suffixe avant de refuser (noms venus des comptes). */
const NICKNAME_HOMONYM_MAX = 20;
/** Borne de la graine d'avatar (client-fournie, stockée Redis + diffusée). */
const AVATAR_SEED_MAX = 64;

export interface CreateSessionResult {
  pin: string;
}

export interface JoinSessionResult {
  pin: string;
  playerId: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  playerCount: number;
}

/**
 * Cycle de vie d'une partie sur l'état Redis (SPECIFICATIONS §8). Ce service ne
 * gère pas le transport : il est appelé par le gateway (`host:create`,
 * `player:join`) et renvoie des données ; la diffusion socket reste au gateway.
 */
/**
 * A running game, as the interface lists it (§6.2). `host` is filled only for the
 * instance-wide view an `admin` gets: a host listing their own needs no name.
 */
type ActiveGame = {
  pin: string;
  quizId: string;
  title: string;
  state: string;
  playerCount: number;
  host?: string;
};

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
    dto: {
      quizId: string;
      fullCapture?: boolean;
      personalTracking?: boolean;
      pickOwnName?: boolean;
    },
  ): Promise<CreateSessionResult> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: dto.quizId, ownerId: hostUserId },
      include: QUIZ_SNAPSHOT_INCLUDE,
    });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    if (quiz.status !== QuizStatus.ready) {
      throw new BadRequestException('quiz.not_ready');
    }
    if (quiz.questions.length < 1) {
      throw new BadRequestException('quiz.empty');
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
      // Suivi individuel : par défaut oui (RG-16). Nom choisi : par défaut oui, sauf
      // sous OIDC où le nom vient du compte tant que l'hôte n'ouvre pas le choix.
      personalTracking: dto.personalTracking !== false,
      pickOwnName: dto.pickOwnName ?? !isOidcMode(),
      title: quiz.title,
      language: quiz.language,
      createdAt: Date.now(),
      questionStartedAt: 0,
      questionEndsAt: 0,
      mode: 'manual', // rythme par défaut : l'hôte enchaîne les questions (§8)
      paused: false,
      clockFrozen: false,
    };

    const pipe = this.redis.multi();
    pipe.hset(gameKeys.game(pin), serializeMeta(meta));
    pipe.set(gameKeys.snapshot(pin), JSON.stringify(snapshot));
    // Index des parties en cours de l'hôte (reprise depuis le dashboard §6.2).
    pipe.sadd(gameKeys.hostGames(hostUserId), pin);
    pipe.expire(gameKeys.game(pin), GAME_TTL_S);
    pipe.expire(gameKeys.snapshot(pin), GAME_TTL_S);
    pipe.expire(gameKeys.hostGames(hostUserId), GAME_TTL_S);
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
    user: { id: string; displayName: string } | null,
    rawAvatar?: string,
  ): Promise<JoinSessionResult> {
    const userId = user?.id ?? null;
    const meta = await this.getMeta(pin);
    if (!meta) {
      throw new NotFoundException('session.not_found');
    }
    // Late join (§5) : autorisé tant que la partie n'est pas terminée. Le gateway
    // renvoie l'état courant au socket pour qu'il se positionne immédiatement.
    if (meta.state === GameState.Ended) {
      throw new BadRequestException('session.ended');
    }

    // Nom affiché (RG-15) : celui du compte tant que l'hôte n'ouvre pas le choix,
    // celui saisi sinon (et toujours, faute de compte).
    const fromAccount = !meta.pickOwnName && user ? accountNickname(user.displayName) : null;
    const wanted = fromAccount ?? sanitizeNickname(rawNickname);
    const normalized = normalizeAnswer(wanted);
    // Exclusion (RG-12) : pseudo banni tant que la clé court (durée fixée par l'hôte).
    if (await this.redis.exists(gameKeys.ban(pin, normalized))) {
      throw new ForbiddenException('session.banned');
    }
    // Deux comptes peuvent porter le même nom : on les distingue plutôt que de
    // refuser quelqu'un pour un homonyme qu'il n'a pas choisi.
    const nickname = fromAccount
      ? await this.claimAccountNickname(pin, fromAccount)
      : await this.claimNickname(pin, wanted);

    const playerId = randomBytes(16).toString('hex');
    const sessionToken = randomBytes(24).toString('base64url');
    // Graine d'avatar : bornée (client-fournie, stockée + diffusée), défaut = pseudo.
    const avatar = (rawAvatar ?? '').trim().slice(0, AVATAR_SEED_MAX) || nickname;
    const record: PlayerRecord = {
      nickname,
      avatar,
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
    // TTL aligné sur le reste de la famille (clés créées au 1er joueur).
    for (const key of [
      gameKeys.players(pin),
      gameKeys.nicknames(pin),
      gameKeys.leaderboard(pin),
      gameKeys.session(sessionToken),
    ]) {
      pipe.expire(key, GAME_TTL_S);
    }
    await pipe.exec();
    // Compteur = joueurs **connectés** (§8), pas le total jamais joint.
    const playerCount = await this.connectedCount(pin);

    return { pin, playerId, sessionToken, nickname, avatar, playerCount };
  }

  /**
   * Change la graine d'avatar d'un joueur (cosmétique) — uniquement en LOBBY.
   * Renvoie l'enregistrement mis à jour (avec le nouvel avatar), ou `null` si la
   * partie a démarré / le joueur n'existe plus. La valeur est bornée.
   */
  async setAvatar(pin: string, playerId: string, rawAvatar: string): Promise<PlayerRecord | null> {
    const meta = await this.getMeta(pin);
    if (!meta || meta.state !== GameState.Lobby) return null;
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    if (!raw) return null;
    const record = JSON.parse(raw) as PlayerRecord;
    record.avatar = (rawAvatar ?? '').trim().slice(0, AVATAR_SEED_MAX) || record.nickname;
    await this.redis.hset(gameKeys.players(pin), playerId, JSON.stringify(record));
    return record;
  }

  /** Lit l'état scalaire d'une partie (null si inexistante/expirée). */
  async getMeta(pin: string): Promise<GameMeta | null> {
    const raw = await this.redis.hgetall(gameKeys.game(pin));
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }
    return deserializeMeta(raw);
  }

  /** Lit le snapshot figé du quiz (null si partie inexistante/expirée). */
  async getSnapshot(pin: string): Promise<QuizSnapshot | null> {
    const raw = await this.redis.get(gameKeys.snapshot(pin));
    return raw ? (JSON.parse(raw) as QuizSnapshot) : null;
  }

  /**
   * Re-reads the quiz and refreshes the **form** of the frozen snapshot (see
   * `refreshSnapshotForm`) — called by the engine at each step change so the
   * host's edits reach a running session without touching its substance.
   * Returns the snapshot in use (unchanged when the quiz is gone).
   */
  async refreshSnapshot(pin: string): Promise<QuizSnapshot | null> {
    const frozen = await this.getSnapshot(pin);
    if (!frozen) return null;
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: frozen.quizId },
      include: QUIZ_SNAPSHOT_INCLUDE,
    });
    if (!quiz) return frozen;
    const refreshed = refreshSnapshotForm(frozen, quiz);
    await this.redis.set(gameKeys.snapshot(pin), JSON.stringify(refreshed), 'KEEPTTL');
    return refreshed;
  }

  /** Nombre de joueurs **connectés** (§8 : base de la convergence et des compteurs). */
  async connectedCount(pin: string): Promise<number> {
    const raw = await this.redis.hgetall(gameKeys.players(pin));
    let n = 0;
    for (const json of Object.values(raw)) {
      if ((JSON.parse(json) as PlayerRecord).connected) n++;
    }
    return n;
  }

  /**
   * Bascule le drapeau `connected` d'un joueur (déconnexion / reconnexion §8).
   * Renvoie l'enregistrement mis à jour, ou `null` si le joueur n'existe plus.
   */
  async setConnected(
    pin: string,
    playerId: string,
    connected: boolean,
  ): Promise<PlayerRecord | null> {
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    if (!raw) return null;
    const record = JSON.parse(raw) as PlayerRecord;
    record.connected = connected;
    await this.redis.hset(gameKeys.players(pin), playerId, JSON.stringify(record));
    return record;
  }

  /**
   * Bannit un joueur (RG-12) : pose une clé ban auto-expirante sur son pseudo
   * normalisé (durée = `minutes`), puis le retire du hash joueurs, du set des
   * pseudos et du classement. Renvoie son pseudo (ou `null` s'il n'est plus là).
   * La reconnexion échoue ensuite d'elle-même (record absent → `setConnected` null),
   * et le re-join est refusé par la clé ban.
   */
  async banPlayer(pin: string, playerId: string, minutes: number): Promise<string | null> {
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    if (!raw) return null;
    const record = JSON.parse(raw) as PlayerRecord;
    const normalized = normalizeAnswer(record.nickname);
    const ttlS = Math.max(1, Math.round(minutes * 60));
    const pipe = this.redis.multi();
    pipe.set(gameKeys.ban(pin, normalized), '1', 'EX', ttlS);
    pipe.hdel(gameKeys.players(pin), playerId);
    pipe.srem(gameKeys.nicknames(pin), normalized);
    pipe.zrem(gameKeys.leaderboard(pin), playerId);
    await pipe.exec();
    return record.nickname;
  }

  /** Résout un jeton de session → { pin, playerId } (reconnexion §6.1). */
  async resolveSession(token: string): Promise<{ pin: string; playerId: string } | null> {
    const raw = await this.redis.get(gameKeys.session(token));
    return raw ? (JSON.parse(raw) as { pin: string; playerId: string }) : null;
  }

  /** Retire un PIN de l'index des parties en cours de l'hôte (fin de partie §6.2). */
  async removeHostGame(hostUserId: string, pin: string): Promise<void> {
    await this.redis.srem(gameKeys.hostGames(hostUserId), pin);
  }

  /**
   * Enregistre l'avis d'un joueur en fin de partie (§2.11). N'accepte qu'une partie
   * **terminée** (PODIUM/ENDED) et une note Likert 1..5. `upsert` sur `[pin,playerId]`
   * → une seule note par joueur et par partie (re-noter révise, pas d'erreur d'unicité).
   * Le commentaire est borné/élagué. Le quiz est résolu depuis l'état live (Redis).
   */
  async recordFeedback(
    pin: string,
    playerId: string,
    rating: number,
    comment?: string,
  ): Promise<{ ok: boolean }> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false };
    }
    const meta = await this.getMeta(pin);
    if (!meta || (meta.state !== GameState.Podium && meta.state !== GameState.Ended)) {
      return { ok: false };
    }
    const snapshot = await this.getSnapshot(pin);
    if (snapshot && !snapshot.feedbackEnabled) {
      return { ok: false }; // rating switched off on this quiz
    }
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    if (!raw) {
      return { ok: false };
    }
    const player = JSON.parse(raw) as PlayerRecord;
    const cleanComment = comment?.trim() ? comment.trim().slice(0, 2000) : null;
    await this.prisma.quizFeedback.upsert({
      where: { pin_playerId: { pin, playerId } },
      create: {
        quizId: meta.quizId,
        pin,
        playerId,
        nickname: player.nickname,
        rating,
        comment: cleanComment,
      },
      update: { rating, comment: cleanComment },
    });
    return { ok: true };
  }

  /**
   * Liste les parties **encore vivantes** d'un hôte (dashboard §6.2). Purge au
   * passage les PINs dont l'état a expiré ou est terminé (index auto-nettoyant).
   */
  async listActiveHostGames(hostUserId: string): Promise<ActiveGame[]> {
    const pins = await this.redis.smembers(gameKeys.hostGames(hostUserId));
    const games: ActiveGame[] = [];
    for (const pin of pins) {
      const meta = await this.getMeta(pin);
      if (!meta || meta.state === GameState.Ended) {
        await this.redis.srem(gameKeys.hostGames(hostUserId), pin);
        continue;
      }
      games.push({
        pin,
        quizId: meta.quizId,
        title: meta.title,
        state: meta.state,
        playerCount: await this.connectedCount(pin),
      });
    }
    return games;
  }

  /**
   * Toutes les parties vivantes de l'instance, avec le nom de leur hôte — vue
   * d'ensemble réservée à l'`admin` (RG-14). Parcourt les index par hôte
   * (`host:{id}:games`) : un hôte voit les siennes, l'administrateur voit tout.
   */
  async listAllActiveGames(): Promise<ActiveGame[]> {
    const keys = await this.redis.keys(gameKeys.hostGames('*'));
    const games: ActiveGame[] = [];
    for (const key of keys) {
      const hostUserId = key.split(':')[1];
      const host = await this.prisma.user.findUnique({
        where: { id: hostUserId },
        select: { displayName: true },
      });
      for (const game of await this.listActiveHostGames(hostUserId)) {
        games.push({ ...game, host: host?.displayName ?? hostUserId });
      }
    }
    return games;
  }

  /**
   * Réserve un pseudo saisi dans la partie (ensemble Redis, atomique). Refus net
   * si un autre joueur l'a déjà : il en choisira un autre.
   */
  private async claimNickname(pin: string, nickname: string): Promise<string> {
    const claimed = await this.redis.sadd(gameKeys.nicknames(pin), normalizeAnswer(nickname));
    if (claimed === 0) {
      throw new ConflictException('nickname.taken');
    }
    return nickname;
  }

  /**
   * Même chose pour un nom venu du compte : l'homonyme n'est pas un choix, donc on
   * le suffixe (« Alice (2) ») au lieu de refuser la participation.
   */
  private async claimAccountNickname(pin: string, base: string): Promise<string> {
    for (let n = 1; n <= NICKNAME_HOMONYM_MAX; n++) {
      const candidate = n === 1 ? base : suffixNickname(base, n);
      const claimed = await this.redis.sadd(gameKeys.nicknames(pin), normalizeAnswer(candidate));
      if (claimed === 1) return candidate;
    }
    throw new ConflictException('nickname.taken');
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
    throw new ServiceUnavailableException('pin.unavailable');
  }
}

/** Valide et nettoie un pseudo (longueur, espaces) — anti-abus §7. */
export function sanitizeNickname(raw: string): string {
  const nickname = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    throw new BadRequestException({
      code: 'nickname.invalid_length',
      params: { min: NICKNAME_MIN, max: NICKNAME_MAX },
    });
  }
  return nickname;
}

/**
 * Nom affiché tiré du compte : mêmes bornes qu'un pseudo saisi, tronqué au besoin.
 * Un nom trop court pour la règle (ou vide) n'est pas utilisable — l'appelant
 * retombe alors sur le pseudo saisi.
 */
export function accountNickname(displayName: string): string | null {
  const name = (displayName ?? '').trim().replace(/\s+/g, ' ').slice(0, NICKNAME_MAX);
  return name.length >= NICKNAME_MIN ? name : null;
}

/** « Alice » → « Alice (2) », en restant dans la longueur maximale d'un pseudo. */
function suffixNickname(base: string, n: number): string {
  const suffix = ` (${n})`;
  return base.slice(0, NICKNAME_MAX - suffix.length) + suffix;
}

/** Sérialise les méta pour un hash Redis (tout en string). */
function serializeMeta(meta: GameMeta): Record<string, string> {
  const raw: Record<string, string> = {
    id: meta.id,
    quizId: meta.quizId,
    hostUserId: meta.hostUserId,
    state: meta.state,
    currentIndex: String(meta.currentIndex),
    totalQuestions: String(meta.totalQuestions),
    fullCapture: meta.fullCapture ? '1' : '0',
    personalTracking: meta.personalTracking ? '1' : '0',
    pickOwnName: meta.pickOwnName ? '1' : '0',
    title: meta.title,
    language: meta.language,
    createdAt: String(meta.createdAt),
    questionStartedAt: String(meta.questionStartedAt),
    questionEndsAt: String(meta.questionEndsAt),
    mode: meta.mode,
    paused: meta.paused ? '1' : '0',
    clockFrozen: meta.clockFrozen ? '1' : '0',
    autoNextAt: String(meta.autoNextAt ?? 0),
    autoNextMs: String(meta.autoNextMs ?? 0),
    slideIndex: String(meta.slideIndex ?? -1),
  };
  if (meta.prevState !== undefined) raw.prevState = meta.prevState;
  if (meta.pausedRemainingMs !== undefined) raw.pausedRemainingMs = String(meta.pausedRemainingMs);
  return raw;
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
    // Défauts pour les parties déjà en vol avant l'ajout des deux options : les mêmes
    // qu'à la création, pour qu'une session d'avant le déploiement se comporte comme
    // une nouvelle (sous OIDC, le nom vient du compte).
    personalTracking: raw.personalTracking !== '0',
    pickOwnName: raw.pickOwnName === undefined ? !isOidcMode() : raw.pickOwnName === '1',
    title: raw.title,
    language: raw.language,
    createdAt: Number(raw.createdAt),
    questionStartedAt: Number(raw.questionStartedAt ?? 0),
    questionEndsAt: Number(raw.questionEndsAt ?? 0),
    // Défauts pour les parties déjà en vol avant l'ajout du mode (§8).
    mode: raw.mode === 'auto' ? 'auto' : 'manual',
    paused: raw.paused === '1',
    clockFrozen: raw.clockFrozen === '1',
    autoNextAt: raw.autoNextAt ? Number(raw.autoNextAt) : 0,
    autoNextMs: raw.autoNextMs ? Number(raw.autoNextMs) : 0,
    slideIndex: raw.slideIndex ? Number(raw.slideIndex) : -1,
    prevState: raw.prevState,
    pausedRemainingMs: raw.pausedRemainingMs ? Number(raw.pausedRemainingMs) : undefined,
    reviewStep: raw.reviewStep ?? '',
    joinBaseUrl: raw.joinBaseUrl ?? '',
  };
}
