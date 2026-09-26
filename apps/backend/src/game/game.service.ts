import { randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUDIO_TARGETS,
  type AudioTarget,
  GameState,
  type ParticipantAccess,
  type PlayerPresence,
} from '@quiz-dock/contracts';
import { QuizStatus } from '@prisma/client';
import { allowsAnonymousParticipants, isOidcMode } from '../auth/auth-mode';
import { MediaLibraryService } from '../media/media-library.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import { RedisService } from '../redis/redis.service';
import { GAME_TTL_S, type GameId, gameKeys } from './game.keys';
import type {
  GameFields,
  GameMeta,
  PlayerRecord,
  PlayerScore,
  QuizSnapshot,
  RoomMeta,
} from './game.types';
import {
  QUIZ_SNAPSHOT_INCLUDE,
  buildSnapshot,
  refreshSnapshotForm,
  snapshotHasSound,
} from './snapshot';

const PIN_ALLOC_ATTEMPTS = 10;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
/** Homonymes distingués par un suffixe avant de refuser (noms venus des comptes). */
const NICKNAME_HOMONYM_MAX = 20;
/** Borne de la graine d'avatar (client-fournie, stockée Redis + diffusée). */
const AVATAR_SEED_MAX = 64;

/** A player's score at the start of a game. */
const ZERO_SCORE = JSON.stringify({ score: 0, streak: 0 } satisfies PlayerScore);

/*
 * The two moves that must see the same room: a player joining and a quiz
 * opening. Lua runs them whole. A game's keys are `game:<id>…` (see gameKeys).
 */

/**
 * Join. KEYS: players, room, session, tokens, nicknames. ARGV: playerId, record,
 * session value, token, zero score, TTL, the two states of a game that is over.
 * Returns 1 when the player is in the current game, 0 when they wait for the next.
 */
