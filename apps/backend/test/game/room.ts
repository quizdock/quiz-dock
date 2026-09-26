import type { Socket } from 'socket.io-client';
import { GAME_TTL_S, gameKeys } from '../../src/game/game.keys';
import { GameService } from '../../src/game/game.service';
import { RedisService } from '../../src/redis/redis.service';
import { QuizzesService } from '../../src/quizzes/quizzes.service';
import { type GameContext, nextEvent, settle, stateEvent } from '../game-harness';

type Option = { id: string; text: string };
type QuestionStart = { questionIndex: number; startedAt: number; options: Option[] };

/**
 * The room (SPECIFICATIONS-ROOM): several quizzes played one after another under
 * one PIN, each game on its own state, the players joining once.
 */
export function roomTests(ctx: GameContext): void {
  let game: GameService;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    game = ctx.h.app.get(GameService);
  });

  /** Opens the current question and has every player answer Paris; resolves at the reveal. */
  async function playParis(host: Socket, pin: string, players: Socket[]) {
    const starts = players.map((p) => nextEvent<QuestionStart>(p, 'question:start'));
    const reveals = players.map((p) =>
      nextEvent<{ yourResult?: { points: number } }>(p, 'question:reveal'),
    );
    host.emit('host:start', { pin });
    const q = await starts[0];
    await settle(Math.max(0, q.startedAt - Date.now()) + 50);
    const paris = q.options.find((o) => o.text === 'Paris')!.id;
    for (const p of players) p.emit('player:submit', { pin, questionIndex: 0, answer: paris });
    return Promise.all(reveals);
  }

  /** The last question revealed → the podium. */
  async function toPodium(host: Socket, pin: string, player: Socket) {
    const podium = nextEvent<{ you?: { score: number } }>(player, 'game:podium');
    host.emit('host:next', { pin });
    return podium;
  }

  const nextQuiz = (host: Socket, pin: string, quizId: string, archive = false) =>
    host.emitWithAck('host:next-quiz', { pin, quizId, archive });

  it('plays quizzes in a row: from the podium to the next lobby, each scored and archived on its own', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Rita');

    // Quiz 1, to its podium, rated there.
    const [first] = await playParis(host, pin, [player]);
    const firstPoints = first.yourResult!.points;
    expect(firstPoints).toBeGreaterThan(0);
    await toPodium(host, pin, player);
    expect((await player.emitWithAck('player:rate', { pin, rating: 2 })).ok).toBe(true);

    // Quiz 2: the phone is sent the new lobby, the console its outline, nobody types the PIN.
    const second = await ctx.h.seedQuiz({ title: 'Second quiz' });
    const lobby = stateEvent(player, 'LOBBY');
    const outline = nextEvent<{ quizId: string }>(host, 'game:outline');
    expect(await nextQuiz(host, pin, second.id, true)).toEqual({ ok: true });
    await lobby;
    expect((await outline).quizId).toBe(second.id);
    // Being played now, it cannot be deleted (the room's current game is read).
    await expect(
      ctx.h.app.get(QuizzesService).remove(ctx.h.hostUserId, second.id),
    ).rejects.toMatchObject({ response: { message: 'quiz.in_use' } });

    // Question 0 again: quiz 1's lock on it must not stop this reveal.
    const [again] = await playParis(host, pin, [player]);
    const secondPoints = again.yourResult!.points;
    // This quiz's own score, not the sum of both.
    expect((await toPodium(host, pin, player)).you?.score).toBe(secondPoints);
    expect((await player.emitWithAck('player:rate', { pin, rating: 5 })).ok).toBe(true);
    const ended = nextEvent(player, 'game:ended');
    host.emit('host:end', { pin, archive: true });
    await ended;

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
    // One rating per quiz: the second did not overwrite the first.
    const ratings = await ctx.h.prisma.quizFeedback.findMany({ where: { pin } });
    expect(Object.fromEntries(ratings.map((r) => [r.quizId, r.rating]))).toEqual({
      [ctx.quizId]: 2,
      [second.id]: 5,
    });
    await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
    await ctx.h.prisma.quizFeedback.deleteMany({ where: { pin } });
  });

  it('replaces the quiz picked in the lobby, and the one left is no longer in use', async () => {
    const host = connect({ localUser: 'Animateur' });
    const picked = await ctx.h.seedQuiz({ title: 'Picked first' });
    const pin = await ctx.h.createGame(host, picked.id);
    await ctx.h.join(pin, 'Lola');

    await nextQuiz(host, pin, ctx.quizId);
    expect(await game.getMeta(pin)).toMatchObject({ quizId: ctx.quizId, state: 'LOBBY' });
    await expect(
      ctx.h.app.get(QuizzesService).remove(ctx.h.hostUserId, picked.id),
    ).resolves.toBeUndefined();
  });

  it('refuses the next quiz mid-question, and opens it once on a double click', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Nico');
    const second = await ctx.h.seedQuiz({ title: 'Next one' });

    const start = nextEvent<QuestionStart>(player, 'question:start');
    const reveal = nextEvent(player, 'question:reveal');
    host.emit('host:start', { pin });
    const q = await start;
    const refused = nextEvent<{ code: string }>(host, 'error');
    host.emit('host:next-quiz', { pin, quizId: second.id });
    expect((await refused).code).toBe('session.next_quiz_unavailable');

    await settle(Math.max(0, q.startedAt - Date.now()) + 50);
    const paris = q.options.find((o) => o.text === 'Paris')!.id;
    player.emit('player:submit', { pin, questionIndex: 0, answer: paris });
    await reveal;
    await toPodium(host, pin, player);
    const firstGame = (await game.getMeta(pin))!.id;
    // Two clicks: one archive, one new game.
    host.emit('host:next-quiz', { pin, quizId: second.id, archive: true });
    await nextQuiz(host, pin, second.id, true);
    await settle(200);
    const meta = (await game.getMeta(pin))!;
    expect(meta.id).not.toBe(firstGame);
    expect(meta.quizId).toBe(second.id);
    expect(await ctx.h.prisma.gameSessionLog.count({ where: { pin } })).toBe(1);
    await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
  });

  it('someone joining at the podium waits for the next quiz, then plays it', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: early } = await ctx.h.join(pin, 'Early');
    await playParis(host, pin, [early]);
    await toPodium(host, pin, early);

    // At the podium: in the room, not in the quiz that is over.
    const { socket: late, playerId: lateId } = await ctx.h.join(pin, 'Late');
    const firstGame = (await game.getMeta(pin))!.id;
    expect(await game.getScore(firstGame, lateId)).toBeNull();
    const second = await ctx.h.seedQuiz({ title: 'For the late one' });
    await nextQuiz(host, pin, second.id);

    // The next quiz waits for both.
    const count = nextEvent<{ answered: number; total: number }>(host, 'answer:count');
    const [, lateResult] = await playParis(host, pin, [early, late]);
    expect((await count).total).toBe(2);
    expect(lateResult.yourResult!.points).toBeGreaterThan(0);
  });

  it('keeps the host’s choices from one quiz to the next', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Mia');
    host.emit('host:capture', { pin, fullCapture: true });
    host.emit('host:mode', { pin, mode: 'auto' });
    await settle(100);

    const second = await ctx.h.seedQuiz({ title: 'Same choices' });
    const notice = nextEvent<{ fullCapture: boolean }>(player, 'notice');
    const mode = nextEvent<{ mode: string }>(host, 'game:mode');
    await nextQuiz(host, pin, second.id);
    expect((await notice).fullCapture).toBe(true);
    expect((await mode).mode).toBe('auto');
  });

  describe('standings', () => {
    type Standings = {
      quizzesPlayed: number;
      top: { nickname: string; score: number; rank: number }[];
      you?: {
        score: number;
        rank: number;
        correct: number;
        answered: number;
        maxStreak: number;
        quizzes: number;
      };
    };
    const standingsOf = (socket: Socket) => nextEvent<Standings>(socket, 'room:standings');

    /** Opens the question, each player answers the option named; resolves with their points. */
    async function play(host: Socket, pin: string, answers: [Socket, string][]) {
      const starts = answers.map(([p]) => nextEvent<QuestionStart>(p, 'question:start'));
      const reveals = answers.map(([p]) =>
        nextEvent<{ yourResult?: { points: number } }>(p, 'question:reveal'),
      );
      host.emit('host:start', { pin });
      const q = await starts[0];
      await settle(Math.max(0, q.startedAt - Date.now()) + 50);
      answers.forEach(([p, text]) => {
        const option = q.options.find((o) => o.text === text)!.id;
        p.emit('player:submit', { pin, questionIndex: 0, answer: option });
      });
      return (await Promise.all(reveals)).map((r) => r.yourResult?.points ?? 0);
    }

    it('adds up the quizzes of the room, each player with their own line', async () => {
      const host = connect({ localUser: 'Animateur' });
      const pin = await ctx.h.createGame(host, ctx.quizId);
      const { socket: ana } = await ctx.h.join(pin, 'Ana');
      const { socket: ben } = await ctx.h.join(pin, 'Ben');
      const screen = connect();
      await screen.emitWithAck('spectator:join', { pin });

      const [ana1, ben1] = await play(host, pin, [
        [ana, 'Paris'],
        [ben, 'Lyon'],
      ]);
      // At the podium of a one-quiz room, the standings are that quiz's.
      const first = standingsOf(ana);
      await toPodium(host, pin, ana);
      expect(await first).toMatchObject({ quizzesPlayed: 1, you: { score: ana1, rank: 1 } });

      await nextQuiz(host, pin, (await ctx.h.seedQuiz({ title: 'Round two' })).id);
      const [ana2, ben2] = await play(host, pin, [
        [ana, 'Paris'],
        [ben, 'Paris'],
      ]);
      const anaLine = standingsOf(ana);
      const benLine = standingsOf(ben);
      const screenLine = standingsOf(screen);
      await toPodium(host, pin, ana);
      expect((await anaLine).you).toMatchObject({
        score: ana1 + ana2,
        correct: 2,
        answered: 2,
        maxStreak: 1,
        quizzes: 2,
      });
      expect((await benLine).you).toMatchObject({
        score: ben1 + ben2,
        correct: 1,
        answered: 2,
        quizzes: 2,
      });
      const shown = await screenLine;
      expect(shown.quizzesPlayed).toBe(2);
      expect(shown.you).toBeUndefined(); // the projection has no line of its own
      expect(shown.top.map((r) => r.nickname)).toEqual(['Ana', 'Ben']);
    });

    it('counts a quiz once, even when the room closes at its podium', async () => {
      const host = connect({ localUser: 'Animateur' });
      const pin = await ctx.h.createGame(host, ctx.quizId);
      const { socket: player } = await ctx.h.join(pin, 'Cleo');
      await play(host, pin, [[player, 'Paris']]);
      const atPodium = standingsOf(player);
      await toPodium(host, pin, player);
      expect((await atPodium).quizzesPlayed).toBe(1);
      const atClose = standingsOf(player);
      host.emit('host:end', { pin });
      expect(await atClose).toMatchObject({ quizzesPlayed: 1, you: { quizzes: 1 } });
    });

    it('does not count a quiz that never started: replaced, or closed in its lobby', async () => {
      const host = connect({ localUser: 'Animateur' });
      const replaced = await ctx.h.seedQuiz({ title: 'Never played' });
      const pin = await ctx.h.createGame(host, replaced.id);
      const { socket: player } = await ctx.h.join(pin, 'Dora');
      await nextQuiz(host, pin, ctx.quizId); // replaced before it started
      await play(host, pin, [[player, 'Paris']]);
      await toPodium(host, pin, player);

      await nextQuiz(host, pin, (await ctx.h.seedQuiz({ title: 'Closed unplayed' })).id);
      const atClose = standingsOf(player);
      host.emit('host:end', { pin });
      expect((await atClose).quizzesPlayed).toBe(1);
    });

    it('ranks someone who joined at the podium on the quizzes they played', async () => {
      const host = connect({ localUser: 'Animateur' });
      const pin = await ctx.h.createGame(host, ctx.quizId);
      const { socket: first } = await ctx.h.join(pin, 'First');
      await play(host, pin, [[first, 'Paris']]);
      await toPodium(host, pin, first);
      const { socket: later } = await ctx.h.join(pin, 'Later');

      await nextQuiz(host, pin, (await ctx.h.seedQuiz({ title: 'Joined late' })).id);
      await play(host, pin, [
        [first, 'Paris'],
        [later, 'Paris'],
      ]);
      const line = standingsOf(later);
      await toPodium(host, pin, first);
      expect((await line).you).toMatchObject({ quizzes: 1, answered: 1, rank: 2 });
    });
  });

  it('each question keeps the room, its players’ tokens and its game alive', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player, sessionToken } = await ctx.h.join(pin, 'Eve');
    const redis = ctx.h.app.get(RedisService);
    const gameId = (await game.getMeta(pin))!.id;
    // A quiz already recorded in the standings, as after a first round.
    await redis.hset(gameKeys.played(pin), 'earlier', '{}');
    const keys = [
      gameKeys.room(pin),
      gameKeys.session(sessionToken),
      gameKeys.game(gameId),
      gameKeys.played(pin),
    ];
    // An evening later: a few seconds left on each.
    for (const key of keys) await redis.expire(key, 5);

    const start = nextEvent(player, 'question:start');
    host.emit('host:start', { pin });
    await start;
    await settle(100);
    for (const key of keys) expect(await redis.ttl(key)).toBeGreaterThan(GAME_TTL_S - 60);
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
    // Quiz 2 opens within that grace (through the service: the host is away);
    // the grace was quiz 1's, not its.
    const second = await ctx.h.seedQuiz({ title: 'Next quiz' });
    const secondId = await game.openGame(pin, second.id);
    await settle(Number(process.env.GAME_HOST_GRACE_MS) + 300);

    expect(hostGone).toBe(false);
    expect(await game.getMeta(pin)).toMatchObject({ id: secondId, state: 'LOBBY' });
  });
}
