import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Socket } from 'socket.io-client';
import { type GameHarness, bootGameApp, nextEvent, settle } from '../../test/game-harness';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { RedisService } from '../redis/redis.service';
import { GRACE_MS } from './game.keys';
import { GameService } from './game.service';
import { PIN_ATTEMPTS_MAX } from './pin-attempts';

/**
 * Test d'INTÉGRATION : vraie connexion socket.io-client → gateway /game.
 * Requiert Postgres + Redis joignables (dev compose / services CI) ; la base est
 * `<db>_test`, créée par le global setup de Jest.
 * Couvre : ping/pong, host:create (PIN + snapshot) et player:join (lobby).
 */
/** L'appelant d'une lecture de quiz : un hôte ordinaire (RG-14). */
const asHost = (id: string) => ({ id, roles: [UserRole.host] });

describe('GameGateway (intégration socket)', () => {
  let h: GameHarness;
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let quizId: string;
  let hostUserId: string;
  const connect = (auth?: Record<string, string>): Socket => h.connect(auth);
  /** The next `game:state` of `socket` in `state`. */
  const stateEvent = (socket: Socket, state: string, timeoutMs?: number) =>
    nextEvent(socket, 'game:state', {
      where: (p: { state: string }) => p.state === state,
      timeoutMs,
    });
  /**
   * Brings a live question's timer closer, through the host's own control: the test
   * watches the same reveal timer expire without sitting through 5 s (the smallest
   * limit a question may have). The delta leaves about 1.5 s whatever the latency
   * so far: under 1 s left, the engine would reveal at once instead of re-arming.
   */
  const shortenTimer = async (host: Socket, pin: string, endsAt: number): Promise<number> => {
    const time = nextEvent<{ endsAt: number }>(host, 'question:time');
    const deltaS = -Math.floor((endsAt - Date.now() - 1_500) / 1_000);
    host.emit('host:adjust-time', { pin, deltaS });
    return (await time).endsAt;
  };

  beforeAll(async () => {
    h = await bootGameApp();
    ({ app, prisma, url, hostUserId } = h);
    quizId = (await h.seedQuiz({ description: 'Quiz de démonstration' })).id;
  }, 30_000);

  afterAll(() => h.close());

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

    // Le timer (endsAt + grace) déclenche le REVEAL, une seule fois.
    const reveal = nextEvent(player, 'game:state', {
      where: (s: { state: string }) => s.state === 'REVEAL',
    });
    await shortenTimer(host, pin, q.endsAt);
    await reveal;
    await settle();
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
    const qStart = nextEvent<{
      startedAt: number;
      endsAt: number;
      options: Array<{ id: string; text: string }>;
    }>(player, 'question:start');

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

    const endsAt = await shortenTimer(host, pin, q.endsAt);
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
    await settle(Math.max(0, endsAt + GRACE_MS - Date.now()));
    await settle();
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
    await settle();
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

  it("keeps the instance's media administration from a host (#54)", async () => {
    const res = await fetch(url.replace(/\/game$/, '/admin/media/overview'), {
      headers: { 'X-Local-User': 'Animateur' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: 'auth.admin_required' });
  });

  it('keeps an uploaded file name as the author typed it, accents and CJK included (#53)', async () => {
    // Through the real route: multer reads multipart file names as latin1.
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x23, 0x35]);
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'église-台北.png');
    const res = await fetch(url.replace(/\/game$/, '/media'), {
      method: 'POST',
      headers: { 'X-Local-User': 'Animateur' },
      body: form,
    });
    expect(res.status).toBe(201);
    const { mediaId } = (await res.json()) as { mediaId: string };
    try {
      const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
      expect(row.name).toBe('église-台北.png');
    } finally {
      await app.get(MediaService).remove(hostUserId, mediaId);
    }
  });

  it("shows the credits of the quiz's media at the podium (#53)", async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/credit-test',
        mime: 'image/webp',
        sizeBytes: 1n,
        kind: 'image',
        credit: 'Photo: Lin Wei, CC BY 4.0',
      },
    });
    const credited = await h.seedQuiz({
      title: 'Credits test',
      status: 'ready',
      questionCount: 1,
      questions: {
        create: {
          orderIndex: 0,
          type: 'poll',
          prompt: 'Q',
          timeLimitS: 5,
          pointsMode: 'none',
          visualMediaId: asset.id,
          options: {
            create: [
              { orderIndex: 0, text: 'A', color: 'red', shape: 'triangle' },
              { orderIndex: 1, text: 'B', color: 'blue', shape: 'diamond' },
            ],
          },
        },
      },
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: credited.id });
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const started = new Promise<void>((resolve) =>
        screen.once('question:start', () => resolve()),
      );
      const reveal = new Promise<void>((resolve) =>
        screen.once('question:reveal', () => resolve()),
      );
      const podium = new Promise<{ credits?: string[] }>((resolve) =>
        screen.once('game:podium', (p) => resolve(p as never)),
      );
      host.emit('host:start', { pin });
      await started;
      host.emit('host:reveal', { pin });
      await reveal;
      host.emit('host:next', { pin });
      expect((await podium).credits).toEqual(['Photo: Lin Wei, CC BY 4.0']);
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: credited.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
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
    const twoQuestions = await h.seedQuiz({
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
      await settle();
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
    const withSound = await h.seedQuiz({
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
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const silent = await host.emitWithAck('host:create', { quizId });
      const loud = await host.emitWithAck('host:create', { quizId: withSound.id });

      const guest = connect();
      expect(await guest.emitWithAck('player:peek', { pin: silent.pin })).toEqual({
        hasSound: false,
        participantAccess: 'account',
      });
      expect(await guest.emitWithAck('player:peek', { pin: loud.pin })).toEqual({
        hasSound: true,
        participantAccess: 'account',
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
    const withSound = await h.seedQuiz({
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

  it('counts who has loaded the first question’s sound in the lobby: the projection and remote participants', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/ready-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 1000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const withSound = await h.seedQuiz({
      title: 'Readiness test',
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
    });
    type Readiness = {
      ready: number;
      total: number;
      players: { playerId: string; ready: boolean }[];
      screens: { ready: number; total: number };
    };
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: withSound.id });
      let last: Readiness | null = null;
      host.on('media:readiness', (p: Readiness) => (last = p));
      const until = async (check: (r: Readiness) => boolean) => {
        for (let i = 0; i < 50 && !(last && check(last)); i++) {
          await new Promise((r) => setTimeout(r, 40));
        }
        return last as unknown as Readiness;
      };

      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const room = connect();
      await room.emitWithAck('player:join', { pin, nickname: 'Ada' });
      const remote = connect();
      const { playerId } = await remote.emitWithAck('player:join', {
        pin,
        nickname: 'Grace',
        presence: 'remote',
      });
      // The projection and the remote phone are waited for; the phone in the room is not.
      let r = await until((x) => x.total === 2);
      expect(r).toMatchObject({ ready: 0, total: 2, screens: { ready: 0, total: 1 } });
      expect(r.players).toEqual([{ playerId, ready: false }]);

      screen.emit('media:ready', { pin, questionIndex: 0 });
      r = await until((x) => x.ready === 1);
      expect(r.screens).toEqual({ ready: 1, total: 1 });
      remote.emit('media:ready', { pin, questionIndex: 0 });
      r = await until((x) => x.ready === 2);
      expect(r.players).toEqual([{ playerId, ready: true }]);

      // A socket of another game cannot mark this one.
      const stranger = connect();
      stranger.emit('media:ready', { pin, questionIndex: 0 });
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: withSound.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('relays the projection’s position in the sound to the room, and nobody else’s', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const screen = connect();
    await screen.emitWithAck('spectator:join', { pin });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Ada' });
    const heard: unknown[] = [];
    host.on('media:position', (p) => heard.push(p));
    const atPlayer = new Promise((resolve) => player.once('media:position', resolve));

    player.emit('media:position', { pin, questionIndex: 0, t: 9, playing: true }); // ignored
    screen.emit('media:position', { pin, questionIndex: 0, t: 1.5, playing: true });
    expect(await atPlayer).toEqual({ questionIndex: 0, t: 1.5, playing: true });
    await settle();
    expect(heard).toEqual([{ questionIndex: 0, t: 1.5, playing: true }]);
    host.emit('host:end', { pin });
  }, 15_000);

  it('waits for the devices that play the sound before opening the question: until ready, the cap, or the host', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/wait-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 1000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const withSound = await h.seedQuiz({
      title: 'Media wait test',
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
    });
    const game = async () => {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: withSound.id });
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const states: string[] = [];
      host.on('game:state', (p: { state: string }) => states.push(p.state));
      const answering = new Promise<number>((resolve) =>
        host.on('game:state', (p: { state: string }) => {
          if (p.state === 'ANSWERING') resolve(Date.now());
        }),
      );
      return { host, pin, screen, states, answering };
    };
    try {
      // Ready before the start: no wait at all.
      const ready = await game();
      ready.screen.emit('media:ready', { pin: ready.pin, questionIndex: 0 });
      await new Promise((r) => setTimeout(r, 150));
      ready.host.emit('host:start', { pin: ready.pin });
      await ready.answering;
      expect(ready.states).not.toContain('MEDIA_LOADING');
      ready.host.emit('host:end', { pin: ready.pin });

      // Not ready: the room waits, and goes as soon as the projection is.
      const late = await game();
      const wait = new Promise<{ questionIndex: number; until: number }>((resolve) =>
        late.screen.once('media:wait', resolve),
      );
      late.host.emit('host:start', { pin: late.pin });
      expect((await wait).questionIndex).toBe(0);
      expect(late.states).toContain('MEDIA_LOADING');
      late.screen.emit('media:ready', { pin: late.pin, questionIndex: 0 });
      await late.answering;
      late.host.emit('host:end', { pin: late.pin });

      // Never ready: the host starts anyway…
      const forced = await game();
      const forcedWait = new Promise((resolve) => forced.screen.once('media:wait', resolve));
      forced.host.emit('host:start', { pin: forced.pin });
      await forcedWait;
      const asked = Date.now();
      forced.host.emit('host:next', { pin: forced.pin });
      expect((await forced.answering) - asked).toBeLessThan(800);
      forced.host.emit('host:end', { pin: forced.pin });

      // …or the cap does it (1 s here).
      const capped = await game();
      const started = Date.now();
      capped.host.emit('host:start', { pin: capped.pin });
      expect((await capped.answering) - started).toBeGreaterThanOrEqual(900);
      capped.host.emit('host:end', { pin: capped.pin });
    } finally {
      await prisma.quiz.delete({ where: { id: withSound.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 20_000);

  it('gives a question with sound one start instant for every device, moved by a pause', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/start-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 4000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const withSound = await h.seedQuiz({
      title: 'Media start test',
      status: 'ready',
      questionCount: 1,
      questions: {
        create: {
          orderIndex: 0,
          type: 'poll',
          prompt: 'Which tune?',
          timeLimitS: 20,
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
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: withSound.id });
      const player = connect();
      await player.emitWithAck('player:join', { pin, nickname: 'Ada' }); // in the room: not waited for
      const q = new Promise<{ startedAt: number; mediaStartAt?: number }>((resolve) =>
        player.once('question:start', resolve),
      );
      const sent = Date.now();
      host.emit('host:start', { pin }); // no projection open: nobody to wait for
      const start = await q;
      // The pause below lands once the answers are open, the media playing.
      await settle(Math.max(0, start.startedAt - Date.now()) + 50);
      expect(start.mediaStartAt).toBeGreaterThanOrEqual(sent + 500);
      const lead = start.startedAt - start.mediaStartAt!;

      // A pause and a resume move the start with the chrono, at the same distance.
      host.emit('host:pause', { pin, paused: true });
      await new Promise((r) => setTimeout(r, 300));
      const time = new Promise<{ startedAt: number; mediaStartAt?: number }>((resolve) =>
        player.once('question:time', resolve),
      );
      host.emit('host:pause', { pin, paused: false });
      const moved = await time;
      expect(moved.startedAt - moved.mediaStartAt!).toBe(lead);
      expect(moved.mediaStartAt! - start.mediaStartAt!).toBeGreaterThanOrEqual(250);
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: withSound.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('listen first: the answers open when the media ends, not before', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/listen-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 2000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const quiz = await h.seedQuiz({
      title: 'Listen first test',
      status: 'ready',
      questionCount: 1,
      questions: {
        create: {
          orderIndex: 0,
          type: 'single_choice',
          prompt: 'Which tune?',
          timeLimitS: 5,
          audioMediaId: asset.id,
          timerAfterMedia: true,
          options: {
            create: [
              { orderIndex: 0, text: 'A', color: 'red', shape: 'triangle', isCorrect: true },
              { orderIndex: 1, text: 'B', color: 'blue', shape: 'diamond' },
            ],
          },
        },
      },
    });
    try {
      const host = connect({ localUser: 'Animateur' });
      const { pin } = await host.emitWithAck('host:create', { quizId: quiz.id });
      const player = connect();
      await player.emitWithAck('player:join', { pin, nickname: 'Ada' });
      const q = new Promise<{
        startedAt: number;
        endsAt: number;
        mediaStartAt?: number;
        listenFirst?: boolean;
        options: { id: string }[];
      }>((resolve) => player.once('question:start', resolve));
      host.emit('host:start', { pin });
      const start = await q;
      expect(start.listenFirst).toBe(true);
      // The sound plays 2 s, then the 5 s of answering — no stretch on top.
      expect(start.startedAt - start.mediaStartAt!).toBe(2000);
      expect(start.endsAt - start.startedAt).toBe(5000);

      // An answer while the sound still plays is refused.
      const early = new Promise<{ accepted: boolean }>((resolve) =>
        player.once('answer:ack', resolve),
      );
      player.emit('player:submit', { pin, questionIndex: 0, answer: start.options[0].id });
      expect((await early).accepted).toBe(false);
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: quiz.id } });
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
    const started = nextEvent<{ endsAt: number }>(player, 'question:start');
    host.emit('host:start', { pin });
    await shortenTimer(host, pin, (await started).endsAt);
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
    await settle(300);

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
    const quiz = await h.seedQuiz({
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
    });
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId: quiz.id });
    host.emit('host:mode', { pin, mode: 'auto' });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Wes' });

    const qStart = nextEvent<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      player,
      'question:start',
    );
    const modeP = nextEvent<{ autoNextAt?: number; autoNextMs?: number }>(host, 'game:mode', {
      where: (m) => Boolean(m.autoNextAt),
    });
    const podiumP = nextEvent(player, 'game:podium').then(() => Date.now());

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: q.options[0].id }); // → REVEAL

    const mode = await modeP;
    expect(mode.autoNextMs).toBe(1000);
    // Measured against the server's own schedule, not the client's submit instant: the
    // server arms the timer from its reveal, and a Node timer may fire a millisecond early.
    const podiumAt = await podiumP;
    expect(podiumAt).toBeGreaterThanOrEqual((mode.autoNextAt ?? 0) - 20);
  }, 15_000);

  it('slides (#7): manual mode = host clicks through; auto mode honours displayDelayS (1 s closing slide)', async () => {
    const quiz = await h.seedQuiz({
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
    const intro = Promise.all([stateEvent(player, 'SLIDE_SHOW'), nextEvent(player, 'slide:show')]);
    host.emit('host:start', { pin });
    await intro;
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
    const revealed = stateEvent(player, 'REVEAL', 1_000); // well before the 5 s timer
    player.emit('player:submit', { pin, questionIndex: 0, answer: q.options[0].id }); // → REVEAL
    await revealed;

    // Auto mode from here: host:next shows the closing slide, whose 1 s delay then fires alone.
    const auto = nextEvent(host, 'game:mode', {
      where: (m: { mode: string }) => m.mode === 'auto',
    });
    host.emit('host:mode', { pin, mode: 'auto' });
    await auto;
    const closing = Promise.all([
      stateEvent(player, 'SLIDE_SHOW'),
      nextEvent(player, 'slide:show', {
        where: (sl: { slideIndex: number }) => sl.slideIndex === 1,
      }),
    ]);
    host.emit('host:next', { pin });
    await closing;
    expect(states.at(-1)).toBe('SLIDE_SHOW');
    expect(slides.at(-1)).toEqual(expect.objectContaining({ slideIndex: 1, questionIndex: 1 }));
    const shownAt = Date.now(); // the slide's arrival (it used to be taken ~200 ms later, with 700)
    await podiumP;
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(900);
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
    const answering = stateEvent(player, 'ANSWERING');
    host.emit('host:start', { pin });
    await answering;
    const ended = nextEvent(player, 'game:ended');
    host.emit('host:end', { pin });
    await ended;

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

    const answering = stateEvent(host, 'ANSWERING');
    host.emit('host:start', { pin });
    await answering;

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
    await settle();
    expect(revealed).toBe(false);

    // p2 quitte → connectés=1, répondu=1 ⇒ convergence ⇒ REVEAL (sans attendre le timer 5 s).
    const reveal = stateEvent(p1, 'REVEAL', 1_000); // well before the 5 s timer
    p2.disconnect();
    await reveal;
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
    const acked = nextEvent(p1, 'answer:ack');
    p1.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });
    await acked;
    p1.disconnect();
    await settle(400);
    expect(revealed).toBe(false);
  }, 15_000);

  it('index parties en cours (§6.2) : présent après host:create, purgé après host:end', async () => {
    const games = app.get(GameService);
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const active = await games.listActiveHostGames(hostUserId);
    expect(active.some((g) => g.pin === pin)).toBe(true);

    const ended = nextEvent(host, 'game:ended'); // sent once the index is purged
    host.emit('host:end', { pin });
    await ended;
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

    await endedP; // doit survenir avant le timeout (grâce 200 ms + fenêtre 800 ms)
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
});
