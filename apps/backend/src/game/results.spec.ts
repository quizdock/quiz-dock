import type { QuestionRevealPayload } from '@quiz-dock/contracts';
import type { AnswerRecord, QuizSnapshot } from './game.types';
import {
  personalLeaderboard,
  personalPodium,
  personalReveal,
  rankPlayers,
  rankingOf,
  scoreTable,
  topRows,
} from './results';

const record = (nickname: string, joinedAt: number) =>
  JSON.stringify({
    nickname,
    avatar: nickname,
    userId: null,
    connected: true,
    joinedAt,
    latencyMs: 0,
  });
const score = (points: number) => JSON.stringify({ score: points, streak: 0 });

describe('results', () => {
  const players = {
    a: record('Ann', 1),
    b: record('Bob', 2),
    c: record('Cid', 3),
    d: record('Dan', 4),
  };
  // Dan is in the room but not in this game; `gone` has a score but left the room: neither is ranked.
  const scores = { a: score(500), b: score(900), c: score(500), gone: score(2000) };
  const ranking = rankingOf(rankPlayers(players, scores));

  it('ranks by score, then by arrival, the players of the room who play the game', () => {
    expect(ranking.ranked.map((p) => p.nickname)).toEqual(['Bob', 'Ann', 'Cid']);
    expect(ranking.top.map((r) => [r.nickname, r.rank])).toEqual([
      ['Bob', 1],
      ['Ann', 2],
      ['Cid', 3],
    ]);
    expect(topRows(ranking.ranked, 2)).toHaveLength(2);
  });

  it('adds its own line to a player, none to a screen', () => {
    expect(personalLeaderboard(ranking, 'a').you).toEqual({ score: 500, rank: 2 });
    expect(personalLeaderboard(ranking, undefined).you).toBeUndefined();
    expect(personalLeaderboard(ranking, 'stranger').you).toBeUndefined();
  });

  it('gives a player their result in the reveal: partial credit and closest rank when they apply', () => {
    const common = { questionIndex: 0 } as unknown as QuestionRevealPayload;
    const records = new Map<string, AnswerRecord>([
      [
        'a',
        { answer: 'x', isCorrect: false, pointsAwarded: 200, credit: 0.5, tMs: 1, receivedAt: 1 },
      ],
      [
        'b',
        {
          answer: 7,
          isCorrect: true,
          pointsAwarded: 900,
          credit: 1,
          closestRank: 1,
          distance: 0,
          tMs: 1,
          receivedAt: 1,
        },
      ],
    ]);
    expect(personalReveal(common, records, ranking, 'a').yourResult).toEqual({
      correct: false,
      points: 200,
      totalScore: 500,
      rank: 2,
      credit: 0.5,
    });
    expect(personalReveal(common, records, ranking, 'b').yourResult).toEqual({
      correct: true,
      points: 900,
      totalScore: 900,
      rank: 1,
      closestRank: 1,
      distance: 0,
    });
    // Ranked but no answer: nothing scored.
    expect(personalReveal(common, records, ranking, 'c').yourResult).toMatchObject({
      correct: false,
      points: 0,
    });
    expect(personalReveal(common, records, ranking, undefined)).toEqual(common);
  });

  it('shows the top 3 at the podium, with the quiz, its credits and whether to rate it', () => {
    const snapshot = { quizId: 'q', feedbackEnabled: false, credits: ['CC-BY'] } as QuizSnapshot;
    expect(personalPodium(ranking, 'c', snapshot)).toEqual({
      podium: ranking.top.slice(0, 3),
      quizId: 'q',
      feedbackEnabled: false,
      credits: ['CC-BY'],
      you: { score: 500, rank: 3 },
    });
    expect(personalPodium(ranking, undefined, null)).toEqual({
      podium: ranking.top.slice(0, 3),
      feedbackEnabled: true,
      you: undefined,
    });
  });
});

describe('scoreTable (#198)', () => {
  const quiz = rankPlayers(
    { a: record('Ann', 1), b: record('Bob', 2) },
    {
      a: JSON.stringify({ score: 300, streak: 1 }),
      b: JSON.stringify({ score: 500, streak: 1 }),
    },
  );
  // The room's standings so far: Ann won the first quiz; Cid joined after it, waits.
  const room = [
    { id: 'a', score: 1000, joinedAt: 1 },
    { id: 'c', score: 0, joinedAt: 3 },
  ];

  it("adds the quiz in progress to the room's total, each with its rank", () => {
    expect(scoreTable(quiz, room, false)).toEqual([
      { playerId: 'a', quizScore: 300, quizRank: 2, roomScore: 1300, roomRank: 1 },
      { playerId: 'c', quizScore: 0, quizRank: 3, roomScore: 0, roomRank: 3 },
      { playerId: 'b', quizScore: 500, quizRank: 1, roomScore: 500, roomRank: 2 },
    ]);
  });

  it('counts a quiz once its podium has recorded it in the room', () => {
    const folded = [
      { id: 'a', score: 1300, joinedAt: 1 },
      { id: 'b', score: 500, joinedAt: 2 },
    ];
    expect(scoreTable(quiz, folded, true).map((r) => r.roomScore)).toEqual([1300, 500]);
  });
});
