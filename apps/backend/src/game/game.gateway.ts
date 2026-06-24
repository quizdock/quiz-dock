import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type {
  AnswerValue,
  ClientToServerEvents,
  GameMode,
  ServerToClientEvents,
} from '@quiz-dock/contracts';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import type { Server, Socket } from 'socket.io';
import { AUTH_PROVIDER, type AuthProvider } from '../auth/auth-provider';
import { UsersService } from '../users/users.service';
import { GameEngine } from './game.engine';
import { GameService } from './game.service';
import { WsExceptionFilter } from './ws-exception.filter';

/** Données attachées à chaque socket de jeu. */
export interface GameSocketData {
  user?: User; // hôte authentifié (host:* ), sinon invité
  playerId?: string;
  pin?: string;
  /** Vrai pour une fenêtre de **contrôle** hôte (host:create / host:attach) — §7. */
  isHostControl?: boolean;
}

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  GameSocketData
>;

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: '/game', cors: { origin: true } })
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly log = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: GameServer;

  constructor(
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly users: UsersService,
    private readonly game: GameService,
    private readonly engine: GameEngine,
  ) {}

  /**
   * Auth en **middleware** (et non `handleConnection`) : garantit que
   * `socket.data.user` est résolu AVANT tout message — sinon `host:create`
   * pourrait s'exécuter pendant que l'auth est encore en vol (race Socket.IO).
   * Un socket sans auth reste un invité (joueur) ; on ne bloque jamais la
   * connexion sur une auth absente.
   */
  afterInit(server: GameServer): void {
    this.engine.bindServer(server);
    server.use((socket, next) => {
      const auth = socket.handshake.auth ?? {};
      if (!auth.token && !auth.localUser) {
        next();
        return;
      }
      this.auth
        .authenticate(handshakeAsRequest(socket as GameSocket))
        .then(async (principal) => {
          if (principal) {
            socket.data.user = await this.users.upsertFromPrincipal(principal);
          }
          next();
        })
        .catch((err: Error) => {
          this.log.warn(`Auth handshake échouée: ${err.message}`);
          next(); // invité (pas de blocage ; les events host:* refuseront)
        });
    });
  }

  /**
   * Hôte authentifié : crée une partie pour un de ses quiz `ready`. Le snapshot
   * est figé côté service ; le socket rejoint la room du PIN et reçoit le PIN
   * en accusé de réception (+ `game:created`, et `notice` si capture intégrale).
   */
  @SubscribeMessage('host:create')
  async hostCreate(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { quizId: string; fullCapture?: boolean },
  ): Promise<{ pin: string }> {
    const host = socket.data.user;
    if (!host) {
      throw new WsException('host.auth_required');
    }
    const { pin } = await this.game.createSession(host.id, payload);
    socket.data.pin = pin;
    socket.data.isHostControl = true;
    await socket.join(pin);
    socket.emit('game:created', { pin });
    if (payload.fullCapture === true) {
      socket.emit('notice', { fullCapture: true });
    }
    return { pin };
  }

  /**
   * Joueur (invité ou apprenant authentifié) : rejoint le lobby d'une partie.
   * Renvoie son `playerId` + un `sessionToken` de reconnexion, et notifie la room.
   */
  @SubscribeMessage('player:join')
  async playerJoin(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; nickname: string; avatar?: string },
  ): Promise<{ sessionToken: string; playerId: string }> {
    const userId = socket.data.user?.id ?? null;
    const res = await this.game.joinSession(payload.pin, payload.nickname, userId, payload.avatar);
    socket.data.pin = res.pin;
    socket.data.playerId = res.playerId;
    await socket.join(res.pin);
    this.server.to(res.pin).emit('player:joined', {
      playerId: res.playerId,
      nickname: res.nickname,
      playerCount: res.playerCount,
      avatar: res.avatar,
    });
    // Late join (§5) : positionne immédiatement le retardataire sur l'état courant.
    await this.engine.sendStateTo(socket, res.pin);
    return { sessionToken: res.sessionToken, playerId: res.playerId };
  }

  /**
   * `host:attach` : rebinde un hôte **propriétaire** à sa partie (reconnexion ou
   * 2ᵉ fenêtre de contrôle, cross-device §4.2). L'identité hôte est la clé — aucun
   * jeton dans l'URL. Renvoie l'état courant au socket.
   */
  @SubscribeMessage('host:attach')
  async hostAttach(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<{ ok: boolean }> {
    const host = socket.data.user;
    if (!host) {
      throw new WsException('host.auth_required');
    }
    const meta = await this.game.getMeta(payload.pin);
    if (!meta) {
      throw new WsException('session.not_found');
    }
    if (meta.hostUserId !== host.id) {
      throw new WsException('host.forbidden');
    }
    socket.data.pin = payload.pin;
    socket.data.isHostControl = true;
    await socket.join(payload.pin);
    // L'hôte est de retour : annule la grâce/fenêtre de fin et reprend si la partie
    // était figée en HOST_DISCONNECTED (§7.3), avant de relire l'état pour ce socket.
    await this.engine.onHostAttached(payload.pin);
    await this.engine.sendStateTo(socket, payload.pin);
    // Sommaire des questions pour la console de contrôle (carrousel d'avancement).
    // Réservé à l'hôte propriétaire : pas de fuite anti-triche (c'est son quiz).
    await this.emitOutline(socket, payload.pin);
    return { ok: true };
  }

  /** Émet le sommaire des questions (sans secret) à une fenêtre de contrôle hôte. */
  private async emitOutline(socket: GameSocket, pin: string): Promise<void> {
    const snapshot = await this.game.getSnapshot(pin);
    if (!snapshot) return;
    socket.emit('game:outline', {
      title: snapshot.title,
      description: snapshot.description,
      questions: snapshot.questions.map((q, index) => ({
        index,
        type: q.type,
        prompt: q.prompt,
        timeLimitS: q.timeLimitS,
        // Clé de correction — n'est jamais envoyée qu'à la console hôte (ce socket).
        correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
      })),
    });
  }

  /**
   * `spectator:join` : rejoint la room en **lecture seule** (fenêtre projetée §3).
   * Aucune auth ; le PIN suffit. N'enregistre aucun joueur → n'affecte ni les
   * compteurs ni la convergence. Renvoie l'état courant (sans résultat personnel).
   */
  @SubscribeMessage('spectator:join')
  async spectatorJoin(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<{ ok: boolean }> {
    const meta = await this.game.getMeta(payload.pin);
    if (!meta) {
      throw new WsException('session.not_found');
    }
    socket.data.pin = payload.pin;
    await socket.join(payload.pin);
    await this.engine.sendStateTo(socket, payload.pin);
    return { ok: true };
  }

  /**
   * `player:reconnect` : restaure une place via le jeton de session (§6.1). Repasse
   * le joueur `connected=true`, le ré-attache à la room et lui renvoie l'état courant
   * (avec résultat personnel). Ack `{ ok:false }` si la partie est finie/expirée.
   */
  @SubscribeMessage('player:reconnect')
  async playerReconnect(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { sessionToken: string },
  ): Promise<{ ok: boolean }> {
    const session = await this.game.resolveSession(payload.sessionToken);
    if (!session) {
      return { ok: false };
    }
    const meta = await this.game.getMeta(session.pin);
    if (!meta || meta.state === 'ENDED') {
      return { ok: false };
    }
    const record = await this.game.setConnected(session.pin, session.playerId, true);
    if (!record) {
      return { ok: false };
    }
    socket.data.pin = session.pin;
    socket.data.playerId = session.playerId;
    await socket.join(session.pin);
    this.server.to(session.pin).emit('player:joined', {
      playerId: session.playerId,
      nickname: record.nickname,
      playerCount: await this.game.connectedCount(session.pin),
      avatar: record.avatar,
    });
    await this.engine.sendStateTo(socket, session.pin);
    return { ok: true };
  }

  /** `player:avatar` : change la graine d'avatar du joueur (cosmétique), avant le démarrage. */
  @SubscribeMessage('player:avatar')
  async playerAvatar(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; avatar: string },
  ): Promise<void> {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    await this.engine.setAvatar(payload.pin, playerId, payload.avatar);
  }

  /** `host:start` : l'hôte propriétaire lance la 1re question (LOBBY → ANSWERING). */
  @SubscribeMessage('host:start')
  async hostStart(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<void> {
    await this.engine.start(payload.pin, this.requireHostId(socket));
  }

  /**
   * `player:submit` : soumet une réponse. Le serveur réhorodate à la réception
   * (§6) ; l'accusé `answer:ack` est renvoyé au seul socket émetteur.
   */
  @SubscribeMessage('player:submit')
  async playerSubmit(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; questionIndex: number; answer: AnswerValue },
  ): Promise<void> {
    const receivedAt = Date.now();
    const playerId = socket.data.playerId;
    if (!playerId) {
      throw new WsException('session.join_required');
    }
    const ack = await this.engine.submit(
      payload.pin,
      playerId,
      payload.questionIndex,
      payload.answer,
      receivedAt,
    );
    socket.emit('answer:ack', ack);
  }

  /** `host:reveal` : force le reveal de la question courante. */
  @SubscribeMessage('host:reveal')
  async hostReveal(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<void> {
    await this.engine.reveal(payload.pin, this.requireHostId(socket));
  }

  /** `host:next` : question suivante ou podium. */
  @SubscribeMessage('host:next')
  async hostNext(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<void> {
    await this.engine.next(payload.pin, this.requireHostId(socket));
  }

  /** `host:end` : termine la partie. */
  @SubscribeMessage('host:end')
  async hostEnd(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; archive?: boolean },
  ): Promise<void> {
    await this.engine.end(payload.pin, this.requireHostId(socket), payload.archive === true);
  }

  /** `host:capture` : (dé)active la capture intégrale depuis le lobby, avant le démarrage. */
  @SubscribeMessage('host:capture')
  async hostCapture(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; fullCapture: boolean },
  ): Promise<void> {
    await this.engine.setCapture(payload.pin, this.requireHostId(socket), payload.fullCapture);
  }

  /** `host:ban` : exclut un joueur pour une durée donnée (minutes). */
  @SubscribeMessage('host:ban')
  async hostBan(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; playerId: string; minutes: number },
  ): Promise<void> {
    await this.engine.banPlayer(
      payload.pin,
      this.requireHostId(socket),
      payload.playerId,
      payload.minutes,
    );
  }

  /** `host:mode` : bascule le rythme manuel/auto en cours de partie (§8). */
  @SubscribeMessage('host:mode')
  async hostMode(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; mode: GameMode },
  ): Promise<void> {
    await this.engine.setMode(payload.pin, this.requireHostId(socket), payload.mode);
  }

  /** `host:pause` : suspend/reprend l'auto-progression (gèle le chrono en ANSWERING). */
  @SubscribeMessage('host:pause')
  async hostPause(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; paused: boolean },
  ): Promise<void> {
    await this.engine.setPaused(payload.pin, this.requireHostId(socket), payload.paused);
  }

  /** `host:adjust-time` : ajoute/retire du temps au chrono de la question courante. */
  @SubscribeMessage('host:adjust-time')
  async hostAdjustTime(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; deltaS: number },
  ): Promise<void> {
    await this.engine.adjustTime(payload.pin, this.requireHostId(socket), payload.deltaS);
  }

  /**
   * `player:rate` : avis de fin de partie (note Likert + commentaire). Le joueur est
   * identifié par son socket (comme `player:submit`) ; le service refuse hors PODIUM/ENDED.
   */
  @SubscribeMessage('player:rate')
  async playerRate(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; rating: number; comment?: string },
  ): Promise<{ ok: boolean }> {
    const playerId = socket.data.playerId;
    if (!playerId) {
      return { ok: false };
    }
    return this.game.recordFeedback(payload.pin, playerId, payload.rating, payload.comment);
  }

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() socket: GameSocket, @MessageBody() payload: { t0: number }): void {
    socket.emit('pong', { t0: payload.t0, t1: Date.now() });
  }

  /**
   * Déconnexion d'un socket. Joueur (§8) : `connected=false`, `player:left` +
   * re-vérification de la convergence. Contrôle hôte (§7) : si plus aucune autre
   * fenêtre de contrôle, délai de grâce puis `HOST_DISCONNECTED`.
   */
  async handleDisconnect(socket: GameSocket): Promise<void> {
    const { pin, playerId, user, isHostControl } = socket.data;
    if (pin && playerId) {
      await this.engine.handlePlayerDisconnect(pin, playerId).catch((err: Error) => {
        this.log.warn(`handlePlayerDisconnect ${pin}/${playerId}: ${err.message}`);
      });
      return;
    }
    if (pin && isHostControl && user) {
      await this.engine.handleHostDisconnect(pin, user.id).catch((err: Error) => {
        this.log.warn(`handleHostDisconnect ${pin}/${user.id}: ${err.message}`);
      });
    }
  }

  /** Exige un socket d'hôte authentifié ; renvoie son id utilisateur. */
  private requireHostId(socket: GameSocket): string {
    const host = socket.data.user;
    if (!host) {
      throw new WsException('host.auth_required');
    }
    return host.id;
  }
}

/** Adapte le handshake Socket.IO en pseudo-`Request` pour `AuthProvider`. */
function handshakeAsRequest(socket: GameSocket): Request {
  const auth = (socket.handshake.auth ?? {}) as {
    token?: string;
    localUser?: string;
  };
  return {
    headers: {
      authorization: auth.token ? `Bearer ${auth.token}` : undefined,
      'x-local-user': auth.localUser,
    },
  } as unknown as Request;
}
