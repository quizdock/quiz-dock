import type { INestApplication } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import { MediaService } from '../../src/media/media.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { type GameContext, type GameHarness, nextEvent, settle } from '../game-harness';

/** Sound and video: what each device receives, remote play, who hears the sound, readiness, synchronised start, listen first, media administration. */
export function mediaTests(ctx: GameContext): void {
  let h: GameHarness;
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let quizId: string;
  let hostUserId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    h = ctx.h;
    app = ctx.h.app;
    prisma = ctx.h.prisma;
    url = ctx.h.url;
    quizId = ctx.quizId;
    hostUserId = ctx.h.hostUserId;
  });

  it('tells every device on attach whether the quiz has sound, the phones too', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const screen = connect();
    const media = new Promise((resolve) => screen.once('game:media', resolve));
    await screen.emitWithAck('spectator:join', { pin });
    expect(await media).toEqual({
      title: 'Quiz live test',
      hasSound: false,
      hasMedia: false,
      audioTarget: 'projection_remote',
      language: expect.any(String), // the quiz's (#209)
      roomLanguage: '',
    }); // the seeded quiz is silent
    // A phone too: the room's next quiz may play sound where this one does not (#89).
    const player = connect();
    const told = new Promise((resolve) => player.once('game:media', resolve));
    await player.emitWithAck('player:join', { pin, nickname: 'Mia' });
    expect(await told).toMatchObject({ hasSound: false });
    host.emit('host:end', { pin });
  }, 15_000);

  it('the host steers the sound on every device: an anchor, checked, kept for late screens', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/transport-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 4000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const quiz = await h.seedQuiz({
      title: 'Transport test',
      status: 'ready',
      questionCount: 1,
      questions: {
        create: {
          orderIndex: 0,
          type: 'single_choice',
          prompt: 'Which tune?',
          timeLimitS: 30,
          audioMediaId: asset.id,
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
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const player = connect();
      await player.emitWithAck('player:join', { pin, nickname: 'Ada' });
      const controls: { t: number; at: number; playing: boolean }[] = [];
      screen.on('media:control', (c) => controls.push(c));
      host.emit('host:media', { pin, action: 'restart' }); // lobby: nothing to steer
      const started = new Promise<void>((resolve) =>
        screen.once('question:start', () => resolve()),
      );
      host.emit('host:start', { pin });
      await started;

      // Not a host, or a point outside the sound: nothing moves.
      player.emit('host:media', { pin, action: 'seek', t: 1 });
      host.emit('host:media', { pin, action: 'seek', t: -1 });
      host.emit('host:media', { pin, action: 'seek', t: 99 });
      host.emit('host:media', { pin, action: 'seek', t: 'x' });
      host.emit('host:media', { pin, action: 'jump', t: 1 });
      await settle(200);
      expect(controls).toHaveLength(0);

      const held = nextEvent<{ questionIndex: number; t: number; at: number; playing: boolean }>(
        screen,
        'media:control',
      );
      host.emit('host:media', { pin, action: 'pause', t: 1.5 });
      expect(await held).toMatchObject({ questionIndex: 0, t: 1.5, playing: false });
      const seeked = nextEvent(screen, 'media:control');
      host.emit('host:media', { pin, action: 'seek', t: 3, playing: true });
      expect(await seeked).toMatchObject({ t: 3, playing: true });
      const top = nextEvent(screen, 'media:control');
      host.emit('host:media', { pin, action: 'restart' });
      const restarted = (await top) as { t: number; at: number; playing: boolean };
      expect(restarted).toMatchObject({ t: 0, playing: true });
      expect(Math.abs(restarted.at - Date.now())).toBeLessThan(2000);

      // The game's pause does not count as played: at the resume, the sound is re-anchored
      // where it stood when the clock froze.
      await settle(300);
      host.emit('host:pause', { pin, paused: true });
      await settle(600);
      const resumed = nextEvent<{ t: number; playing: boolean }>(screen, 'media:control');
      host.emit('host:pause', { pin, paused: false });
      const again = await resumed;
      expect(again.playing).toBe(true);
      expect(again.t).toBeGreaterThan(0.2);
      expect(again.t).toBeLessThan(0.8);

      // A screen that opens now lands where the host put the sound, not on the common start.
      const late = connect();
      const replayed = nextEvent<{ t: number; playing: boolean }>(late, 'media:control');
      await late.emitWithAck('spectator:join', { pin });
      expect(await replayed).toMatchObject({ questionIndex: 0, playing: true });
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: quiz.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it('a waveform hidden from the screens is stored and sent as such (manifest v4)', async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: hostUserId,
        url: '/api/v1/media/hidden-wave-test',
        mime: 'audio/mpeg',
        sizeBytes: 1n,
        kind: 'audio',
        durationMs: 2000,
        peaks: new Array(200).fill(0.5),
      },
    });
    const quiz = await h.seedQuiz({
      title: 'Hidden waveform test',
      status: 'ready',
      questionCount: 1,
      questions: {
        create: {
          orderIndex: 0,
          type: 'single_choice',
          prompt: 'Which tune?',
          timeLimitS: 5,
          audioMediaId: asset.id,
          waveformSize: 'hidden',
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
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });
      const q = new Promise<{ media?: { audio?: { size?: string } } }>((resolve) =>
        screen.once('question:start', resolve),
      );
      host.emit('host:start', { pin });
      expect((await q).media?.audio?.size).toBe('hidden');
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: quiz.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);

  it("keeps the instance's media administration from a host (#54)", async () => {
    const res = await fetch(url.replace(/\/game$/, '/admin/media/overview'), {
      headers: { 'X-Local-User': 'Animateur' },
    });
    expect(res.status).toBe(403);
    // The administration answers a refusal in the API's own shape (`{ code }`).
    expect(await res.json()).toMatchObject({ code: 'auth.admin_required' });
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

  it('offers remote play for every quiz, says which quiz has sound, and tells the roster', async () => {
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
      expect(await guest.emitWithAck('player:peek', { pin: silent.pin })).toMatchObject({
        hasSound: false,
        participantAccess: 'account',
      });
      expect(await guest.emitWithAck('player:peek', { pin: loud.pin })).toMatchObject({
        hasSound: true,
        participantAccess: 'account',
      });

      // Remote holds for a silent quiz too: the answers' text comes to that phone (#92).
      const silentRemote = new Promise<{ presence?: string }>((resolve) =>
        host.once('player:joined', resolve),
      );
      await guest.emitWithAck('player:join', {
        pin: silent.pin,
        nickname: 'Ada',
        presence: 'remote',
      });
      expect((await silentRemote).presence).toBe('remote');

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

  it('counts in the lobby every participant, ready once they say so and their device has loaded its media; the projection apart (#104)', async () => {
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
      players: { playerId: string; ready: boolean; pressed?: boolean }[];
      screens: { ready: number; total: number };
      lobby?: boolean;
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
      // A participant's copy of the projection (#104) is never waited for.
      const copy = connect();
      await copy.emitWithAck('spectator:join', { pin, follow: true });
      const room = connect();
      await room.emitWithAck('player:join', { pin, nickname: 'Ada' });
      const remote = connect();
      const { playerId } = await remote.emitWithAck('player:join', {
        pin,
        nickname: 'Grace',
        presence: 'remote',
      });
      // The lobby's one count (#104): every participant, ready once they said so and
      // their device has loaded what it plays; the projection says its own state.
      let r = await until((x) => x.total === 2);
      expect(r).toMatchObject({ ready: 0, total: 2, lobby: true, screens: { ready: 0, total: 1 } });
      expect(r.players.find((p) => p.playerId === playerId)).toEqual({
        playerId,
        ready: false,
        pressed: false,
      });

      screen.emit('media:ready', { pin, questionIndex: 0 });
      r = await until((x) => x.screens.ready === 1);
      expect(r.ready).toBe(0); // the projection is not a participant
      // Loaded but not said: not ready yet.
      remote.emit('media:ready', { pin, questionIndex: 0 });
      await settle(150);
      expect(last!.ready).toBe(0);
      expect((await remote.emitWithAck('player:ready', { pin, ready: true })).ok).toBe(true);
      r = await until((x) => x.ready === 1);
      expect(r.players.find((p) => p.playerId === playerId)).toEqual({
        playerId,
        ready: true,
        pressed: true,
      });
      // In the room, nothing to load: saying so is enough.
      const counted = nextEvent<{ ready: number; total: number }>(remote, 'lobby:count', {
        where: (c: { ready: number }) => c.ready === 2,
      });
      await room.emitWithAck('player:ready', { pin, ready: true });
      r = await until((x) => x.ready === 2);
      // The participants hear the count alone: who said they are ready, not whose media.
      expect(await counted).toEqual({ ready: 2, total: 2 });
      // Changing one's mind counts too.
      await room.emitWithAck('player:ready', { pin, ready: false });
      r = await until((x) => x.ready === 1);

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
    // A participant's copy of the projection follows; it never speaks for the sound (#104).
    const copy = connect();
    await copy.emitWithAck('spectator:join', { pin, follow: true });
    copy.emit('media:position', { pin, questionIndex: 0, t: 7, playing: true }); // ignored
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
      const early = new Promise<{ accepted: boolean; reason?: string }>((resolve) =>
        player.once('answer:ack', resolve),
      );
      player.emit('player:submit', { pin, questionIndex: 0, answer: start.options[0].id });
      // Refused with its reason, so the phone asks again instead of showing it saved.
      expect(await early).toMatchObject({ accepted: false, reason: 'early' });
      // While it is listened to, the point cannot move: the answers open on a time fixed from it.
      const moved: unknown[] = [];
      player.on('media:control', (c) => moved.push(c));
      host.emit('host:media', { pin, action: 'seek', t: 1 });
      host.emit('host:media', { pin, action: 'pause', t: 1 });
      await settle(200);
      expect(moved).toHaveLength(0);
      // Paused while listened to, past the time the answers would have opened: still listening.
      host.emit('host:pause', { pin, paused: true });
      await settle(Math.max(0, start.startedAt - Date.now()) + 300);
      host.emit('host:media', { pin, action: 'seek', t: 1 });
      await settle(200);
      expect(moved).toHaveLength(0);
      host.emit('host:end', { pin });
    } finally {
      await prisma.quiz.delete({ where: { id: quiz.id } });
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
    }
  }, 15_000);
}
