import type { INestApplication } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import { MediaService } from '../../src/media/media.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { type GameContext, type GameHarness, settle } from '../game-harness';

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
      hasSound: false,
      hasMedia: false,
      audioTarget: 'projection_remote',
    }); // the seeded quiz is silent
    // A phone too: the room's next quiz may play sound where this one does not (#89).
    const player = connect();
    const told = new Promise((resolve) => player.once('game:media', resolve));
    await player.emitWithAck('player:join', { pin, nickname: 'Mia' });
    expect(await told).toMatchObject({ hasSound: false });
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
      expect(await guest.emitWithAck('player:peek', { pin: silent.pin })).toEqual({
        hasSound: false,
        participantAccess: 'account',
      });
      expect(await guest.emitWithAck('player:peek', { pin: loud.pin })).toEqual({
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
}
