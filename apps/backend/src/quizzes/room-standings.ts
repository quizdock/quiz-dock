/** A participant's archived result in one session, as the room's standings read it. */
export interface ArchivedResult {
  nickname: string;
  finalScore: number;
  correctCount: number;
  answeredCount: number;
  avgResponseMs: number | null;
  maxStreak: number;
}

/** A participant's standing over the archived sessions of a room. */
export interface RoomStanding {
  rank: number;
  nickname: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  avgResponseMs: number | null;
  maxStreak: number;
  quizzes: number;
}

/**
 * The standings of a room, read from its archived sessions (nothing stored twice):
 * one line per nickname — unique within a room — with the scores and counts added
 * up, the average time weighted by the answers, the longest run of any one quiz.
 * Ties go to the most right answers, then alphabetically.
 */
export function roomStandings(sessions: ArchivedResult[][]): RoomStanding[] {
  const byName = new Map<string, Omit<RoomStanding, 'rank'> & { totalMs: number }>();
  for (const results of sessions) {
    for (const r of results) {
      const t = byName.get(r.nickname) ?? {
        nickname: r.nickname,
        score: 0,
        correctCount: 0,
        answeredCount: 0,
        avgResponseMs: null,
        maxStreak: 0,
        quizzes: 0,
        totalMs: 0,
      };
      t.score += r.finalScore;
      t.correctCount += r.correctCount;
      t.answeredCount += r.answeredCount;
      t.totalMs += (r.avgResponseMs ?? 0) * r.answeredCount;
      t.maxStreak = Math.max(t.maxStreak, r.maxStreak);
      t.quizzes += 1;
      byName.set(r.nickname, t);
    }
  }
  return [...byName.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.correctCount - a.correctCount ||
        a.nickname.localeCompare(b.nickname),
    )
    .map(({ totalMs, ...t }, i) => ({
      ...t,
      rank: i + 1,
      avgResponseMs: t.answeredCount > 0 ? Math.round(totalMs / t.answeredCount) : null,
    }));
}
