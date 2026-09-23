import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { type Socket, io } from 'socket.io-client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { GameService } from './game.service';

/**
 * Test d'INTÉGRATION : vraie connexion socket.io-client → gateway /game.
 * Requiert Postgres + Redis joignables (dev compose / services CI) ; la base est
 * `<db>_test`, créée par le global setup de Jest.
 * Couvre : ping/pong, host:create (PIN + snapshot) et player:join (lobby).
 */
/** L'appelant d'une lecture de quiz : un hôte ordinaire (RG-14). */
const asHost = (id: string) => ({ id, roles: [UserRole.host] });

describe('GameGateway (intégration socket)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let quizId: string;
  let hostUserId: string;
  let previousSeat: { userId: string; expiresAt: Date | null } | null = null;
  const sockets: Socket[] = [];

  const connect = (auth?: Record<string, string>): Socket => {
    const socket = io(url, { transports: ['websocket'], auth, forceNew: true });
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    // Set by the Jest global setup: a test database and Redis database 1, never the dev ones.
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    process.env.GAME_READ_DELAY_MS = '150'; // accélère la fenêtre de lecture en test
    process.env.GAME_HOST_GRACE_MS = '200'; // grâce hôte courte (§7.1)
    process.env.GAME_HOST_WINDOW_MS = '1500'; // fenêtre de reconnexion hôte courte (§7.3)
    process.env.GAME_AUTO_ADVANCE_MS = '300'; // enchaînement auto rapide (§8) en test
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    prisma = app.get(PrismaService);

    // Seed : un hôte dont l'oidcSubject == slug local ('local:animateur'),
    // propriétaire d'un quiz « ready » avec une question valide. En mode local le
    // rôle dérive du siège d'hôte (HostSeatService) : on le lui attribue.
    const host = await prisma.user.upsert({
      where: { oidcSubject: 'local:animateur' },
      create: { oidcSubject: 'local:animateur', displayName: 'Animateur', roles: ['host'] },
      update: { roles: ['host'] },
    });
    hostUserId = host.id;
    // The seat is shared state of the target database: remember whose it was, give it back at the end.
    previousSeat = await prisma.hostSeat.findUnique({ where: { id: 1 } });
    await prisma.hostSeat.upsert({
      where: { id: 1 },
      create: { id: 1, userId: host.id, expiresAt: null },
      update: { userId: host.id, expiresAt: null },
    });
    const quiz = await prisma.quiz.create({
      data: {
        ownerId: host.id,
        title: 'Quiz live test',
        description: 'Quiz de démonstration',
        status: 'ready',
        questionCount: 1,
        questions: {
          create: {
            orderIndex: 0,
            type: 'single_choice',
            prompt: 'Capitale de la France ?',
            answerExplanation: 'Paris est la **capitale**.',
            timeLimitS: 5, // minimum autorisé (contrainte 5..120)
            options: {
              create: [
                { orderIndex: 0, text: 'Paris', color: 'red', shape: 'triangle', isCorrect: true },
                { orderIndex: 1, text: 'Lyon', color: 'blue', shape: 'diamond', isCorrect: false },
              ],
            },
          },
        },
      },
    });
    quizId = quiz.id;

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://localhost:${port}/game`;
  }, 30_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (quizId) await prisma.quiz.delete({ where: { id: quizId } }).catch(() => undefined);
    if (previousSeat) {
      await prisma.hostSeat
        .update({
          where: { id: 1 },
          data: { userId: previousSeat.userId, expiresAt: previousSeat.expiresAt },
        })
        .catch(() => undefined);
    }
    await app.close();
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

  it('host:start → question:start (allowlist, sans flag correct) puis REVEAL une seule fois', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Carol' });

    // Le joueur observe le démarrage de question et compte les passages REVEAL.
    let revealCount = 0;
    player.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealCount++;
    });
    const qStart = new Promise<Record<string, unknown>>((resolve) =>
      player.on('question:start', resolve),
    );

    host.emit('host:start', { pin });
    const q = (await qStart) as {
      questionIndex: number;
      startedAt: number;
      endsAt: number;
      options: Array<Record<string, unknown>>;
    };

    expect(q.questionIndex).toBe(0);
    expect(q.endsAt - q.startedAt).toBe(5000); // timeLimitS=5
    expect(q.startedAt).toBeGreaterThan(Date.now() - 100); // fenêtre de lecture future
    // Anti-cheat: the explanation (#5) is never part of question:start.
    expect(q).not.toHaveProperty('answerExplanation');
    // Anti-triche §7 : aucune option ne porte le flag correct.
    expect(q.options).toHaveLength(2);
    for (const o of q.options) {
      expect(o).not.toHaveProperty('isCorrect');
      expect(o).not.toHaveProperty('correctOrderIndex');
      expect(o.id).toBeTruthy();
    }

    // Laisse le timer (startedAt + 5000 + grace) déclencher le REVEAL.
    await new Promise((r) => setTimeout(r, 6000));
    expect(revealCount).toBe(1);
  }, 15_000);

  it('player:submit : accepté + scoré, doublon rejeté, REVEAL une seule fois (all + timer)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Dan' });

    let revealCount = 0;
    player.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealCount++;
    });
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );

    // answer:ack est un event (pas un ack Socket.IO) → on les met en file.
    const acks: Array<{ accepted: boolean }> = [];
    let nextAck: (() => void) | null = null;
    player.on('answer:ack', (a) => {
      acks.push(a as { accepted: boolean });
      nextAck?.();
    });
    const waitAck = (n: number) =>
      new Promise<void>((resolve) => {
        nextAck = () => acks.length >= n && resolve();
        if (acks.length >= n) resolve();
      });

    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;

    // Attendre l'ouverture des réponses (startedAt) avant de soumettre.
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    await waitAck(1);
    expect(acks[0].accepted).toBe(true);

    // 2e réponse du même joueur : rejetée (unicité RG-06).
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    await waitAck(2);
    expect(acks[1].accepted).toBe(false);

    // 1 joueur sur 1 a répondu → REVEAL anticipé ('all'). Puis le timer s'écoulera :
    // le verrou NX doit l'absorber → toujours UN seul REVEAL.
    await new Promise((r) => setTimeout(r, 6000));
    expect(revealCount).toBe(1);
  }, 15_000);

  it('boucle complète : reveal personnel (yourResult) puis host:next → podium', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Eve' });

    const revealP = new Promise<{
      correctOptionIds?: string[];
      yourResult?: { correct: boolean; points: number; totalScore: number; rank: number };
      answerExplanation?: string;
    }>((resolve) => player.on('question:reveal', (r) => resolve(r as never)));
    const podiumP = new Promise<{ you?: { rank: number; score: number } }>((resolve) =>
      player.on('game:podium', (p) => resolve(p as never)),
    );
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });

    const reveal = await revealP;
    expect(reveal.correctOptionIds).toEqual([parisId]); // bonne réponse divulguée
    expect(reveal.answerExplanation).toBe('Paris est la **capitale**.'); // #5
    expect(reveal.yourResult?.correct).toBe(true);
    expect(reveal.yourResult?.points).toBeGreaterThan(0);
    expect(reveal.yourResult?.rank).toBe(1);

    host.emit('host:next', { pin }); // dernière question → podium
    const podium = await podiumP;
    expect(podium.you?.rank).toBe(1);
    expect(podium.you?.score).toBeGreaterThan(0);
  }, 15_000);

  it('tells the projection on attach whether the quiz has sound, never the players', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const screen = connect();
    const media = new Promise((resolve) => screen.once('game:media', resolve));
    await screen.emitWithAck('spectator:join', { pin });
    expect(await media).toEqual({
      hasSound: false,
      hasMedia: false,
      audioTarget: 'projection_remote',
    }); // the seeded quiz is silent
    const player = connect();
    let told = false;
    player.on('game:media', () => (told = true));
    await player.emitWithAck('player:join', { pin, nickname: 'Mia' });
    await new Promise((r) => setTimeout(r, 100));
    expect(told).toBe(false);
    host.emit('host:end', { pin });
  }, 15_000);

  it('relays the host’s media restart to the projection while a question is live', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const screen = connect();
    await screen.emitWithAck('spectator:join', { pin });
    const controls: unknown[] = [];
    screen.on('media:control', (c) => controls.push(c));
    host.emit('host:media', { pin, action: 'restart' }); // lobby: nothing to restart
    const started = new Promise<void>((resolve) => screen.once('question:start', () => resolve()));
    host.emit('host:start', { pin });
    await started;
    const control = new Promise((resolve) => screen.once('media:control', resolve));
    host.emit('host:media', { pin, action: 'restart' });
    expect(await control).toEqual({ questionIndex: 0, action: 'restart' });
    expect(controls).toHaveLength(1);
    host.emit('host:end', { pin });
  }, 15_000);

  it('sends each device what it needs of the next question: the sound to the projection and to remote participants, not to phones in the room', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/preload-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 1000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const twoQuestions = await prisma.quiz.create({
      data: {
        ownerId: hostUserId,
        title: 'Preload test',
        status: 'ready',
        questionCount: 2,
        questions: {
          create: [0, 1].map((orderIndex) => ({
            orderIndex,
            type: 'poll' as const,
            prompt: `Q${orderIndex}`,
            timeLimitS: 5,
            pointsMode: 'none' as const,
            audioMediaId: orderIndex === 1 ? asset.id : null,
            options: {
              create: [
                { orderIndex: 0, text: 'A', color: 'red' as const, shape: 'triangle' as const },
                { orderIndex: 1, text: 'B', color: 'blue' as const, shape: 'diamond' as const },
              ],
            },
          })),
        },
      },
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: twoQuestions.id });
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const player = connect();
      await player.emitWithAck('player:join', { pin, nickname: 'Ada' });
      let playerPreloads = 0;
      player.on('media:preload', () => playerPreloads++);
      const remote = connect();
      await remote.emitWithAck('player:join', { pin, nickname: 'Grace', presence: 'remote' });
      const remotePreload = new Promise<{ questionIndex: number; media: { audio: unknown } }>(
        (resolve) => remote.once('media:preload', (p) => resolve(p as never)),
      );
      const preload = new Promise<{ questionIndex: number; media: { audio: { url: string } } }>(
        (resolve) => screen.once('media:preload', (p) => resolve(p as never)),
      );
      const reveal = new Promise<void>((resolve) =>
        player.once('question:reveal', () => resolve()),
      );
      const started = new Promise<void>((resolve) =>
        player.once('question:start', () => resolve()),
      );
      host.emit('host:start', { pin });
      await started;
      host.emit('host:reveal', { pin });
      await reveal;
      const next = await preload;
      expect(next.questionIndex).toBe(1);
      expect(next.media.audio.url).toBe('/api/v1/media/preload-test');
      expect(await remotePreload).toMatchObject({
        questionIndex: 1,
        media: { audio: { url: '/api/v1/media/preload-test' } },
        audioTarget: 'projection_remote',
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(playerPreloads).toBe(0); // in the room, nothing of a sound meant for the projection
    } finally {
      await prisma.quiz.delete({ where: { id: twoQuestions.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('offers remote play only when the quiz has sound, and tells the roster', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/presence-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 1000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const withSound = await prisma.quiz.create({
      data: {
        ownerId: hostUserId,
        title: 'Presence test',
        status: 'ready',
        questionCount: 1,
        questions: {
          create: {
            orderIndex: 0,
            type: 'poll',
            prompt: 'Which tune?',
            timeLimitS: 5,
            pointsMode: 'none',
            audioMediaId: asset.id,
            options: {
              create: [
                { orderIndex: 0, text: 'A', color: 'red', shape: 'triangle' },
                { orderIndex: 1, text: 'B', color: 'blue', shape: 'diamond' },
              ],
            },
          },
        },
      },
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const silent = await host.emitWithAck('host:create', { quizId });
      const loud = await host.emitWithAck('host:create', { quizId: withSound.id });

      const guest = connect();
      expect(await guest.emitWithAck('player:peek', { pin: silent.pin })).toEqual({
        hasSound: false,
      });
      expect(await guest.emitWithAck('player:peek', { pin: loud.pin })).toEqual({
        hasSound: true,
      });

      // Remote asked for a silent quiz: nothing to play, the player is in the room.
      const ignored = new Promise<{ presence?: string }>((resolve) =>
        host.once('player:joined', resolve),
      );
      await guest.emitWithAck('player:join', {
        pin: silent.pin,
        nickname: 'Ada',
        presence: 'remote',
      });
      expect((await ignored).presence).toBe('room');

      const remote = connect();
      const joined = new Promise<{ presence?: string }>((resolve) =>
        host.once('player:joined', resolve),
      );
      await remote.emitWithAck('player:join', {
        pin: loud.pin,
        nickname: 'Grace',
        presence: 'remote',
      });
      expect((await joined).presence).toBe('remote');

      // A console that attaches again reads it from the roster.
      const console2 = connect({ localUser: 'Animateur' });
      const roster = new Promise<{ players: { nickname: string; presence?: string }[] }>(
        (resolve) => console2.once('game:roster', resolve),
      );
      await console2.emitWithAck('host:attach', { pin: loud.pin });
      expect((await roster).players).toEqual([
        expect.objectContaining({ nickname: 'Grace', presence: 'remote' }),
      ]);
      host.emit('host:end', { pin: silent.pin });
      host.emit('host:end', { pin: loud.pin });
    } finally {
      await prisma.quiz.delete({ where: { id: withSound.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('lets the host pick who hears the sound in the lobby, and no longer once started', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/target-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 1000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const withSound = await prisma.quiz.create({
      data: {
        ownerId: hostUserId,
        title: 'Audio target test',
        status: 'ready',
        questionCount: 1,
        audioTarget: 'projection',
        questions: {
          create: {
            orderIndex: 0,
            type: 'poll',
            prompt: 'Which tune?',
            timeLimitS: 5,
            pointsMode: 'none',
            audioMediaId: asset.id,
            options: {
              create: [
                { orderIndex: 0, text: 'A', color: 'red', shape: 'triangle' },
                { orderIndex: 1, text: 'B', color: 'blue', shape: 'diamond' },
              ],
            },
          },
        },
      },
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: withSound.id });
      const screen = connect();
      const attached = new Promise<{ audioTarget: string }>((resolve) =>
        screen.once('game:media', resolve),
      );
      await screen.emitWithAck('spectator:join', { pin });
      expect((await attached).audioTarget).toBe('projection'); // the quiz's

      const changed = new Promise<{ audioTarget: string }>((resolve) =>
        screen.once('game:media', resolve),
      );
      host.emit('host:options', { pin, audioTarget: 'everyone' });
      expect((await changed).audioTarget).toBe('everyone');

      // Every device, the room's included, gets the sound meant for every device — from the lobby.
      const player = connect();
      const lobbyPreload = new Promise<{ questionIndex: number; media: { audio: unknown } }>(
        (resolve) => player.once('media:preload', (p) => resolve(p as never)),
      );
      await player.emitWithAck('player:join', { pin, nickname: 'Ada' });
      expect(await lobbyPreload).toMatchObject({
        questionIndex: 0,
        media: { audio: { url: '/api/v1/media/target-test' } },
      });
      const started = new Promise<{ audioTarget?: string }>((resolve) =>
        player.once('question:start', resolve),
      );
      host.emit('host:start', { pin });
      expect((await started).audioTarget).toBe('everyone');

      const refused = new Promise<{ code: string }>((resolve) => host.once('error', resolve));
      host.emit('host:options', { pin, audioTarget: 'projection' });
      expect((await refused).code).toBe('session.options_locked');
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: withSound.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('host:review shows a played question again (no replay), host:next resumes the live position', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Zoé' });

    const states: Array<{
      state: string;
      questionIndex: number;
      nav?: { review: boolean; prev: unknown; next: unknown };
    }> = [];
    player.on('game:state', (p) => states.push(p as never));
    const firstReveal = new Promise<void>((resolve) =>
      player.once('question:reveal', () => resolve()),
    );
    const podiumP = new Promise<void>((resolve) => player.once('game:podium', () => resolve()));
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.once('question:start', (q) => resolve(q as never)),
    );
    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    await firstReveal;
    host.emit('host:next', { pin });
    await podiumP;
    // At the podium the host may look back at question 1.
    expect(states.at(-1)).toMatchObject({
      state: 'PODIUM',
      nav: { review: false, prev: { questionIndex: 0 }, next: null },
    });

    // Review: the question comes back with its reveal and the player's archived result.
    const reviewStart = new Promise<{ questionIndex: number; endsAt: number }>((resolve) =>
      player.once('question:start', (p) => resolve(p as never)),
    );
    const reviewReveal = new Promise<{
      correctOptionIds?: string[];
      yourResult?: { correct: boolean };
    }>((resolve) => player.once('question:reveal', (r) => resolve(r as never)));
    host.emit('host:review', { pin, questionIndex: 0 });
    const rs = await reviewStart;
    expect(rs).toMatchObject({ questionIndex: 0, endsAt: 0 }); // chrono already over: nothing to answer
    const rr = await reviewReveal;
    expect(rr.correctOptionIds).toEqual([parisId]);
    expect(rr.yourResult?.correct).toBe(true);
    expect(states.at(-1)).toMatchObject({
      state: 'REVEAL',
      questionIndex: 0,
      nav: { review: true, prev: null, next: null },
    });

    // Answering again is refused: the question is not live.
    const ackP = new Promise<{ accepted: boolean }>((resolve) =>
      player.once('answer:ack', (a) => resolve(a as never)),
    );
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    expect((await ackP).accepted).toBe(false);

    // Next resumes the live position (podium), the same for every screen.
    const back = new Promise<void>((resolve) => player.once('game:podium', () => resolve()));
    host.emit('host:next', { pin });
    await back;
    expect(states.at(-1)).toMatchObject({ state: 'PODIUM', nav: { review: false } });
  }, 15_000);

  it('live form refresh: an explanation edited during the session shows on the next step, the substance stays frozen', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Max' });
    const firstReveal = new Promise<void>((resolve) =>
      player.once('question:reveal', () => resolve()),
    );
    const podiumP = new Promise<void>((resolve) => player.once('game:podium', () => resolve()));
    host.emit('host:start', { pin });
    await firstReveal;
    host.emit('host:next', { pin });
    await podiumP;

    // The host edits the question while the session runs: form and substance alike.
    const question = await prisma.question.findFirstOrThrow({ where: { quizId } });
    await prisma.question.update({
      where: { id: question.id },
      data: { answerExplanation: 'Edited live.', prompt: 'Edited prompt?', timeLimitS: 60 },
    });
    try {
      const reviewStart = new Promise<{ prompt: string; timeLimitS: number }>((resolve) =>
        player.once('question:start', (p) => resolve(p as never)),
      );
      const reviewReveal = new Promise<{ answerExplanation?: string }>((resolve) =>
        player.once('question:reveal', (r) => resolve(r as never)),
      );
      host.emit('host:review', { pin, questionIndex: 0 });
      const start = await reviewStart;
      expect(start).toMatchObject({ prompt: 'Capitale de la France ?', timeLimitS: 5 }); // frozen
      expect((await reviewReveal).answerExplanation).toBe('Edited live.'); // followed
    } finally {
      await prisma.question.update({
        where: { id: question.id },
        data: {
          answerExplanation: 'Paris est la **capitale**.',
          prompt: 'Capitale de la France ?',
          timeLimitS: 5,
        },
      });
    }
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

  it('archivage (§2.7) : capture intégrale → host:end{archive} persiste les tables, idempotent', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId, fullCapture: true });
    const player = connect();

    // Consentement : le joueur reçoit l'avis « réponses conservées » au join (§2.10).
    const noticeP = new Promise<{ fullCapture: boolean }>((resolve) =>
      player.on('notice', (n) => resolve(n as never)),
    );
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );
    const revealP = new Promise((resolve) => player.on('question:reveal', resolve));
    await player.emitWithAck('player:join', { pin, nickname: 'Zoe' });
    expect((await noticeP).fullCapture).toBe(true);

    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    await revealP;

    const ended = new Promise((resolve) => player.on('game:ended', resolve));
    host.emit('host:end', { pin, archive: true });
    await ended;

    // Ré-entrée : un second host:end ne doit pas créer un 2ᵉ enregistrement (garde d'état).
    host.emit('host:end', { pin, archive: true });
    await new Promise((r) => setTimeout(r, 300));

    const sessions = await prisma.gameSessionLog.findMany({
      where: { quizId },
      include: { playerResults: true, questionStats: true, answerLogs: true },
    });
    expect(sessions).toHaveLength(1); // idempotent malgré le double host:end
    const s = sessions[0];
    expect(s.status).toBe('ended');
    expect(s.playerCount).toBe(1);
    expect(s.fullCapture).toBe(true);
    expect(Number(s.successRate)).toBeCloseTo(1);

    expect(s.playerResults).toHaveLength(1);
    expect(s.playerResults[0]).toMatchObject({
      nickname: 'Zoe',
      finalRank: 1,
      correctCount: 1,
      answeredCount: 1,
    });

    expect(s.questionStats).toHaveLength(1);
    expect(s.questionStats[0]).toMatchObject({ orderIndex: 0, correctCount: 1, answerCount: 1 });
    expect((s.questionStats[0].distribution as Record<string, number>)[parisId]).toBe(1);

    // Capture intégrale : la réponse individuelle est conservée.
    expect(s.answerLogs).toHaveLength(1);
    expect(s.answerLogs[0]).toMatchObject({ orderIndex: 0, isCorrect: true, answerValue: parisId });

    // API de consultation (Phase 2) contre la vraie base : liste + détail owner-only.
    const quizzes = app.get(QuizzesService);
    const list = await quizzes.sessions(asHost(hostUserId), quizId);
    expect(list.sessions.find((x) => x.id === s.id)).toMatchObject({
      playerCount: 1,
      successRate: 1,
      status: 'ended',
    });
    const detail = await quizzes.sessionDetail(asHost(hostUserId), quizId, s.id);
    expect(detail.quizTitle).toBe('Quiz live test');
    expect(detail.questions[0]).toMatchObject({
      prompt: 'Capitale de la France ?',
      successRate: 1,
    });
    expect(detail.players[0]).toMatchObject({ nickname: 'Zoe', finalRank: 1 });
    // Drill-down participant (Phase 3) : réponse rendue lisible depuis le snapshot.
    const playerDetail = await quizzes.sessionPlayerDetail(
      asHost(hostUserId),
      quizId,
      s.id,
      detail.players[0].id,
    );
    expect(playerDetail.fullCapture).toBe(true);
    expect(playerDetail.answers[0]).toMatchObject({ answer: 'Paris', isCorrect: true });
    // Isolation : un autre propriétaire ne voit pas la session.
    await expect(quizzes.sessionDetail(asHost('someone-else'), quizId, s.id)).rejects.toThrow();

    // Nettoyage (cascade) pour ne pas bloquer la suppression du quiz en afterAll.
    await prisma.gameSessionLog.deleteMany({ where: { quizId } });
  }, 15_000);

  it('host:adjust-time : +5 s repousse `endsAt` et diffuse `question:time`', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Tina' });

    const qStart = new Promise<{ questionIndex: number; endsAt: number }>((resolve) =>
      player.on('question:start', (q) => resolve(q as never)),
    );
    const timeP = new Promise<{ questionIndex: number; startedAt: number; endsAt: number }>(
      (resolve) => player.on('question:time', (t) => resolve(t as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;

    host.emit('host:adjust-time', { pin, deltaS: 5 });
    const t = await timeP;
    expect(t.questionIndex).toBe(0);
    expect(t.endsAt - q.endsAt).toBe(5000); // +5 s pile
  }, 15_000);

  it('host:pause gèle le chrono (game:mode + remainingMs) puis reprend (question:time)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Ugo' });

    const qStart = new Promise<{ startedAt: number }>((resolve) =>
      player.on('question:start', (q) => resolve(q as never)),
    );
    host.emit('host:start', { pin });
    const q = await qStart;
    // Attendre l'ouverture des réponses pour que du temps se soit écoulé.
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    const pausedP = new Promise<{ paused: boolean; remainingMs?: number }>((resolve) =>
      player.on('game:mode', (m) => (m as { paused: boolean }).paused && resolve(m as never)),
    );
    host.emit('host:pause', { pin, paused: true });
    const paused = await pausedP;
    expect(paused.paused).toBe(true);
    expect(paused.remainingMs).toBeGreaterThan(0);
    expect(paused.remainingMs).toBeLessThanOrEqual(5000);

    const timeP = new Promise<{ endsAt: number }>((resolve) =>
      player.on('question:time', (t) => resolve(t as never)),
    );
    host.emit('host:pause', { pin, paused: false });
    const t = await timeP;
    expect(t.endsAt).toBeGreaterThan(Date.now()); // chrono relancé dans le futur
  }, 15_000);

  it('mode auto : après le reveal, enchaîne seul (host:next implicite) → podium', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    host.emit('host:mode', { pin, mode: 'auto' });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Vic' });

    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );
    // Le podium doit arriver SANS que l'on émette host:next (enchaînement auto §8).
    const podiumP = new Promise<{ you?: { rank: number } }>((resolve) =>
      player.on('game:podium', (p) => resolve(p as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId }); // → REVEAL 'all'

    const podium = await podiumP; // auto-next (≈300 ms) enchaîne vers le podium
    expect(podium.you?.rank).toBe(1);
  }, 15_000);

  it('auto mode: a per-question revealDelayS overrides the default auto-next delay (#6)', async () => {
    // Same quiz shape, but the question asks for a 1 s reveal (default in test is 300 ms).
    const quiz = await prisma.quiz.create({
      data: {
        ownerId: hostUserId,
        title: 'Quiz reveal delay',
        status: 'ready',
        questionCount: 1,
        questions: {
          create: {
            orderIndex: 0,
            type: 'single_choice',
            prompt: 'Capitale ?',
            timeLimitS: 5,
            revealDelayS: 1,
            options: {
              create: [
                { orderIndex: 0, text: 'Paris', color: 'red', shape: 'triangle', isCorrect: true },
                { orderIndex: 1, text: 'Lyon', color: 'blue', shape: 'diamond', isCorrect: false },
              ],
            },
          },
        },
      },
    });
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId: quiz.id });
    host.emit('host:mode', { pin, mode: 'auto' });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Wes' });

    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );
    const modeP = new Promise<{ autoNextMs?: number }>((resolve) =>
      host.on('game:mode', (m) => (m as { autoNextAt?: number }).autoNextAt && resolve(m as never)),
    );
    const podiumP = new Promise<void>((resolve) => player.on('game:podium', () => resolve()));

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    const revealedAt = Date.now();
    player.emit('player:submit', { pin, questionIndex: 0, answer: q.options[0].id });

    expect((await modeP).autoNextMs).toBe(1000);
    await podiumP;
    expect(Date.now() - revealedAt).toBeGreaterThanOrEqual(1000);
  }, 15_000);

  it('slides (#7): manual mode = host clicks through; auto mode honours displayDelayS (1 s closing slide)', async () => {
    const quiz = await prisma.quiz.create({
      data: {
        ownerId: hostUserId,
        title: 'Quiz with slides',
        status: 'ready',
        questionCount: 1,
        questions: {
          create: {
            orderIndex: 0,
            type: 'single_choice',
            prompt: 'Capitale ?',
            timeLimitS: 5,
            options: {
              create: [
                { orderIndex: 0, text: 'Paris', color: 'red', shape: 'triangle', isCorrect: true },
                { orderIndex: 1, text: 'Lyon', color: 'blue', shape: 'diamond', isCorrect: false },
              ],
            },
          },
        },
      },
      include: { questions: true },
    });
    await prisma.slide.createMany({
      data: [
        {
          quizId: quiz.id,
          beforeQuestionId: quiz.questions[0].id,
          orderIndex: 0,
          blocks: [
            { type: 'heading', id: 'h', text: 'Welcome', level: 1 },
            { type: 'text', id: 't', md: 'Read **this** first.' },
          ],
        },
        {
          quizId: quiz.id,
          beforeQuestionId: null,
          orderIndex: 0,
          blocks: [{ type: 'heading', id: 'h', text: 'Bye', level: 1 }],
          displayDelayS: 1,
        },
      ],
    });

    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId: quiz.id });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Zed' });

    const states: string[] = [];
    player.on('game:state', (s: { state: string }) => states.push(s.state));
    const slides: Array<{
      slideIndex: number;
      blocks: Array<{ text?: string }>;
      questionIndex: number;
    }> = [];
    player.on('slide:show', (s) => slides.push(s as never));
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string }> }>((resolve) =>
      player.on('question:start', (q) => resolve(q as never)),
    );
    const podiumP = new Promise<void>((resolve) => player.on('game:podium', () => resolve()));

    // Start shows the intro slide, not the question.
    host.emit('host:start', { pin });
    await new Promise((r) => setTimeout(r, 200));
    expect(states).toEqual(['SLIDE_SHOW']);
    expect(slides).toEqual(
      [{ slideIndex: 0, questionIndex: 0 }].map((s) => expect.objectContaining(s)),
    );
    expect(slides[0].blocks[0]).toMatchObject({ type: 'heading', text: 'Welcome' });

    // Manual mode: nothing advances by itself, the host moves on.
    host.emit('host:next', { pin });
    const q = await qStart;
    expect(states).toEqual(['SLIDE_SHOW', 'ANSWERING']);
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: q.options[0].id }); // → REVEAL
    await new Promise((r) => setTimeout(r, 200));

    // Auto mode from here: host:next shows the closing slide, whose 1 s delay then fires alone.
    host.emit('host:mode', { pin, mode: 'auto' });
    await new Promise((r) => setTimeout(r, 100));
    host.emit('host:next', { pin });
    await new Promise((r) => setTimeout(r, 200));
    expect(states.at(-1)).toBe('SLIDE_SHOW');
    expect(slides.at(-1)).toEqual(expect.objectContaining({ slideIndex: 1, questionIndex: 1 }));
    const shownAt = Date.now();
    await podiumP;
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(700);
  }, 15_000);

  it('REVEAL anticipé quand TOUS répondent FAUX (convergence indépendante de la justesse)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const p1 = connect();
    const p2 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Zoe' });
    await p2.emitWithAck('player:join', { pin, nickname: 'Yann' });

    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => p1.on('question:start', (q) => resolve(q as never)),
    );
    // Le REVEAL ne doit PAS attendre le timer (5 s) : il converge dès que les 2 ont répondu.
    const revealP = new Promise<void>((resolve) =>
      p1.on('game:state', (s) => {
        if ((s as { state: string }).state === 'REVEAL') resolve();
      }),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    const lyonId = q.options.find((o) => o.text === 'Lyon')!.id; // mauvaise réponse pour tous
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    p1.emit('player:submit', { pin, questionIndex: 0, answer: lyonId });
    p2.emit('player:submit', { pin, questionIndex: 0, answer: lyonId });

    // Doit révéler car les 2 connectés ont répondu — peu importe que ce soit faux.
    await revealP;
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

  it('player:rate : avis de fin de partie persisté (note + commentaire), refusé en lobby', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Wendy' });

    // En LOBBY : la partie n'est pas terminée → refus.
    const early = await player.emitWithAck('player:rate', { pin, rating: 5 });
    expect(early.ok).toBe(false);

    // On termine la partie, puis on note.
    host.emit('host:start', { pin });
    await new Promise((r) => setTimeout(r, 300));
    host.emit('host:end', { pin });
    await new Promise((r) => setTimeout(r, 200));

    const ack = await player.emitWithAck('player:rate', {
      pin,
      rating: 4,
      comment: '  Super quiz  ',
    });
    expect(ack.ok).toBe(true);

    const row = await prisma.quizFeedback.findFirst({ where: { pin } });
    expect(row?.rating).toBe(4);
    expect(row?.comment).toBe('Super quiz'); // élagué
    expect(row?.nickname).toBe('Wendy');
  }, 15_000);

  it('late join (§5) : un joueur arrivé après le départ reçoit l’état ANSWERING + question:start', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    host.emit('host:start', { pin });
    await new Promise((r) => setTimeout(r, 250)); // laisse passer la fenêtre de lecture (150 ms)

    const latecomer = connect();
    const stateP = new Promise<{ state: string }>((resolve) =>
      latecomer.on('game:state', (s) => resolve(s as never)),
    );
    const qStartP = new Promise<{ questionIndex: number }>((resolve) =>
      latecomer.on('question:start', (q) => resolve(q as never)),
    );

    const ack = await latecomer.emitWithAck('player:join', { pin, nickname: 'Late' });
    expect(ack.playerId).toBeTruthy();
    expect((await stateP).state).toBe('ANSWERING');
    expect((await qStartP).questionIndex).toBe(0);
  }, 15_000);

  it('spectator:join (§3) : reçoit l’état mais n’est pas compté (answer:count.total)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Frank' });

    const spectator = connect();
    // Le projeté qui s'attache après les arrivées reçoit l'instantané du lobby (§6).
    const rosterP = new Promise<{ players: Array<{ nickname: string }> }>((resolve) =>
      spectator.on('game:roster', (r) => resolve(r as never)),
    );
    const specOk = await spectator.emitWithAck('spectator:join', { pin });
    expect(specOk.ok).toBe(true);
    expect((await rosterP).players.map((p) => p.nickname)).toContain('Frank');

    const countP = new Promise<{ answered: number; total: number }>((resolve) =>
      player.on('answer:count', (c) => resolve(c as never)),
    );
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });

    // total = connectés joueurs (1), le spectateur n'est pas compté.
    const count = await countP;
    expect(count.total).toBe(1);
    expect(count.answered).toBe(1);
  }, 15_000);

  it('host:attach (§4.2) : le propriétaire se rebinde et reçoit l’état ; non authentifié rejeté', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    // 2ᵉ fenêtre de contrôle (même hôte) : attach OK + état courant.
    const control2 = connect({ localUser: 'Animateur' });
    const stateP = new Promise<{ state: string }>((resolve) =>
      control2.on('game:state', (s) => resolve(s as never)),
    );
    const attachAck = await control2.emitWithAck('host:attach', { pin });
    expect(attachAck.ok).toBe(true);
    expect((await stateP).state).toBe('LOBBY');

    // Socket non authentifié : refus (event error typé).
    const anon = connect();
    const err = await Promise.race([
      new Promise<{ code: string }>((resolve) => anon.on('error', resolve)),
      anon.emitWithAck('host:attach', { pin }).then(() => ({ code: 'accepted' as const })),
    ]);
    expect(err.code).not.toBe('accepted');
  }, 15_000);

  it('player:reconnect (§6.1) : restaure la place via le jeton et renvoie l’état', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const player = connect();
    const { sessionToken } = await player.emitWithAck('player:join', { pin, nickname: 'Gina' });
    player.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const back = connect();
    const stateP = new Promise<{ state: string }>((resolve) =>
      back.on('game:state', (s) => resolve(s as never)),
    );
    const ack = await back.emitWithAck('player:reconnect', { sessionToken });
    expect(ack.ok).toBe(true);
    expect((await stateP).state).toBe('LOBBY');
  }, 15_000);

  it('convergence sur les connectés (§8) : le départ du dernier non-répondant déclenche REVEAL', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const p1 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Hugo' });
    const p2 = connect();
    await p2.emitWithAck('player:join', { pin, nickname: 'Ines' });

    let revealed = false;
    p1.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealed = true;
    });
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => p1.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    // p1 répond (1/2). Pas encore de REVEAL : p2 connecté n'a pas répondu.
    p1.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(revealed).toBe(false);

    // p2 quitte → connectés=1, répondu=1 ⇒ convergence ⇒ REVEAL (sans attendre le timer 5 s).
    p2.disconnect();
    await new Promise((r) => setTimeout(r, 400));
    expect(revealed).toBe(true);
  }, 15_000);

  it('hôte déconnecté (§7) : grâce → HOST_DISCONNECTED → host:attach reprend ANSWERING', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Iris' });

    const states: string[] = [];
    player.on('game:state', (s: { state: string }) => states.push(s.state));
    const qStarts: Array<{ startedAt: number; endsAt: number }> = [];
    player.on('question:start', (q) => qStarts.push(q as never));

    host.emit('host:start', { pin });
    await new Promise<void>((resolve) => {
      const id = setInterval(() => qStarts.length >= 1 && (clearInterval(id), resolve()), 20);
    }); // ANSWERING ouvert

    // L'hôte se déconnecte : après la grâce (200 ms), passage en HOST_DISCONNECTED.
    const pausedP = new Promise<void>((resolve) => {
      const onState = (s: { state: string }) => {
        if (s.state === 'HOST_DISCONNECTED') {
          player.off('game:state', onState);
          resolve();
        }
      };
      player.on('game:state', onState);
    });
    host.disconnect();
    await pausedP;
    expect(states).toContain('HOST_DISCONNECTED');

    // L'hôte revient (nouvelle fenêtre de contrôle) → reprise en ANSWERING.
    const resumedP = new Promise<void>((resolve) => {
      const onState = (s: { state: string }) => {
        if (s.state === 'ANSWERING') {
          player.off('game:state', onState);
          resolve();
        }
      };
      player.on('game:state', onState);
    });
    const control2 = connect({ localUser: 'Animateur' });
    const attachAck = await control2.emitWithAck('host:attach', { pin });
    expect(attachAck.ok).toBe(true);
    await resumedP;

    // La reprise recalcule les timings sur le temps restant (§7.3) : la fenêtre
    // garde exactement la durée de la question (timeLimitS=5), que le gel ait
    // attrapé la réponse en cours ou le délai de lecture (`chrono.ts`), et elle
    // se termine dans le futur.
    const resumed = qStarts[qStarts.length - 1];
    expect(resumed.endsAt - resumed.startedAt).toBe(5_000);
    expect(resumed.endsAt).toBeGreaterThan(Date.now());
  }, 15_000);

  it('convergence (§8) : le départ de l’unique répondant ne révèle pas tant qu’un connecté attend', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const p1 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Kim' });
    const p2 = connect();
    await p2.emitWithAck('player:join', { pin, nickname: 'Léo' });

    let revealed = false;
    p2.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealed = true;
    });
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => p1.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    // p1 (le seul répondant) répond puis quitte. p2 reste connecté SANS avoir répondu :
    // sa réponse manquante doit empêcher le REVEAL (le bug naïf hlen≥connectés révélerait).
    p1.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });
    await new Promise((r) => setTimeout(r, 150));
    p1.disconnect();
    await new Promise((r) => setTimeout(r, 400));
    expect(revealed).toBe(false);
  }, 15_000);

  it('index parties en cours (§6.2) : présent après host:create, purgé après host:end', async () => {
    const games = app.get(GameService);
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const active = await games.listActiveHostGames(hostUserId);
    expect(active.some((g) => g.pin === pin)).toBe(true);

    host.emit('host:end', { pin });
    await new Promise((r) => setTimeout(r, 200));
    const after = await games.listActiveHostGames(hostUserId);
    expect(after.some((g) => g.pin === pin)).toBe(false);
  }, 15_000);

  it('hôte non revenu (§7.3) : la fenêtre expire → la partie se termine (game:ended)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Jude' });

    const endedP = new Promise<void>((resolve) => player.on('game:ended', () => resolve()));
    host.disconnect(); // jamais de host:attach → grâce + fenêtre expirent

    await endedP; // doit survenir avant le timeout (grâce 200 ms + fenêtre 1500 ms)
  }, 15_000);
});
