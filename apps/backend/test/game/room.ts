import type { Socket } from 'socket.io-client';
import { GameService } from '../../src/game/game.service';
import { SessionArchiveService } from '../../src/game/session-archive.service';
import { QuizzesService } from '../../src/quizzes/quizzes.service';
import { type GameContext, nextEvent, settle, stateEvent } from '../game-harness';

type QuestionStart = { questionIndex: number; startedAt: number };
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

  it('a timer armed for the previous quiz does nothing to the next one', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Timo');
    let hostGone = false;
    player.on('game:state', (s: { state: string }) => {
      if (s.state === 'HOST_DISCONNECTED') hostGone = true;
    });

    // The host's window closes: quiz 1 arms its grace before declaring them gone.
    host.disconnect();
    await settle(50);
    // Quiz 2 opens within that grace; the grace was quiz 1's, not its.
    const second = await ctx.h.seedQuiz({ title: 'Next quiz' });
    const secondId = await game.openGame(pin, second.id);
    await settle(Number(process.env.GAME_HOST_GRACE_MS) + 300);

    expect(hostGone).toBe(false);
    expect(await game.getMeta(pin)).toMatchObject({ id: secondId, state: 'LOBBY' });
  });
}
