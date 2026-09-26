import type { INestApplication } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import { RedisService } from '../../src/redis/redis.service';
import { PIN_ATTEMPTS_MAX } from '../../src/game/pin-attempts';
import { type GameContext } from '../game-harness';

/** Creating and joining a game: PIN, nicknames, the invitation address, the console outline, participant access and the lobby lock (#57). */
export function lobbyTests(ctx: GameContext): void {
  let app: INestApplication;
  let quizId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    app = ctx.h.app;
    quizId = ctx.quizId;
  });

  it('répond `pong` à un `ping` (RTT)', async () => {
    const socket = connect();
    const pong = await new Promise<{ t0: number; t1: number }>((resolve, reject) => {
      socket.on('pong', resolve);
      socket.on('connect_error', reject);
      socket.emit('ping', { t0: 42 });
    });
    expect(pong.t0).toBe(42);
    expect(typeof pong.t1).toBe('number');
  }, 15_000);

  it('host:create → PIN à 6 chiffres + game:created ; player:join → lobby notifié', async () => {
    const host = connect({ localUser: 'Animateur' });
    const created = new Promise<{ pin: string }>((resolve) => host.on('game:created', resolve));

    const createAck = await host.emitWithAck('host:create', { quizId });
    expect(createAck.pin).toMatch(/^\d{6}$/);
    expect((await created).pin).toBe(createAck.pin);

    const pin = createAck.pin;
    const player = connect();
    const joined = new Promise<{ playerId: string; nickname: string; playerCount: number }>(
      (resolve) => host.on('player:joined', resolve),
    );

    const joinAck = await player.emitWithAck('player:join', { pin, nickname: 'Alice' });
    expect(joinAck.playerId).toBeTruthy();
    expect(joinAck.sessionToken).toBeTruthy();

    const evt = await joined;
    expect(evt.nickname).toBe('Alice');
    expect(evt.playerId).toBe(joinAck.playerId);
    expect(evt.playerCount).toBe(1);
  }, 15_000);

  it('player:join refuse un pseudo dupliqué (même partie)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const p1 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Bob' });

    const p2 = connect();
    // En cas d'erreur serveur (ConflictException), l'ack n'est jamais appelé → le
    // filtre WS émet l'event `error` typé du contrat ({ code, message }).
    const err = await Promise.race([
      new Promise<{ code: string }>((resolve) => p2.on('error', resolve)),
      p2
        .emitWithAck('player:join', { pin, nickname: 'bob' })
        .then(() => ({ code: 'accepted' as const })),
    ]);
    expect(err.code).toBe('nickname.taken');
  }, 15_000);

  it('host:join-url: the invitation address reaches every screen, also on (re)attach, and locks at start', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const screen = connect();
    const urlP = new Promise<{ baseUrl: string | null }>((resolve) =>
      screen.once('game:join-url', (p) => resolve(p as never)),
    );
    await screen.emitWithAck('spectator:join', { pin });
    host.emit('host:join-url', { pin, baseUrl: '192.168.1.103:15173/' });
    expect(await urlP).toEqual({ baseUrl: 'http://192.168.1.103:15173' });

    // A screen that attaches later gets it with the state burst.
    const late = connect();
    const lateP = new Promise<{ baseUrl: string | null }>((resolve) =>
      late.once('game:join-url', (p) => resolve(p as never)),
    );
    await late.emitWithAck('spectator:join', { pin });
    expect(await lateP).toEqual({ baseUrl: 'http://192.168.1.103:15173' });

    // Once started, the address is frozen (the QR on the projection must not move).
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Lou' });
    host.emit('host:start', { pin });
    await new Promise<void>((resolve) => player.once('question:start', () => resolve()));
    const errP = new Promise<{ code?: string }>((resolve) =>
      host.once('error', (e) => resolve(e as never)),
    );
    host.emit('host:join-url', { pin, baseUrl: 'http://other:1' });
    expect((await errP).code).toBe('session.already_started');
  }, 15_000);

  it('host:attach : la console reçoit game:outline (titre + description + questions)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const outlineP = new Promise<{
      title: string;
      description: string | null;
      questions: Array<{ index: number; prompt: string; timeLimitS: number }>;
    }>((resolve) => host.on('game:outline', (o) => resolve(o as never)));
    await host.emitWithAck('host:attach', { pin });
    const outline = await outlineP;

    expect(outline.title).toBe('Quiz live test');
    expect(outline.description).toBe('Quiz de démonstration');
    expect(outline.questions).toHaveLength(1);
    expect(outline.questions[0].prompt).toBe('Capitale de la France ?');
  }, 15_000);

  describe('participant access and lobby lock (#57)', () => {
    const env = process.env;
    afterEach(() => {
      process.env = env;
    });

    const errorOf = (socket: Socket, event: string, payload: unknown) =>
      Promise.race([
        new Promise<{ code: string }>((resolve) => socket.once('error', resolve)),
        socket.emitWithAck(event, payload).then(() => ({ code: 'accepted' as const })),
      ]);

    it('refuses open access unless the server allows it', async () => {
      const host = connect({ localUser: 'Animateur' });
      const err = await errorOf(host, 'host:create', { quizId, participantAccess: 'open' });
      expect(err.code).toBe('session.open_access_forbidden');
    }, 15_000);

    it('opens a game to guests under oidc once allowed: no tracking, a chosen name', async () => {
      const host = connect({ localUser: 'Animateur' });
      await new Promise<void>((resolve) => host.on('connect', () => resolve()));
      // The host socket authenticated at the handshake; the policy is read per event.
      process.env = { ...env, AUTH_MODE: 'oidc', ALLOW_ANONYMOUS_PARTICIPANTS: 'true' };
      const notice = new Promise<{ personalTracking: boolean; participantAccess: string }>(
        (resolve) => host.on('notice', resolve),
      );
      const { pin } = await host.emitWithAck('host:create', {
        quizId,
        participantAccess: 'open',
        personalTracking: true,
      });
      expect(await notice).toMatchObject({ personalTracking: false, participantAccess: 'open' });

      const guest = connect();
      expect(await guest.emitWithAck('player:peek', { pin })).toMatchObject({
        participantAccess: 'open',
      });
      const ack = await guest.emitWithAck('player:join', { pin, nickname: 'Guest' });
      expect(ack.nickname).toBe('Guest');

      // Tracking stays off while the game is open to all.
      const err = await errorOf(host, 'host:options', { pin, personalTracking: true });
      expect(err.code).toBe('session.open_access_guests_only');
    }, 15_000);

    it('tells a player before joining that the game requires accounts', async () => {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId });
      const player = connect();
      expect(await player.emitWithAck('player:peek', { pin })).toEqual({
        hasSound: false,
        participantAccess: 'account',
      });
    }, 15_000);

    it('makes an address wait after too many wrong PINs, for one window', async () => {
      const redis = app.get(RedisService);
      // Every socket of this suite shares one address: start clean, leave clean.
      const clear = async () => {
        const keys = await redis.keys('pin-attempts:*');
        if (keys.length) await redis.del(...keys);
      };
      await clear();
      try {
        const guest = connect();
        // Every event that takes a PIN without authentication counts.
        expect((await errorOf(guest, 'spectator:join', { pin: '000000' })).code).toBe(
          'session.not_found',
        );
        for (let i = 1; i < PIN_ATTEMPTS_MAX; i++) {
          expect((await errorOf(guest, 'player:peek', { pin: '000000' })).code).toBe(
            'session.not_found',
          );
        }
        const host = connect({ localUser: 'Animateur' });
        const { pin } = await host.emitWithAck('host:create', { quizId });
        // Right PIN or not, the address now waits for the end of the window.
        expect((await errorOf(guest, 'player:peek', { pin })).code).toBe('pin.too_many_attempts');
        const [key] = await redis.keys('pin-attempts:*');
        expect(await redis.ttl(key)).toBeGreaterThan(0);
      } finally {
        await clear();
      }
    }, 20_000);

    it('closes the game to newcomers, not to those already in', async () => {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId });
      const player = connect();
      const { sessionToken } = await player.emitWithAck('player:join', { pin, nickname: 'Early' });

      const locked = new Promise<{ joinLocked: boolean }>((resolve) =>
        host.on('notice', (n: { joinLocked: boolean }) => n.joinLocked && resolve(n)),
      );
      host.emit('host:lock', { pin, locked: true });
      await locked;

      const late = connect();
      expect((await errorOf(late, 'player:join', { pin, nickname: 'Late' })).code).toBe(
        'session.locked',
      );

      player.disconnect();
      await new Promise((r) => setTimeout(r, 100));
      const back = connect();
      expect((await back.emitWithAck('player:reconnect', { sessionToken })).ok).toBe(true);
    }, 15_000);
  });
}
