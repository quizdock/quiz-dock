import type { Socket } from 'socket.io-client';
import { GameService } from '../../src/game/game.service';
import { GRACE_MS } from '../../src/game/game.keys';
import { SessionArchiveService } from '../../src/game/session-archive.service';
import { QuizzesService } from '../../src/quizzes/quizzes.service';
import { type GameContext, nextEvent, settle, shortenTimer, stateEvent } from '../game-harness';

type QuestionStart = { questionIndex: number; startedAt: number; endsAt: number };
type Option = { id: string; text: string };

/**
 * The room (SPECIFICATIONS-ROOM §3): several quizzes played one after another
 * under one PIN, each game on its own state. The host-facing flow comes later;
 * here the next game is opened through the service.
 */
export function roomTests(ctx: GameContext): void {
  let game: GameService;
  let archive: SessionArchiveService;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    game = ctx.h.app.get(GameService);
    archive = ctx.h.app.get(SessionArchiveService);
  });

  /** Plays the current question: waits for its opening, answers Paris, returns the reveal. */
  async function answerParis(host: Socket, player: Socket, pin: string) {
    const start = nextEvent<QuestionStart & { options: Option[] }>(player, 'question:start');
    const revealed = nextEvent<{ yourResult?: { points: number } }>(player, 'question:reveal');
    host.emit('host:start', { pin });
    const q = await start;
    await settle(Math.max(0, q.startedAt - Date.now()) + 50);
    const paris = q.options.find((o) => o.text === 'Paris')!.id;
    player.emit('player:submit', { pin, questionIndex: 0, answer: paris });
    return revealed;
  }

  it('plays a second quiz in the same room: it reveals, reaches its podium and archives on its own', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Rita');

    // Quiz 1, to its podium, then archived as its own session.
    const first = await answerParis(host, player, pin);
    const firstPoints = first.yourResult!.points;
    expect(firstPoints).toBeGreaterThan(0);
    const podium1 = stateEvent(player, 'PODIUM');
    host.emit('host:next', { pin });
    await podium1;
    const firstMeta = (await game.getMeta(pin))!;
    await archive.archive(pin, firstMeta);

    // Quiz 2 in the same room: a new game, the player still in, at 0.
    const second = await ctx.h.seedQuiz({ title: 'Second quiz' });
    const secondId = await game.openGame(pin, second.id);
    expect(secondId).not.toBe(firstMeta.id);
    expect(await game.getMeta(pin)).toMatchObject({ id: secondId, state: 'LOBBY' });
    // Being played, it cannot be deleted (the room's current game is read).
    await expect(
      ctx.h.app.get(QuizzesService).remove(ctx.h.hostUserId, second.id),
    ).rejects.toMatchObject({ response: { message: 'quiz.in_use' } });

    // Question 0 again: quiz 1's lock on it must not stop this reveal.
    const secondReveal = await answerParis(host, player, pin);
    const secondPoints = secondReveal.yourResult!.points;
    expect(secondPoints).toBeGreaterThan(0);
    const podium = nextEvent<{ you?: { score: number } }>(player, 'game:podium');
    host.emit('host:next', { pin });
    // This quiz's own score, not the sum of both.
    expect((await podium).you?.score).toBe(secondPoints);
    await archive.archive(pin, (await game.getMeta(pin))!);

    const sessions = await ctx.h.prisma.gameSessionLog.findMany({
      where: { pin },
      include: { playerResults: true },
      orderBy: { startedAt: 'asc' },
    });
    expect(sessions.map((s) => s.quizId)).toEqual([ctx.quizId, second.id]);
    expect(sessions.map((s) => s.playerResults[0]?.finalScore)).toEqual([
      firstPoints,
      secondPoints,
    ]);
    await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
  });

  it('a timer armed by the previous quiz does not move the next one', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Timo');

    // Quiz 1 on question 0, its reveal timer shortened to fire soon.
    const start = nextEvent<QuestionStart>(player, 'question:start');
    host.emit('host:start', { pin });
    const q = await start;
    const firstEndsAt = await shortenTimer(host, pin, q.endsAt);

    // Quiz 2 opens and starts its own question 0, with a long clock.
    const long = await ctx.h.seedQuiz({
      title: 'Long quiz',
      questions: {
        create: {
          orderIndex: 0,
          type: 'single_choice',
          prompt: 'Long question',
          timeLimitS: 60,
          options: {
            create: [
              { orderIndex: 0, text: 'A', color: 'red', shape: 'triangle', isCorrect: true },
              { orderIndex: 1, text: 'B', color: 'blue', shape: 'diamond', isCorrect: false },
            ],
          },
        },
      },
    });
    const secondId = await game.openGame(pin, long.id);
    const secondStart = nextEvent<QuestionStart>(player, 'question:start');
    host.emit('host:start', { pin });
    expect((await secondStart).endsAt - Date.now()).toBeGreaterThan(50_000);

    // Past quiz 1's deadline: quiz 2 is still answering.
    let revealed = false;
    player.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealed = true;
    });
    await settle(Math.max(0, firstEndsAt + GRACE_MS - Date.now()) + 300);
    expect(revealed).toBe(false);
    expect(await game.getMeta(pin)).toMatchObject({ id: secondId, state: 'ANSWERING' });
  });
}
