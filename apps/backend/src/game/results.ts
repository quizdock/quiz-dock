import type {
  HostScoreRow,
  LeaderboardPayload,
  LeaderboardRow,
  PodiumPayload,
  QuestionRevealPayload,
} from '@quiz-dock/contracts';
import type { AnswerRecord, PlayerRecord, PlayerScore, QuizSnapshot } from './game.types';

/**
 * A game's results as each device is sent them: the part every device shares
 * (top rows, podium, common reveal) and the line of the socket's own player.
 * Pure: the engine reads Redis, these shape the payloads.
 */

export type RankedPlayer = PlayerRecord & PlayerScore & { id: string };

/** The players of a game ranked, with an index by id: computed once per event, read per socket. */
export interface Ranking {
  ranked: RankedPlayer[];
  /** playerId → rank (1-based) and the player. */
  byId: Map<string, { rank: number; player: RankedPlayer }>;
  /** Top 10, as every device shows it. */
  top: LeaderboardRow[];
}

/**
 * The players of a game, by score then arrival (§5): those of the room (`players`,
 * JSON records) who play it (`scores`, JSON scores), with what they scored in it.
 */
export function rankPlayers(
  players: Record<string, string>,
  scores: Record<string, string>,
): RankedPlayer[] {
  return Object.entries(scores)
    .filter(([id]) => players[id])
    .map(([id, score]) => ({
      id,
      ...(JSON.parse(players[id]) as PlayerRecord),
      ...(JSON.parse(score) as PlayerScore),
    }))
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
}

export function rankingOf(ranked: RankedPlayer[]): Ranking {
  return {
    ranked,
    byId: new Map(ranked.map((player, i) => [player.id, { rank: i + 1, player }])),
    top: topRows(ranked),
  };
}

/** The first `limit` rows of a ranking, as shown publicly (no personal rank). */
export function topRows(
  ranked: Pick<RankedPlayer, 'nickname' | 'score' | 'avatar'>[],
  limit = 10,
): LeaderboardRow[] {
  return ranked
    .slice(0, limit)
    .map((p, i) => ({ nickname: p.nickname, score: p.score, rank: i + 1, avatar: p.avatar }));
}

/** The socket's own score and rank, when it is a player of the game. */
function yourLine(ranking: Ranking, playerId: string | undefined) {
  const me = playerId ? ranking.byId.get(playerId) : undefined;
  return me ? { score: me.player.score, rank: me.rank } : undefined;
}

/** The common reveal, plus `yourResult` for the socket's player (if it has one). */
export function personalReveal(
  common: QuestionRevealPayload,
  records: Map<string, AnswerRecord>,
  ranking: Ranking,
  playerId: string | undefined,
): QuestionRevealPayload {
  const you = yourLine(ranking, playerId);
  if (!you) return { ...common };
  const rec = records.get(playerId!);
  return {
    ...common,
    yourResult: {
      correct: rec?.isCorrect ?? false,
      points: rec?.pointsAwarded ?? 0,
      totalScore: you.score,
      rank: you.rank,
      ...(rec?.credit !== undefined && rec.credit > 0 && rec.credit < 1
        ? { credit: rec.credit }
        : {}),
      ...(rec?.closestRank !== undefined
        ? { closestRank: rec.closestRank, distance: rec.distance }
        : {}),
    },
  };
}

/** The public top 10, plus `you` for the socket's player (if it has one). */
export function personalLeaderboard(
  ranking: Ranking,
  playerId: string | undefined,
): LeaderboardPayload {
  return { top: ranking.top, you: yourLine(ranking, playerId) };
}

/** The top 3, plus `you` for the socket's player (if it has one). */
export function personalPodium(
  ranking: Ranking,
  playerId: string | undefined,
  snapshot: QuizSnapshot | null,
): PodiumPayload {
  return {
    podium: topRows(ranking.ranked, 3),
    ...(snapshot ? { quizId: snapshot.quizId } : {}),
    feedbackEnabled: snapshot?.feedbackEnabled ?? true,
    ...(snapshot?.credits?.length ? { credits: snapshot.credits } : {}),
    you: yourLine(ranking, playerId),
  };
}

/**
 * The host's standings (#198): every player of the game or the room, with their score in
 * the quiz and in the room. `room` is the room's standings over the games recorded so far;
 * `folded` says whether this game is one of them already (at its podium), so that it is
 * not counted twice.
 */
export function scoreTable(
  quiz: RankedPlayer[],
  room: Pick<RankedPlayer, 'id' | 'score' | 'joinedAt'>[],
  folded: boolean,
): HostScoreRow[] {
  const inQuiz = new Map(quiz.map((p, i) => [p.id, { score: p.score, rank: i + 1 }]));
  const joinedAt = new Map<string, number>();
  const roomScore = new Map<string, number>();
  for (const p of room) {
    joinedAt.set(p.id, p.joinedAt);
    roomScore.set(p.id, p.score);
  }
  for (const p of quiz) {
    joinedAt.set(p.id, p.joinedAt);
    if (!folded) roomScore.set(p.id, (roomScore.get(p.id) ?? 0) + p.score);
  }
  const ids = [...joinedAt.keys()];
  const byRoom = [...ids].sort(
    (a, b) =>
      (roomScore.get(b) ?? 0) - (roomScore.get(a) ?? 0) ||
      (joinedAt.get(a) ?? 0) - (joinedAt.get(b) ?? 0),
  );
  const roomRank = new Map(byRoom.map((id, i) => [id, i + 1]));
  // Someone in the room who does not play this game comes after those who do.
  const notPlaying = ids.filter((id) => !inQuiz.has(id));
  return ids.map((playerId) => ({
    playerId,
    quizScore: inQuiz.get(playerId)?.score ?? 0,
    quizRank: inQuiz.get(playerId)?.rank ?? quiz.length + notPlaying.indexOf(playerId) + 1,
    roomScore: roomScore.get(playerId) ?? 0,
    roomRank: roomRank.get(playerId) ?? ids.length,
  }));
}
