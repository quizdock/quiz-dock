import { sumGames } from './player-stats';

describe('sumGames (room standings)', () => {
  const line = (
    score: number,
    correct: number,
    answered: number,
    totalMs: number,
    maxStreak: number,
  ) => ({
    score,
    correct,
    answered,
    totalMs,
    maxStreak,
  });

  it('adds scores, counts and times; keeps the longest run of any one game', () => {
    const totals = sumGames([
      { a: line(900, 3, 4, 8_000, 3), b: line(400, 1, 4, 12_000, 1) },
      { a: line(500, 1, 2, 3_000, 1) },
    ]);
    expect(totals.get('a')).toEqual({
      score: 1400,
      correct: 4,
      answered: 6,
      totalMs: 11_000,
      maxStreak: 3,
      quizzes: 2,
    });
    // Only in the games they took part in.
    expect(totals.get('b')?.quizzes).toBe(1);
  });

  it('is empty before any game is over', () => {
    expect(sumGames([]).size).toBe(0);
  });
});
