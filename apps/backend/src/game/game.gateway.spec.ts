import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Socket, io } from 'socket.io-client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { GameService } from './game.service';

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
  let hostUserId: string;
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
    process.env.GAME_HOST_GRACE_MS = '200'; // grâce hôte courte (§7.1)
    process.env.GAME_HOST_WINDOW_MS = '1500'; // fenêtre de reconnexion hôte courte (§7.3)
    process.env.GAME_AUTO_ADVANCE_MS = '300'; // enchaînement auto rapide (§8) en test
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
    hostUserId = host.id;
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
    expect(err.code).toBe('nickname.taken');
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

  it('player:submit : accepté + scoré, doublon rejeté, REVEAL une seule fois (all + timer)', async () => {
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Eve' });

    const revealP = new Promise<{
      correctOptionIds?: string[];
      yourResult?: { correct: boolean; points: number; totalScore: number; rank: number };
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
    expect(reveal.yourResult?.correct).toBe(true);
    expect(reveal.yourResult?.points).toBeGreaterThan(0);
    expect(reveal.yourResult?.rank).toBe(1);

    host.emit('host:next', { pin }); // dernière question → podium
    const podium = await podiumP;
    expect(podium.you?.rank).toBe(1);
    expect(podium.you?.score).toBeGreaterThan(0);
  }, 15_000);

  it('archivage (§2.7) : capture intégrale → host:end{archive} persiste les tables, idempotent', async () => {
    const host = connect({ localUser: 'Formateur' });
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
    const list = await quizzes.sessions(hostUserId, quizId);
    expect(list.sessions.find((x) => x.id === s.id)).toMatchObject({
      playerCount: 1,
      successRate: 1,
      status: 'ended',
    });
    const detail = await quizzes.sessionDetail(hostUserId, quizId, s.id);
    expect(detail.quizTitle).toBe('Quiz live test');
    expect(detail.questions[0]).toMatchObject({
      prompt: 'Capitale de la France ?',
      successRate: 1,
    });
    expect(detail.players[0]).toMatchObject({ nickname: 'Zoe', finalRank: 1 });
    // Drill-down participant (Phase 3) : réponse rendue lisible depuis le snapshot.
    const playerDetail = await quizzes.sessionPlayerDetail(
      hostUserId,
      quizId,
      s.id,
      detail.players[0].id,
    );
    expect(playerDetail.fullCapture).toBe(true);
    expect(playerDetail.answers[0]).toMatchObject({ answer: 'Paris', isCorrect: true });
    // Isolation : un autre propriétaire ne voit pas la session.
    await expect(quizzes.sessionDetail('someone-else', quizId, s.id)).rejects.toThrow();

    // Nettoyage (cascade) pour ne pas bloquer la suppression du quiz en afterAll.
    await prisma.gameSessionLog.deleteMany({ where: { quizId } });
  }, 15_000);

  it('host:adjust-time : +5 s repousse `endsAt` et diffuse `question:time`', async () => {
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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

  it('REVEAL anticipé quand TOUS répondent FAUX (convergence indépendante de la justesse)', async () => {
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    // 2ᵉ fenêtre de contrôle (même hôte) : attach OK + état courant.
    const control2 = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
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
    const control2 = connect({ localUser: 'Formateur' });
    const attachAck = await control2.emitWithAck('host:attach', { pin });
    expect(attachAck.ok).toBe(true);
    await resumedP;

    // La reprise recalcule les timings sur le temps restant (§7.3) : la fenêtre
    // garde sa durée (timeLimitS=5 → 5000 ms) et se termine dans le futur.
    const resumed = qStarts[qStarts.length - 1];
    expect(resumed.endsAt - resumed.startedAt).toBeGreaterThanOrEqual(4500);
    expect(resumed.endsAt - resumed.startedAt).toBeLessThanOrEqual(5500);
    expect(resumed.endsAt).toBeGreaterThan(Date.now());
  }, 15_000);

  it('convergence (§8) : le départ de l’unique répondant ne révèle pas tant qu’un connecté attend', async () => {
    const host = connect({ localUser: 'Formateur' });
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
    const host = connect({ localUser: 'Formateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const active = await games.listActiveHostGames(hostUserId);
    expect(active.some((g) => g.pin === pin)).toBe(true);

    host.emit('host:end', { pin });
    await new Promise((r) => setTimeout(r, 200));
    const after = await games.listActiveHostGames(hostUserId);
    expect(after.some((g) => g.pin === pin)).toBe(false);
  }, 15_000);

  it('hôte non revenu (§7.3) : la fenêtre expire → la partie se termine (game:ended)', async () => {
    const host = connect({ localUser: 'Formateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Jude' });

    const endedP = new Promise<void>((resolve) => player.on('game:ended', () => resolve()));
    host.disconnect(); // jamais de host:attach → grâce + fenêtre expirent

    await endedP; // doit survenir avant le timeout (grâce 200 ms + fenêtre 1500 ms)
  }, 15_000);
});
