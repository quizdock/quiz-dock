import type { Socket } from 'socket.io-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GRACE_MS } from '../../src/game/game.keys';
import { type GameContext, nextEvent, settle, shortenTimer } from '../game-harness';

/** The question loop: start (allowlist), answers, a single reveal, the podium, review, and the form refreshed live. */
export function questionLoopTests(ctx: GameContext): void {
  let prisma: PrismaService;
  let quizId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    prisma = ctx.h.prisma;
    quizId = ctx.quizId;
  });

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
}
