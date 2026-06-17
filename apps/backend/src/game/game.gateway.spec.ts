import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Socket, io } from 'socket.io-client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Test d'INTÉGRATION : vraie connexion socket.io-client → gateway /game.
 * Requiert Postgres + Redis joignables (dev compose / services CI).
 * Couvre : ping/pong, host:create (PIN + snapshot) et player:join (lobby).
 */
describe('GameGateway (intégration socket)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let quizId: string;
  const sockets: Socket[] = [];

  const connect = (auth?: Record<string, string>): Socket => {
    const socket = io(url, { transports: ['websocket'], auth, forceNew: true });
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://roux:roux@localhost:15432/rouxquizz?schema=public';
    process.env.REDIS_URL ??= 'redis://localhost:16379';
    process.env.GAME_READ_DELAY_MS = '150'; // accélère la fenêtre de lecture en test
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    prisma = app.get(PrismaService);

    // Seed : un hôte dont l'oidcSubject == slug local ('local:formateur'),
    // propriétaire d'un quiz « ready » avec une question valide.
    const host = await prisma.user.upsert({
      where: { oidcSubject: 'local:formateur' },
      create: { oidcSubject: 'local:formateur', displayName: 'Formateur', role: 'host' },
      update: {},
    });
    const quiz = await prisma.quiz.create({
      data: {
        ownerId: host.id,
        title: 'Quiz live test',
        status: 'ready',
        questionCount: 1,
        questions: {
          create: {
            orderIndex: 0,
            type: 'single_choice',
            prompt: 'Capitale de la France ?',
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    expect(err.code).toBe('conflict');
  }, 15_000);

  it('host:start → question:start (allowlist, sans flag correct) puis REVEAL une seule fois', async () => {
    const host = connect({ localUser: 'Formateur' });
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
});