const JOIN_SCRIPT = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[6])
redis.call('HSET', KEYS[4], ARGV[1], ARGV[4])
for _, key in ipairs({KEYS[1], KEYS[4], KEYS[5]}) do redis.call('EXPIRE', key, ARGV[6]) end
local game = redis.call('HGET', KEYS[2], 'gameId')
if not game then return 0 end
local state = redis.call('HGET', 'game:' .. game, 'state')
if state == ARGV[7] or state == ARGV[8] then return 0 end
local scores = 'game:' .. game .. ':scores'
redis.call('HSET', scores, ARGV[1], ARGV[5])
redis.call('EXPIRE', scores, ARGV[6])
return 1
`;

/**
 * Switch the room to a new game. KEYS: players, room, the new game's scores, the
 * previous game's hash. ARGV: game id, zero score, TTL, the ended state. The
 * previous game ends there: nothing reads it as being played any more.
 * Returns the number of players carried over.
 */
const SWITCH_GAME_SCRIPT = `
local ids = redis.call('HKEYS', KEYS[1])
for _, id in ipairs(ids) do redis.call('HSET', KEYS[3], id, ARGV[2]) end
if #ids > 0 then redis.call('EXPIRE', KEYS[3], ARGV[3]) end
redis.call('HSET', KEYS[2], 'gameId', ARGV[1])
if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('HSET', KEYS[4], 'state', ARGV[4]) end
return #ids
`;

export interface CreateSessionResult {
  pin: string;
}

export interface JoinSessionResult {
  pin: string;
  playerId: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  presence: PlayerPresence;
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
    private readonly mediaLibrary?: MediaLibraryService,
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
      participantAccess?: ParticipantAccess;
    },
  ): Promise<CreateSessionResult> {
    // Open access is the admin's to allow (#57): a client asking for it anyway is refused.
    const open = dto.participantAccess === 'open';
    if (open && !allowsAnonymousParticipants()) {
      throw new ForbiddenException('session.open_access_forbidden');
    }
    const snapshot = await this.playableSnapshot(hostUserId, dto.quizId);
    const roomId = randomBytes(16).toString('hex');
    const pin = await this.allocatePin(roomId);
    const gameId = newGameId();

    const room: RoomMeta = {
      roomId,
      hostUserId,
      gameId,
      fullCapture: dto.fullCapture === true,
      // Suivi individuel : par défaut oui (RG-16). Nom choisi : par défaut oui, sauf
      // sous OIDC où le nom vient du compte tant que l'hôte n'ouvre pas le choix.
      // Open access: guests only, so nothing personal to track and no account to
      // take a name from.
      personalTracking: !open && dto.personalTracking !== false,
      pickOwnName: open || (dto.pickOwnName ?? !isOidcMode()),
      participantAccess: open ? 'open' : 'account',
      joinLocked: false,
      joinBaseUrl: '',
      openedAt: Date.now(),
    };

    const pipe = this.redis.multi();
    pipe.hset(gameKeys.room(pin), serializeRoom(room));
    pipe.expire(gameKeys.room(pin), GAME_TTL_S);
    this.writeGame(pipe, gameId, snapshot);
    // Index des parties en cours de l'hôte (reprise depuis le dashboard §6.2).
    pipe.sadd(gameKeys.hostGames(hostUserId), pin);
    pipe.expire(gameKeys.hostGames(hostUserId), GAME_TTL_S);
    await pipe.exec();

    return { pin };
  }

  /**
   * Opens a new game of `quizId` in the room: its own snapshot and state, in the
   * lobby, every player of the room at 0. The room points at it from then on;
   * the previous game's state stays under its own id until it expires, so
   * nothing it left behind (locks, answers, scores) reaches the new one. The
   * host's pace and audio target carry over from the previous game.
   */
  async openGame(pin: string, quizId: string): Promise<GameId> {
    return this.openGameWith(pin, await this.snapshotFor(pin, quizId));
  }

  /** The snapshot of a quiz the room's host may play next (throws like `host:create`). */
  async snapshotFor(pin: string, quizId: string): Promise<QuizSnapshot> {
    const room = await this.getRoom(pin);
    if (!room) throw new NotFoundException('session.not_found');
    return this.playableSnapshot(room.hostUserId, quizId);
  }

  /** `openGame` with the snapshot already frozen. */
  async openGameWith(pin: string, snapshot: QuizSnapshot): Promise<GameId> {
    const previous = await this.getMeta(pin);
    if (!previous) throw new NotFoundException('session.not_found');
    const gameId = newGameId();
    const pipe = this.redis.multi();
    this.writeGame(pipe, gameId, snapshot, {
      mode: previous.mode,
      audioTarget: previous.audioTarget ?? '',
    });
    await pipe.exec();
    // Every player of the room at 0, and the room on the new game, in one step: a
    // player joining meanwhile lands in one game or the other, never in neither.
    await this.redis.eval(
      SWITCH_GAME_SCRIPT,
      4,
      gameKeys.players(pin),
      gameKeys.room(pin),
      gameKeys.scores(gameId),
      gameKeys.game(previous.id),
      gameId,
      ZERO_SCORE,
      GAME_TTL_S,
      GameState.Ended,
    );
    await this.touchRoom(pin);
    return gameId;
  }

  /**
   * Keeps a room alive while it is used: its keys, its players' session tokens
   * and its current game start their TTL again. An idle room still expires.
   */
  async touchRoom(pin: string): Promise<void> {
    const room = await this.getRoom(pin);
    if (!room) return;
    const tokens = Object.values(await this.redis.hgetall(gameKeys.tokens(pin)));
    const pipe = this.redis.multi();
    for (const key of [
      gameKeys.pin(pin),
      gameKeys.room(pin),
      gameKeys.players(pin),
      gameKeys.nicknames(pin),
      gameKeys.tokens(pin),
      gameKeys.hostGames(room.hostUserId),
      gameKeys.game(room.gameId),
      gameKeys.snapshot(room.gameId),
      gameKeys.scores(room.gameId),
      ...tokens.map((token) => gameKeys.session(token)),
    ]) {
      pipe.expire(key, GAME_TTL_S);
    }
    await pipe.exec();
  }

  /** The snapshot of a quiz the host may play: theirs, `ready`, with at least one question. */
  private async playableSnapshot(hostUserId: string, quizId: string): Promise<QuizSnapshot> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ownerId: hostUserId },
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
    // Frozen with the rest: a licence's attribution is owed for what was played.
    const credits = (await this.mediaLibrary?.creditsOf(quiz.id)) ?? [];
    if (credits.length > 0) snapshot.credits = credits;
    return snapshot;
  }

  /** Queues a new game's state, in the lobby (its players come with the room's switch). */
  private writeGame(
    pipe: ReturnType<RedisService['multi']>,
    gameId: GameId,
    snapshot: QuizSnapshot,
    carried: Pick<GameFields, 'mode' | 'audioTarget'> = { mode: 'manual', audioTarget: '' },
  ): void {
    const game: GameFields = {
      quizId: snapshot.quizId,
      state: GameState.Lobby,
      currentIndex: -1,
      totalQuestions: snapshot.questions.length,
      title: snapshot.title,
      language: snapshot.language,
      createdAt: Date.now(),
      questionStartedAt: 0,
      questionEndsAt: 0,
      // Rythme par défaut : l'hôte enchaîne les questions (§8) ; ensuite, celui du quiz précédent.
      mode: carried.mode,
      audioTarget: carried.audioTarget,
      paused: false,
      clockFrozen: false,
    };
    pipe.hset(gameKeys.game(gameId), serializeGame(game));
    pipe.set(gameKeys.snapshot(gameId), JSON.stringify(snapshot));
    pipe.expire(gameKeys.game(gameId), GAME_TTL_S);
    pipe.expire(gameKeys.snapshot(gameId), GAME_TTL_S);
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
    wantedPresence?: PlayerPresence,
  ): Promise<JoinSessionResult> {
    const meta = await this.getMeta(pin);
    if (!meta) {
      throw new NotFoundException('session.not_found');
    }
    // Late join (§5) : autorisé tant que la partie n'est pas terminée. Le gateway
    // renvoie l'état courant au socket pour qu'il se positionne immédiatement.
    if (meta.state === GameState.Ended) {
      throw new BadRequestException('session.ended');
    }
    // Under `AUTH_MODE=oidc` the account opens the application and the PIN one
    // game (RG-15) — unless the host opened this one to all (#57). There everyone
    // is a guest, signed in or not: no account attached, no name taken from one.
    const open = meta.participantAccess === 'open';
    if (isOidcMode() && !open && !user) {
      throw new UnauthorizedException('auth.required');
    }
    const account = open ? null : user;
    const userId = account?.id ?? null;
    // Closed by the host: those already in come back through `player:reconnect`.
    if (meta.joinLocked) {
      throw new ForbiddenException('session.locked');
    }

    // Nom affiché (RG-15) : celui du compte tant que l'hôte n'ouvre pas le choix,
    // celui saisi sinon (et toujours, faute de compte).
    const fromAccount = !meta.pickOwnName && account ? accountNickname(account.displayName) : null;
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
    // Remote: no projection in sight, so the answers' text (and any sound) comes to this device.
    const presence: PlayerPresence = wantedPresence === 'remote' ? 'remote' : 'room';
    const record: PlayerRecord = {
      nickname,
      avatar,
      userId,
      connected: true,
      joinedAt: Date.now(),
      latencyMs: 0,
      presence,
    };

    // In the room, and in the game it plays unless that one is over (the player
    // then waits for the next quiz) — read in the same step, so a quiz opening
    // meanwhile cannot leave them out of both.
    await this.redis.eval(
      JOIN_SCRIPT,
      5,
      gameKeys.players(pin),
      gameKeys.room(pin),
      gameKeys.session(sessionToken),
      gameKeys.tokens(pin),
      gameKeys.nicknames(pin),
      playerId,
      JSON.stringify(record),
      JSON.stringify({ pin, playerId }),
      sessionToken,
      ZERO_SCORE,
      GAME_TTL_S,
      GameState.Podium,
      GameState.Ended,
    );
    // Compteur = joueurs **connectés** (§8), pas le total jamais joint.
    const playerCount = await this.connectedCount(pin);

    return { pin, playerId, sessionToken, nickname, avatar, presence, playerCount };
  }

  /**
   * What a player is told before joining: whether the quiz plays sound, and
   * whether an account is needed to get in (#57). Throws like `hasSound`.
   */
  async peek(pin: string): Promise<{ hasSound: boolean; participantAccess: ParticipantAccess }> {
    const hasSound = await this.hasSound(pin);
    const meta = await this.getMeta(pin);
    return { hasSound, participantAccess: meta?.participantAccess ?? 'account' };
  }

  /**
   * Whether the quiz of a live game plays any sound or video — what a player is
   * told before joining. Throws for a game that does not exist or is over.
   */
  async hasSound(pin: string): Promise<boolean> {
    const meta = await this.getMeta(pin);
    if (!meta) throw new NotFoundException('session.not_found');
    if (meta.state === GameState.Ended) throw new BadRequestException('session.ended');
    const snapshot = await this.getSnapshot(meta.id);
    return !!snapshot && snapshotHasSound(snapshot);
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

  /** The room behind a PIN (null when gone or expired). */
  async getRoom(pin: string): Promise<RoomMeta | null> {
    const raw = await this.redis.hgetall(gameKeys.room(pin));
    if (!raw || !raw.gameId) return null;
    return deserializeRoom(raw);
  }

  /** The game the room plays, merged with the room (null when either is gone or expired). */
  async getMeta(pin: string): Promise<GameMeta | null> {
    const room = await this.getRoom(pin);
    if (!room) return null;
    const raw = await this.redis.hgetall(gameKeys.game(room.gameId));
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }
    return {
      ...deserializeGame(raw),
      id: room.gameId,
      roomId: room.roomId,
      hostUserId: room.hostUserId,
      fullCapture: room.fullCapture,
      personalTracking: room.personalTracking,
      pickOwnName: room.pickOwnName,
      participantAccess: room.participantAccess,
      joinLocked: room.joinLocked,
      joinBaseUrl: room.joinBaseUrl,
    };
  }

  /** The frozen snapshot of a game (null when gone or expired). */
  async getSnapshot(gameId: GameId): Promise<QuizSnapshot | null> {
    const raw = await this.redis.get(gameKeys.snapshot(gameId));
    return raw ? (JSON.parse(raw) as QuizSnapshot) : null;
  }

  /** The snapshot of the game a room plays. */
  async currentSnapshot(pin: string): Promise<QuizSnapshot | null> {
    const room = await this.getRoom(pin);
    return room ? this.getSnapshot(room.gameId) : null;
  }

  /** A player's score in a game (null when they do not play it). */
  async getScore(gameId: GameId, playerId: string): Promise<PlayerScore | null> {
    const raw = await this.redis.hget(gameKeys.scores(gameId), playerId);
    return raw ? (JSON.parse(raw) as PlayerScore) : null;
  }

  /**
   * Re-reads the quiz and refreshes the **form** of the frozen snapshot (see
   * `refreshSnapshotForm`) — called by the engine at each step change so the
   * host's edits reach a running session without touching its substance.
   * Returns the snapshot in use (unchanged when the quiz is gone).
   */
  async refreshSnapshot(gameId: GameId): Promise<QuizSnapshot | null> {
    const frozen = await this.getSnapshot(gameId);
    if (!frozen) return null;
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: frozen.quizId },
      include: QUIZ_SNAPSHOT_INCLUDE,
    });
    if (!quiz) return frozen;
    const refreshed = refreshSnapshotForm(frozen, quiz);
    await this.redis.set(gameKeys.snapshot(gameId), JSON.stringify(refreshed), 'KEEPTTL');
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
  async banPlayer(
    pin: string,
    gameId: GameId,
    playerId: string,
    minutes: number,
  ): Promise<string | null> {
    const raw = await this.redis.hget(gameKeys.players(pin), playerId);
    if (!raw) return null;
    const record = JSON.parse(raw) as PlayerRecord;
    const normalized = normalizeAnswer(record.nickname);
    const ttlS = Math.max(1, Math.round(minutes * 60));
    const pipe = this.redis.multi();
    pipe.set(gameKeys.ban(pin, normalized), '1', 'EX', ttlS);
    pipe.hdel(gameKeys.players(pin), playerId);
    pipe.srem(gameKeys.nicknames(pin), normalized);
    pipe.hdel(gameKeys.scores(gameId), playerId);
    pipe.hdel(gameKeys.tokens(pin), playerId);
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
    const snapshot = await this.getSnapshot(meta.id);
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
      where: { pin_playerId_quizId: { pin, playerId, quizId: meta.quizId } },
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
  private async allocatePin(roomId: string): Promise<string> {
    for (let i = 0; i < PIN_ALLOC_ATTEMPTS; i++) {
      const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const ok = await this.redis.set(gameKeys.pin(pin), roomId, 'EX', GAME_TTL_S, 'NX');
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

/** A new game's id: 32 hex characters (see `GAME_HASH_KEY`). */
function newGameId(): GameId {
  return randomBytes(16).toString('hex') as GameId;
}

/** The room hash (every field a string). */
function serializeRoom(room: RoomMeta): Record<string, string> {
  return {
    roomId: room.roomId,
    hostUserId: room.hostUserId,
    gameId: room.gameId,
    fullCapture: room.fullCapture ? '1' : '0',
    personalTracking: room.personalTracking ? '1' : '0',
    pickOwnName: room.pickOwnName ? '1' : '0',
    participantAccess: room.participantAccess,
    joinLocked: room.joinLocked ? '1' : '0',
    joinBaseUrl: room.joinBaseUrl,
    openedAt: String(room.openedAt),
  };
}

function deserializeRoom(raw: Record<string, string>): RoomMeta {
  return {
    roomId: raw.roomId,
    hostUserId: raw.hostUserId,
    gameId: raw.gameId as GameId,
    fullCapture: raw.fullCapture === '1',
    personalTracking: raw.personalTracking !== '0',
    pickOwnName: raw.pickOwnName === '1',
    participantAccess: raw.participantAccess === 'open' ? 'open' : 'account',
    joinLocked: raw.joinLocked === '1',
    joinBaseUrl: raw.joinBaseUrl ?? '',
    openedAt: Number(raw.openedAt),
  };
}

/** The game hash (every field a string). */
function serializeGame(game: GameFields): Record<string, string> {
  const raw: Record<string, string> = {
    quizId: game.quizId,
    state: game.state,
    currentIndex: String(game.currentIndex),
    totalQuestions: String(game.totalQuestions),
    audioTarget: game.audioTarget ?? '',
    mediaWaitUntil: String(game.mediaWaitUntil ?? 0),
    mediaLeadMs: game.mediaLeadMs == null ? '' : String(game.mediaLeadMs),
    title: game.title,
    language: game.language,
    createdAt: String(game.createdAt),
    questionStartedAt: String(game.questionStartedAt),
    questionEndsAt: String(game.questionEndsAt),
    mode: game.mode,
    paused: game.paused ? '1' : '0',
    clockFrozen: game.clockFrozen ? '1' : '0',
    autoNextAt: String(game.autoNextAt ?? 0),
    autoNextMs: String(game.autoNextMs ?? 0),
    slideIndex: String(game.slideIndex ?? -1),
  };
  if (game.prevState !== undefined) raw.prevState = game.prevState;
  if (game.pausedRemainingMs !== undefined) raw.pausedRemainingMs = String(game.pausedRemainingMs);
  return raw;
}

function deserializeGame(raw: Record<string, string>): GameFields {
  return {
    quizId: raw.quizId,
    state: raw.state,
    currentIndex: Number(raw.currentIndex),
    totalQuestions: Number(raw.totalQuestions),
    audioTarget: (AUDIO_TARGETS as readonly string[]).includes(raw.audioTarget ?? '')
      ? (raw.audioTarget as AudioTarget)
      : '',
    mediaWaitUntil: raw.mediaWaitUntil ? Number(raw.mediaWaitUntil) : 0,
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
    prevState: raw.prevState,
    pausedRemainingMs: raw.pausedRemainingMs ? Number(raw.pausedRemainingMs) : undefined,
    reviewStep: raw.reviewStep ?? '',
  };
}
