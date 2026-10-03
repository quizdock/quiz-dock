import { Inject, Logger, UseFilters } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
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
  AudioTarget,
  ClientToServerEvents,
  RoomSoundsSettings,
  GameMode,
  GameStep,
  HostMediaCommand,
  ParticipantAccess,
  PlayerPresence,
  ServerToClientEvents,
} from '@quiz-dock/contracts';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import type { Server, Socket } from 'socket.io';
import { AUTH_PROVIDER, type AuthProvider } from '../auth/auth-provider';
import { isHost } from '../auth/roles';
import { UsersService } from '../users/users.service';
import { GameEngine } from './game.engine';
import { GameService } from './game.service';
import { noticeOf } from './game.types';
import { isCrossOrigin, readCookie, SESSION_COOKIE } from '../auth/oidc/session-cookie';
import { clientIp } from '../common/trust-proxy';
import { PinAttempts } from './pin-attempts';
import { WsExceptionFilter } from './ws-exception.filter';
import { slideTitle } from './snapshot';
import { isAnswerValue } from './scoring';

/** Données attachées à chaque socket de jeu. */
export interface GameSocketData {
  user?: User; // hôte authentifié (host:* ), sinon invité
  playerId?: string;
  pin?: string;
  /** Vrai pour une fenêtre de **contrôle** hôte (host:create / host:attach) — §7. */
  isHostControl?: boolean;
  /**
   * A copy of the projection a participant opened on a device of their own (#104):
   * it follows the projection, is never waited for, never speaks for the sound.
   */
  follower?: boolean;
}

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  GameSocketData
>;

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: '/game', allowRequest: sameOriginHandshake })
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly log = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: GameServer;

  constructor(
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly users: UsersService,
    private readonly game: GameService,
    private readonly engine: GameEngine,
    private readonly pins: PinAttempts,
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
    // Each message of a socket, within a budget: far above what a page sends,
    // short of a script flooding the room (each message may reach every device).
    server.on('connection', (socket) => socket.use(messageBudget()));
    server.use((socket, next) => {
      const auth = socket.handshake.auth ?? {};
      if (!auth.token && !auth.localUser && !sessionCookieOf(socket as GameSocket)) {
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
    @MessageBody()
    payload: {
      quizId: string;
      fullCapture?: boolean;
      personalTracking?: boolean;
      pickOwnName?: boolean;
    },
  ): Promise<{ pin: string }> {
    const hostId = this.requireHostId(socket);
    const { pin } = await this.game.createSession(hostId, payload);
    socket.data.pin = pin;
    socket.data.isHostControl = true;
    await socket.join(pin);
    socket.emit('game:created', { pin });
    const meta = await this.game.getMeta(pin);
    if (meta) socket.emit('notice', noticeOf(meta));
    return { pin };
  }

  /**
   * Before joining: whether the quiz plays sound, so the form offers "in the
   * room / remote", and whether an account is needed (#57), so the page sends
   * to the sign-in only when it is. Nothing else about the quiz leaks; the PIN
   * is enough, as for the projection.
   */
  @SubscribeMessage('player:peek')
  async playerPeek(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string },
  ): Promise<{ hasSound: boolean; participantAccess: ParticipantAccess }> {
    return this.pins.guard(ipOf(socket), () => this.game.peek(payload.pin));
  }

  /**
   * Joueur (invité ou participant authentifié) : rejoint le lobby d'une partie.
   * Renvoie son `playerId` + un `sessionToken` de reconnexion, et notifie la room.
   * Sous `AUTH_MODE=oidc`, le jeton est exigé (RG-15) sauf partie en accès libre
   * (#57) — le service en décide, il lit la partie. Les PIN faux sont comptés.
   */
  @SubscribeMessage('player:join')
  async playerJoin(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody()
    payload: { pin: string; nickname: string; avatar?: string; presence?: PlayerPresence },
  ): Promise<{ sessionToken: string; playerId: string; nickname: string }> {
    const user = socket.data.user ?? null;
    // One player per socket: joining again would leave the first one connected
    // for good (a ghost in the counts).
    if (socket.data.playerId && socket.data.pin === payload.pin) {
      if (await this.game.getPlayer(payload.pin, socket.data.playerId)) {
        throw new WsException('session.already_joined');
      }
    }
    const res = await this.pins.guard(ipOf(socket), () =>
      this.game.joinSession(payload.pin, payload.nickname, user, payload.avatar, payload.presence),
    );
    socket.data.pin = res.pin;
    socket.data.playerId = res.playerId;
    await socket.join(res.pin);
    this.server.to(res.pin).emit('player:joined', {
      playerId: res.playerId,
      nickname: res.nickname,
      playerCount: res.playerCount,
      avatar: res.avatar,
      presence: res.presence,
    });
    // Late join (§5) : positionne immédiatement le retardataire sur l'état courant.
    await this.engine.sendStateTo(socket, res.pin);
    await this.engine.broadcastReadiness(res.pin);
    return { sessionToken: res.sessionToken, playerId: res.playerId, nickname: res.nickname };
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
    await this.engine.requireHost(payload.pin, this.requireHostId(socket));
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
  private async emitOutline(socket: Pick<GameSocket, 'emit'>, pin: string): Promise<void> {
    const snapshot = await this.game.currentSnapshot(pin);
    if (!snapshot) return;
    socket.emit('game:outline', {
      quizId: snapshot.quizId,
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
      slides: snapshot.slides.map((s, slideIndex) => ({
        slideIndex,
        beforeQuestionIndex: s.beforeQuestionIndex,
        title: slideTitle(s.blocks),
        displayDelayS: s.displayDelayS,
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
    @MessageBody() payload: { pin: string; follow?: boolean },
  ): Promise<{ ok: boolean }> {
    await this.pins.guard(ipOf(socket), async () => {
      if (!(await this.game.getMeta(payload.pin))) throw new WsException('session.not_found');
    });
    socket.data.pin = payload.pin;
    socket.data.follower = payload.follow === true;
    await socket.join(payload.pin);
    await this.engine.sendStateTo(socket, payload.pin);
    // A projection counts among the devices waited for (a participant's copy does not).
    await this.engine.broadcastReadiness(payload.pin);
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
      presence: record.presence ?? 'room',
    });
    await this.engine.sendStateTo(socket, session.pin);
    await this.engine.broadcastReadiness(session.pin);
    return { ok: true };
  }

  /** `player:avatar` : change la graine d'avatar du joueur (cosmétique), avant le démarrage. */
  @SubscribeMessage('player:avatar')
  async playerAvatar(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; avatar: string },
  ): Promise<void> {
    const me = playerOf(socket, payload.pin);
    if (!me) return;
    await this.engine.setAvatar(me.pin, me.playerId, payload.avatar);
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
    // Only the game this socket joined, and an answer the scoring can take: refused
    // before anything is read, graded, logged or stored.
    const me = playerOf(socket, payload?.pin);
    const { questionIndex, answer } = payload ?? {};
    if (!me || !Number.isInteger(questionIndex) || questionIndex < 0 || !isAnswerValue(answer)) {
      socket.emit('answer:ack', { accepted: false, receivedAt, reason: 'unknown' });
      return;
    }
    const ack = await this.engine.submit(me.pin, playerId, questionIndex, answer, receivedAt);
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

  /** `host:review` : shows a played step again (question reveal or slide); `host:next` resumes. */
  @SubscribeMessage('host:review')
  async hostReview(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string } & GameStep,
  ): Promise<void> {
    const step: GameStep =
      'slideIndex' in payload
        ? { slideIndex: Number(payload.slideIndex) }
        : { questionIndex: Number(payload.questionIndex) };
    await this.engine.review(payload.pin, this.requireHostId(socket), step);
  }

  /** `host:join-url` : adresse des invitations (QR, lien), au lobby seulement. */
  @SubscribeMessage('host:join-url')
  async hostJoinUrl(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; baseUrl: string },
  ): Promise<void> {
    await this.engine.setJoinUrl(
      payload.pin,
      this.requireHostId(socket),
      String(payload.baseUrl ?? ''),
    );
  }

  /** `host:end` : termine la partie. */
  @SubscribeMessage('host:end')
  async hostEnd(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; archive?: boolean },
  ): Promise<void> {
    await this.engine.end(payload.pin, this.requireHostId(socket), payload.archive === true);
  }

  /** `host:sounds` (#93): the room's game sounds. */
  @SubscribeMessage('host:sounds')
  async hostSounds(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string } & RoomSoundsSettings,
  ): Promise<void> {
    const { pin, ...patch } = payload;
    await this.engine.setSounds(pin, this.requireHostId(socket), patch);
  }

  /** `host:motion`: whether the room's screens move between steps (UI system §1.8). */
  @SubscribeMessage('host:motion')
  async hostMotion(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; on: boolean },
  ): Promise<void> {
    await this.engine.setMotion(payload.pin, this.requireHostId(socket), payload.on);
  }

  /** `player:ready` (#104): the participant is ready, or not yet, in the lobby. */
  @SubscribeMessage('player:ready')
  async playerReady(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; ready: boolean },
  ): Promise<{ ok: boolean }> {
    const me = playerOf(socket, payload.pin);
    if (!me) return { ok: false };
    return { ok: await this.engine.setReady(me.pin, me.playerId, payload.ready === true) };
  }

  /** `host:room-name`: the room's own name, from its lobby. */
  @SubscribeMessage('host:room-name')
  async hostRoomName(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; name: string },
  ): Promise<void> {
    await this.engine.setRoomName(payload.pin, this.requireHostId(socket), payload.name);
  }

  /** `host:next-quiz`: the room's next quiz, in its lobby; the consoles get its outline. */
  @SubscribeMessage('host:next-quiz')
  async hostNextQuiz(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; quizId: string; archive?: boolean },
  ): Promise<{ ok: boolean }> {
    const { pin } = payload;
    await this.engine.nextQuiz(
      pin,
      this.requireHostId(socket),
      String(payload.quizId ?? ''),
      payload.archive === true,
    );
    for (const control of await this.server.in(pin).fetchSockets()) {
      if (control.data.isHostControl) await this.emitOutline(control, pin);
    }
    return { ok: true };
  }

  /** `host:lock` : ferme la partie aux nouveaux participants (ou la rouvre), jusqu'à la fin. */
  @SubscribeMessage('host:lock')
  async hostLock(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; locked: boolean },
  ): Promise<void> {
    await this.engine.setJoinLocked(
      payload.pin,
      this.requireHostId(socket),
      payload.locked === true,
    );
  }

  /** `host:capture` : (dé)active la capture intégrale depuis le lobby, avant le démarrage. */
  @SubscribeMessage('host:capture')
  async hostCapture(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; fullCapture: boolean },
  ): Promise<void> {
    await this.engine.setCapture(payload.pin, this.requireHostId(socket), payload.fullCapture);
  }

  /**
   * `host:options` : règle le suivi individuel et le nom affiché choisi depuis le
   * lobby, avant le démarrage (RG-15, RG-16). Les participants voient l'avis suivre.
   */
  @SubscribeMessage('host:options')
  async hostOptions(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody()
    payload: {
      pin: string;
      personalTracking?: boolean;
      pickOwnName?: boolean;
      audioTarget?: AudioTarget;
    },
  ): Promise<void> {
    await this.engine.setOptions(payload.pin, this.requireHostId(socket), payload);
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

  /** `host:media` : the host steers the current question's media on every device that plays it. */
  @SubscribeMessage('host:media')
  async hostMedia(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: HostMediaCommand,
  ): Promise<void> {
    if (!payload || !MEDIA_ACTIONS.includes(payload.action)) return;
    await this.engine.mediaControl(payload.pin, this.requireHostId(socket), payload);
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
    const me = playerOf(socket, payload.pin);
    if (!me) return { ok: false };
    return this.game.recordFeedback(me.pin, me.playerId, payload.rating, payload.comment);
  }

  /** A device has loaded what it fetched ahead of a step, a question or a slide (its own room only). */
  @SubscribeMessage('media:ready')
  async mediaReady(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() payload: { pin: string; questionIndex: number; slideIndex?: number },
  ): Promise<void> {
    if (!socket.data.pin || socket.data.pin !== payload.pin) return;
    await this.engine.markMediaReady(
      payload.pin,
      socket,
      payload.questionIndex,
      payload.slideIndex,
    );
  }

  /**
   * The projection's position in the current sound, relayed to everyone else in
   * the room. Only a projection speaks for it: not a participant, not a console.
   */
  @SubscribeMessage('media:position')
  mediaPosition(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody()
    payload: {
      pin: string;
      questionIndex: number;
      slideIndex?: number;
      t: number;
      playing: boolean;
    },
  ): void {
    const { pin, playerId, isHostControl, follower } = socket.data;
    if (!pin || pin !== payload.pin || playerId || isHostControl || follower) return;
    const { questionIndex, slideIndex, t, playing } = payload;
    if (!Number.isInteger(questionIndex) || !Number.isFinite(t) || t < 0) return;
    // A slide's sound (#125) is told apart from the question it precedes.
    const slide = Number.isInteger(slideIndex) && slideIndex! >= 0 ? { slideIndex } : {};
    socket
      .to(pin)
      .emit('media:position', { questionIndex, ...slide, t, playing: playing === true });
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
      return;
    }
    // A projection gone: one device fewer to wait for.
    if (pin) await this.engine.broadcastReadiness(pin).catch(() => undefined);
  }

  /** Exige un socket authentifié avec le rôle hôte (`host`/`admin`). */
  private requireHost(socket: GameSocket): User {
    const host = socket.data.user;
    if (!host) {
      throw new WsException('host.auth_required');
    }
    if (!isHost(host.roles)) {
      throw new WsException('auth.host_required');
    }
    return host;
  }

  private requireHostId(socket: GameSocket): string {
    return this.requireHost(socket).id;
  }
}

