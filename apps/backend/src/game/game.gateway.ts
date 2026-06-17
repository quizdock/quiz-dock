import { Inject, Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type {
  AnswerValue,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@roux-quizz/contracts';
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
export class GameGateway implements OnGatewayInit {
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
      throw new WsException('Authentification hôte requise.');
    }
    const { pin } = await this.game.createSession(host.id, payload);
    socket.data.pin = pin;
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
    @MessageBody() payload: { pin: string; nickname: string },
  ): Promise<{ sessionToken: string; playerId: string }> {
    const userId = socket.data.user?.id ?? null;
    const res = await this.game.joinSession(payload.pin, payload.nickname, userId);
    socket.data.pin = res.pin;
    socket.data.playerId = res.playerId;
    await socket.join(res.pin);
    this.server.to(res.pin).emit('player:joined', {
      playerId: res.playerId,
      nickname: res.nickname,
      playerCount: res.playerCount,
    });
    return { sessionToken: res.sessionToken, playerId: res.playerId };
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
      throw new WsException('Rejoignez la partie avant de répondre.');
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

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() socket: GameSocket, @MessageBody() payload: { t0: number }): void {
    socket.emit('pong', { t0: payload.t0, t1: Date.now() });
  }

  /** Exige un socket d'hôte authentifié ; renvoie son id utilisateur. */
  private requireHostId(socket: GameSocket): string {
    const host = socket.data.user;
    if (!host) {
      throw new WsException('Authentification hôte requise.');
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
