import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { ClientToServerEvents, ServerToClientEvents } from '@roux-quizz/contracts';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import type { Server, Socket } from 'socket.io';
import { AUTH_PROVIDER, type AuthProvider } from '../auth/auth-provider';
import { UsersService } from '../users/users.service';

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

@WebSocketGateway({ namespace: '/game', cors: { origin: true } })
export class GameGateway implements OnGatewayConnection {
  private readonly log = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: GameServer;

  constructor(
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly users: UsersService,
  ) {}

  /**
   * Authentifie le socket via le handshake (réutilise AuthProvider) UNIQUEMENT si
   * une auth est fournie (hôte) ; un socket sans auth reste un invité (joueur).
   */
  async handleConnection(socket: GameSocket): Promise<void> {
    const auth = socket.handshake.auth ?? {};
    if (!auth.token && !auth.localUser) return; // invité
    const principal = await this.auth.authenticate(handshakeAsRequest(socket));
    if (principal) {
      socket.data.user = await this.users.upsertFromPrincipal(principal);
    }
  }

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() socket: GameSocket, @MessageBody() payload: { t0: number }): void {
    socket.emit('pong', { t0: payload.t0, t1: Date.now() });
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