/**
 * The player a socket is, in the room it names — its own room only: a PIN sent
 * by the client is never trusted over the one the socket joined. Null otherwise.
 */
/** Messages a socket may send at once, and per second after that. */
export const MESSAGE_BURST = 60;
export const MESSAGES_PER_S = 20;

/**
 * A token bucket per socket: a message over the budget is dropped (a request
 * waiting for its answer then times out on its side). Logged once per socket.
 */
export function messageBudget(now: () => number = Date.now) {
  let tokens = MESSAGE_BURST;
  let at = now();
  let told = false;
  return (_packet: unknown[], next: (err?: Error) => void): void => {
    const t = now();
    tokens = Math.min(MESSAGE_BURST, tokens + ((t - at) / 1000) * MESSAGES_PER_S);
    at = t;
    if (tokens < 1) {
      if (!told)
        Logger.warn('A socket sends faster than its budget: messages dropped', 'GameGateway');
      told = true;
      return;
    }
    tokens -= 1;
    next();
  };
}

function playerOf(socket: GameSocket, pin: string): { pin: string; playerId: string } | null {
  const { pin: joined, playerId } = socket.data;
  return joined && joined === pin && playerId ? { pin: joined, playerId } : null;
}

/** What the console may do to the question's media. */
const MEDIA_ACTIONS: readonly HostMediaCommand['action'][] = ['restart', 'play', 'pause', 'seek'];

/**
 * The game's sockets come from the application's own pages: a browser's
 * handshake from another site is turned away (a WebSocket is not bound by
 * CORS, so the server checks it). A client that is not a browser acting for a
 * page sends no such header and is let through, as on the API.
 */
export function sameOriginHandshake(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
): void {
  const crossOrigin = isCrossOrigin(req.headers, req.headers.host);
  callback(crossOrigin ? 'cross-origin' : null, !crossOrigin);
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
      cookie: sessionCookieOf(socket),
    },
  } as unknown as Request;
}

/**
 * The browser's session cookie (`AUTH_MODE=oidc`), when the handshake comes from
 * the application's own pages: another origin's page opening a socket here
 * (cross-site WebSocket hijacking) stays a guest.
 */
function sessionCookieOf(socket: GameSocket): string | undefined {
  const { headers } = socket.handshake;
  if (!readCookie(headers.cookie, SESSION_COOKIE)) return undefined;
  return isCrossOrigin(headers, headers.host) ? undefined : headers.cookie;
}

/** The address a socket connected from, through our reverse proxy if any. */
function ipOf(socket: GameSocket): string {
  return clientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
}
