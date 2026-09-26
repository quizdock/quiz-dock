import type { Socket } from 'socket.io-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { type GameContext, type GameHarness, nextEvent, stateEvent } from '../game-harness';

/** Time: adjusting the timer, pause, automatic mode, per-question reveal delay, slides. */
export function timingTests(ctx: GameContext): void {
  let h: GameHarness;
  let prisma: PrismaService;
  let quizId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    h = ctx.h;
    prisma = ctx.h.prisma;
    quizId = ctx.quizId;
  });

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
}
