import type { Socket } from 'socket.io-client';
import { GAME_TTL_S, gameKeys } from '../../src/game/game.keys';
import { GameService } from '../../src/game/game.service';
import { RedisService } from '../../src/redis/redis.service';
import { UserRole } from '@prisma/client';
import { MediaService } from '../../src/media/media.service';
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
    const podium = nextEvent<{ you?: { score: number }; quizId?: string }>(player, 'game:podium');
    host.emit('host:next', { pin });
    return podium;
  }

  /** The room's next quiz: back to its lobby (the last quiz kept or not), then picked there. */
  const nextQuiz = async (host: Socket, pin: string, quizId: string, archive = false) => {
    await host.emitWithAck('host:back-to-lobby', { pin, archive });
    return host.emitWithAck('host:next-quiz', { pin, quizId });
  };

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

    // Back to the lobby, no quiz yet: the console's outline is emptied.
    const second = await ctx.h.seedQuiz({ title: 'Second quiz' });
    const lobby = stateEvent(player, 'LOBBY');
    const emptied = nextEvent<{ quizId: string }>(host, 'game:outline');
    expect(await host.emitWithAck('host:back-to-lobby', { pin, archive: true })).toEqual({
      ok: true,
    });
    await lobby;
    expect((await emptied).quizId).toBe('');
    const refused = nextEvent<{ code: string }>(host, 'error');
    host.emit('host:start', { pin }); // no quiz: nothing starts
    expect((await refused).code).toBe('session.quiz_required');
    // Quiz 2 picked there: the console its outline, nobody types the PIN.
    const outline = nextEvent<{ quizId: string }>(host, 'game:outline');
    expect(await host.emitWithAck('host:next-quiz', { pin, quizId: second.id })).toEqual({
      ok: true,
    });
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

  it('closes a quiz mid-way for the next one: kept as interrupted and counted, or dropped', async () => {
    const second = await ctx.h.seedQuiz({ title: 'Next one' });

    // Kept: what was played so far is archived (interrupted) and counts in the room.
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: player } = await ctx.h.join(pin, 'Nico');
    const [played] = await playParis(host, pin, [player]);
    const points = played.yourResult!.points;
    expect(points).toBeGreaterThan(0);
    const firstGame = (await game.getMeta(pin))!.id;
    const lobby = stateEvent(player, 'LOBBY');
    // Two clicks: one archive, one new lobby.
    await Promise.all([
      host.emitWithAck('host:back-to-lobby', { pin, archive: true }),
      host.emitWithAck('host:back-to-lobby', { pin, archive: true }),
    ]);
    await host.emitWithAck('host:next-quiz', { pin, quizId: second.id });
    await lobby;
    await settle(200);
    const meta = (await game.getMeta(pin))!;
    expect(meta).toMatchObject({ quizId: second.id, state: 'LOBBY' });
    expect(meta.id).not.toBe(firstGame);
    const sessions = await ctx.h.prisma.gameSessionLog.findMany({ where: { pin } });
    expect(sessions.map((x) => x.status)).toEqual(['interrupted']);
    const standings = await game.standings(pin);
    expect(standings.quizzesPlayed).toBe(1);
    expect(standings.ranked[0]).toMatchObject({ score: points });
    await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });

    // Dropped: nothing of it stays, neither in History nor in the room's standings.
    const host2 = connect({ localUser: 'Animateur' });
    const pin2 = await ctx.h.createGame(host2, ctx.quizId);
    const { socket: player2 } = await ctx.h.join(pin2, 'Zoe');
    await playParis(host2, pin2, [player2]);
    await nextQuiz(host2, pin2, second.id, false);
    expect(await game.getMeta(pin2)).toMatchObject({ quizId: second.id, state: 'LOBBY' });
    expect(await ctx.h.prisma.gameSessionLog.count({ where: { pin: pin2 } })).toBe(0);
    expect((await game.standings(pin2)).quizzesPlayed).toBe(0);
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

  it('takes a rating for the quiz just played after the host moved on, never for one not played', async () => {
    const host = connect({ localUser: 'Animateur' });
    const first = await ctx.h.seedQuiz({ title: 'Rated late' });
    const pin = await ctx.h.createGame(host, first.id);
    const { socket: ada } = await ctx.h.join(pin, 'Ada');
    await playParis(host, pin, [ada]);
    // The podium names its quiz: the phone keys its rating by it.
    expect((await toPodium(host, pin, ada)).quizId).toBe(first.id);
    const { socket: bea } = await ctx.h.join(pin, 'Bea'); // at the podium: did not play it

    await nextQuiz(host, pin, (await ctx.h.seedQuiz({ title: 'Next, unplayed' })).id);
    const rate = (p: Socket, rating: number) => p.emitWithAck('player:rate', { pin, rating });
    expect((await rate(ada, 4)).ok).toBe(true); // still typing when the host moved on
    expect((await rate(bea, 1)).ok).toBe(false);

    // Closed from the lobby of a quiz nobody played: the rating still goes to the one played.
    const ended = nextEvent<{ quizId?: string }>(ada, 'game:ended');
    host.emit('host:end', { pin });
    await ended;
    expect((await rate(ada, 5)).ok).toBe(true);
    const rows = await ctx.h.prisma.quizFeedback.findMany({ where: { pin } });
    expect(rows.map((r) => [r.quizId, r.nickname, r.rating])).toEqual([[first.id, 'Ada', 5]]);
    await ctx.h.prisma.quizFeedback.deleteMany({ where: { pin } });
  });

  it('names the room in its lobby, never mid-quiz, and keeps the name with each archived session', async () => {
    const host = connect({ localUser: 'Animateur' });
    const [a, b] = [
      await ctx.h.seedQuiz({ title: 'Named A' }),
      await ctx.h.seedQuiz({ title: 'Named B' }),
    ];
    const pin = await ctx.h.createGame(host, a.id);
    const { socket: player } = await ctx.h.join(pin, 'Noa');
    const screen = connect();
    // On attach: no name yet, the host's name for the default.
    const first = nextEvent<{ name: string | null; hostName: string }>(screen, 'room:info');
    await screen.emitWithAck('spectator:join', { pin });
    expect(await first).toEqual({ name: null, hostName: 'Animateur' });

    const renamed = nextEvent<{ name: string | null }>(player, 'room:info');
    host.emit('host:room-name', { pin, name: '  Friday   quiz night  ' });
    expect((await renamed).name).toBe('Friday quiz night');

    await playParis(host, pin, [player]);
    const refused = nextEvent<{ code: string }>(host, 'error');
    host.emit('host:room-name', { pin, name: 'Too late' });
    expect((await refused).code).toBe('session.already_started');

    await toPodium(host, pin, player);
    await nextQuiz(host, pin, b.id, true);
    host.emit('host:room-name', { pin, name: 'Friday night, round two' });
    await playParis(host, pin, [player]);
    await toPodium(host, pin, player);
    const ended = nextEvent(player, 'game:ended');
    host.emit('host:end', { pin, archive: true });
    await ended;

    const sessions = await ctx.h.prisma.gameSessionLog.findMany({
      where: { pin },
      orderBy: { startedAt: 'asc' },
    });
    expect(sessions.map((s) => s.roomName)).toEqual([
      'Friday quiz night',
      'Friday night, round two',
    ]);
    const detail = await ctx.h.app
      .get(QuizzesService)
      .sessionDetail({ id: ctx.h.hostUserId, roles: [UserRole.host] }, a.id, sessions[0].id);
    expect(detail.room).toMatchObject({ name: 'Friday night, round two', hostName: 'Animateur' });
    await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
  });

  it('asks each quiz of the room again whether the participants are ready, and tells a phone back what it said', async () => {
    const host = connect({ localUser: 'Animateur' });
    const pin = await ctx.h.createGame(host, ctx.quizId);
    const { socket: ivy, sessionToken } = await ctx.h.join(pin, 'Ivy');
    const count = (ready: number) =>
      nextEvent<{ ready: number; total: number }>(host, 'media:readiness', {
        where: (r) => r.ready === ready,
      });
    let seen = count(1);
    await ivy.emitWithAck('player:ready', { pin, ready: true });
    expect(await seen).toMatchObject({ ready: 1, total: 1 });

    // Back after a lost connection: the phone is told it already said so.
    const again = connect();
    const told = nextEvent<{ ready: boolean }>(again, 'lobby:you');
    await again.emitWithAck('player:reconnect', { sessionToken });
    expect(await told).toEqual({ ready: true });

    // The next quiz asks again.
    await playParis(host, pin, [again]);
    await toPodium(host, pin, again);
    seen = count(0);
    await nextQuiz(host, pin, (await ctx.h.seedQuiz({ title: 'Ready again' })).id);
    expect(await seen).toMatchObject({ ready: 0, total: 1 });
    void ivy;
  });

  it('keeps the room’s game sounds: off in a new room, a track of the host’s, never someone else’s (#93)', async () => {
    const prisma = ctx.h.prisma;
    const other = await prisma.user.upsert({
      where: { oidcSubject: 'local:sound-stranger' },
      create: { oidcSubject: 'local:sound-stranger', displayName: 'Stranger' },
      update: {},
    });
    const sound = (ownerId: string, name: string) =>
      prisma.mediaAsset.create({
        data: {
          ownerId,
          url: `/api/v1/media/${name}`,
          mime: 'audio/mp4',
          sizeBytes: 1n,
          kind: 'audio',
          durationMs: 30_000,
          peaks: [],
          // Old enough for the hourly sweep, used by no quiz.
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
    const mine = await sound(ctx.h.hostUserId, 'room-track');
    const theirs = await sound(other.id, 'not-mine');
    try {
      const host = connect({ localUser: 'Animateur' });
      const pin = await ctx.h.createGame(host, ctx.quizId);
      const screen = connect();
      const first = nextEvent<Record<string, unknown>>(screen, 'room:sounds');
      await screen.emitWithAck('spectator:join', { pin });
      expect(await first).toEqual({
        tick: false,
        gong: false,
        countdown: false,
        ding: false,
        tickUrl: null,
        gongUrl: null,
        dingUrl: null,
        countdownUrl: null,
        musicUrl: null,
        musicLevel: 0.5,
        sfxLevel: 0.8,
        musicMuted: false,
        sfxMuted: false,
        // The quiz's own sound at full level, and the room's sound on (#150).
        mediaLevel: 1,
        mediaMuted: false,
        muted: false,
      });

      const changed = nextEvent<Record<string, unknown>>(screen, 'room:sounds');
      host.emit('host:sounds', { pin, tick: true, musicId: mine.id, musicLevel: 2 });
      expect(await changed).toMatchObject({
        tick: true,
        musicUrl: '/api/v1/media/room-track',
        musicLevel: 1, // clamped
      });
      // A channel off for the whole room, its level kept for when it is back.
      const muted = nextEvent<Record<string, unknown>>(screen, 'room:sounds');
      host.emit('host:sounds', { pin, musicMuted: true, sfxMuted: 'yes' });
      expect(await muted).toMatchObject({ musicMuted: true, sfxMuted: false, musicLevel: 1 });
      // The console controls all of the projection's sound: its media bus and a master mute.
      const master = nextEvent<Record<string, unknown>>(screen, 'room:sounds');
      host.emit('host:sounds', { pin, muted: true, mediaLevel: 0.4, mediaMuted: true });
      expect(await master).toMatchObject({ muted: true, mediaLevel: 0.4, mediaMuted: true });
      const refused = nextEvent<{ code: string }>(host, 'error');
      host.emit('host:sounds', { pin, gongId: theirs.id });
      expect((await refused).code).toBe('media.not_found');

      // The hourly sweep keeps a track an open room plays, used by no quiz.
      await ctx.h.app.get(MediaService).sweepOrphans(0);
      expect(await prisma.mediaAsset.findUnique({ where: { id: mine.id } })).not.toBeNull();
    } finally {
      await prisma.mediaAsset.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
    }
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

  describe('history', () => {
    const asHost = () => ({ id: ctx.h.hostUserId, roles: [UserRole.host] });
    const quizzes = () => ctx.h.app.get(QuizzesService);

    /** Plays the quiz in the room to its podium, every participant answering Paris. */
    async function playToPodium(host: Socket, pin: string, players: Socket[]) {
      await playParis(host, pin, players);
      await toPodium(host, pin, players[0]);
    }

    /** The only archived session of `quizId` played under `pin`. */
    async function sessionOf(quizId: string, pin: string) {
      return ctx.h.prisma.gameSessionLog.findFirstOrThrow({ where: { quizId, pin } });
    }

    it('reads a room from its archived sessions: its quizzes in order, its standings', async () => {
      const host = connect({ localUser: 'Animateur' });
      const [a, b] = [
        await ctx.h.seedQuiz({ title: 'Round A' }),
        await ctx.h.seedQuiz({ title: 'Round B' }),
      ];
      const pin = await ctx.h.createGame(host, a.id);
      const { socket: hana } = await ctx.h.join(pin, 'Hana');
      const { socket: ivo } = await ctx.h.join(pin, 'Ivo');
      await playToPodium(host, pin, [hana, ivo]);
      await nextQuiz(host, pin, b.id, true);
      await playToPodium(host, pin, [hana, ivo]);
      const ended = nextEvent(hana, 'game:ended');
      host.emit('host:end', { pin, archive: true });
      await ended;

      const [sa, sb] = [await sessionOf(a.id, pin), await sessionOf(b.id, pin)];
      expect(sa.roomId).toBe(sb.roomId);
      const list = await quizzes().sessions(asHost(), a.id);
      expect(list.sessions.find((s) => s.id === sa.id)?.roomSize).toBe(2);

      const detail = await quizzes().sessionDetail(asHost(), a.id, sa.id);
      expect(detail.room?.sessions).toEqual([
        expect.objectContaining({ id: sa.id, quizId: a.id, quizTitle: 'Round A', current: true }),
        expect.objectContaining({ id: sb.id, quizId: b.id, quizTitle: 'Round B', current: false }),
      ]);
      const results = await ctx.h.prisma.playerResultLog.findMany({
        where: { sessionLogId: { in: [sa.id, sb.id] }, nickname: 'Hana' },
      });
      expect(detail.room?.standings?.find((r) => r.nickname === 'Hana')).toMatchObject({
        score: results.reduce((sum, r) => sum + r.finalScore, 0),
        answeredCount: 2,
        quizzes: 2,
      });
      await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
    });

    it('keeps no standings unless every session tracked its participants', async () => {
      const host = connect({ localUser: 'Animateur' });
      const [a, b] = [
        await ctx.h.seedQuiz({ title: 'Untracked' }),
        await ctx.h.seedQuiz({ title: 'Tracked' }),
      ];
      const pin = await ctx.h.createGame(host, a.id);
      const { socket: jo } = await ctx.h.join(pin, 'Jo');
      host.emit('host:options', { pin, personalTracking: false });
      await settle(100);
      await playToPodium(host, pin, [jo]);
      await nextQuiz(host, pin, b.id, true);
      host.emit('host:options', { pin, personalTracking: true });
      await settle(100);
      await playToPodium(host, pin, [jo]);
      const ended = nextEvent(jo, 'game:ended');
      host.emit('host:end', { pin, archive: true });
      await ended;

      const sb = await sessionOf(b.id, pin);
      const detail = await quizzes().sessionDetail(asHost(), b.id, sb.id);
      expect(detail.room?.sessions).toHaveLength(2);
      expect(detail.room?.standings).toBeNull();
      await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
    });

    it('reads a session as played alone when its room kept only it', async () => {
      const host = connect({ localUser: 'Animateur' });
      const [a, b] = [
        await ctx.h.seedQuiz({ title: 'Kept' }),
        await ctx.h.seedQuiz({ title: 'Not kept' }),
      ];
      const pin = await ctx.h.createGame(host, a.id);
      const { socket: kim } = await ctx.h.join(pin, 'Kim');
      await playToPodium(host, pin, [kim]);
      await nextQuiz(host, pin, b.id, true);
      await playToPodium(host, pin, [kim]);
      const ended = nextEvent(kim, 'game:ended');
      host.emit('host:end', { pin }); // quiz B not archived
      await ended;

      const sa = await sessionOf(a.id, pin);
      expect(sa.roomId).toBeTruthy();
      const detail = await quizzes().sessionDetail(asHost(), a.id, sa.id);
      expect(detail.room).toBeNull();
      expect(detail.roomSize).toBeNull();
      await ctx.h.prisma.gameSessionLog.deleteMany({ where: { pin } });
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
