import { roomStandings } from './room-standings';

const result = (
  nickname: string,
  finalScore: number,
  correctCount: number,
  answeredCount: number,
  avgResponseMs: number | null,
  maxStreak: number,
) => ({ nickname, finalScore, correctCount, answeredCount, avgResponseMs, maxStreak });

describe('roomStandings (history)', () => {
  it('sums a room’s sessions per nickname, the average weighted by the answers', () => {
    const standings = roomStandings([
      [result('Ana', 900, 3, 3, 2_000, 3), result('Ben', 1000, 2, 3, 1_000, 2)],
      [result('Ana', 800, 1, 1, 4_000, 1)],
    ]);
    expect(standings).toEqual([
      {
        rank: 1,
        nickname: 'Ana',
        score: 1700,
        correctCount: 4,
        answeredCount: 4,
        avgResponseMs: 2_500, // (3 × 2 s + 1 × 4 s) / 4
        maxStreak: 3,
        quizzes: 2,
      },
      {
        rank: 2,
        nickname: 'Ben',
        score: 1000,
        correctCount: 2,
        answeredCount: 3,
        avgResponseMs: 1_000,
        maxStreak: 2,
        quizzes: 1,
      },
    ]);
  });

  it('breaks a tie by right answers, then by name; no answer, no average', () => {
    const standings = roomStandings([
      [result('Zoe', 500, 2, 2, 1_000, 2), result('Max', 500, 1, 1, 1_000, 1)],
      [result('Abe', 500, 1, 2, null, 1), result('Idle', 0, 0, 0, null, 0)],
    ]);
    expect(standings.map((s) => s.nickname)).toEqual(['Zoe', 'Abe', 'Max', 'Idle']);
    expect(standings[3].avgResponseMs).toBeNull();
  });
});
