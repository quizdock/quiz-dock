import type { AnswerRecord, QuizSnapshot } from './game.types';

/** What a player did in one game, as the archive and the room's standings count it. */
export interface PlayerStats {
  score: number;
  correct: number;
  answered: number;
  /** Sum of the answer times (ms): an average is `totalMs / answered`. */
  totalMs: number;
  /** Longest run of right answers, in the order of the questions. */
  maxStreak: number;
}

/** A player's answers in a game: counts, time and longest run of right answers. */
export function answerStats(
  snapshot: QuizSnapshot,
  answersByIndex: Map<number, Map<string, AnswerRecord>>,
  playerId: string,
): Omit<PlayerStats, 'score'> {
  let answered = 0;
  let correct = 0;
  let totalMs = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const { orderIndex } of snapshot.questions) {
    const rec = answersByIndex.get(orderIndex)?.get(playerId);
    if (!rec) {
      streak = 0;
      continue;
    }
    answered += 1;
    totalMs += rec.tMs;
    if (rec.isCorrect) {
      correct += 1;
      streak += 1;
      if (streak > maxStreak) maxStreak = streak;
    } else {
      streak = 0;
    }
  }
  return { answered, correct, totalMs, maxStreak };
}

/** A player's standing across the games of a room. */
export interface SeriesStats extends PlayerStats {
  /** Games they took part in. */
  quizzes: number;
}

/**
 * Sums the games of a room (`gameId → playerId → stats`) per player: scores,
 * counts and times add up, the longest run is the longest of any game.
 */
export function sumGames(games: Iterable<Record<string, PlayerStats>>): Map<string, SeriesStats> {
  const totals = new Map<string, SeriesStats>();
  for (const game of games) {
    for (const [playerId, s] of Object.entries(game)) {
      const t = totals.get(playerId) ?? {
        score: 0,
        correct: 0,
        answered: 0,
        totalMs: 0,
        maxStreak: 0,
        quizzes: 0,
      };
      t.score += s.score;
      t.correct += s.correct;
      t.answered += s.answered;
      t.totalMs += s.totalMs;
      t.maxStreak = Math.max(t.maxStreak, s.maxStreak);
      t.quizzes += 1;
      totals.set(playerId, t);
    }
  }
  return totals;
}
