import { Injectable } from '@nestjs/common';
import {
  GameState,
  type HistoryMonth,
  type HistoryRank,
  type HistoryStats,
  type LiveGame,
  type LiveStats,
} from '@quiz-dock/contracts';
import { Prisma, QuizStatus, UserRole } from '@prisma/client';
import { holdsRole } from '../../users/user-filters';
import { z } from 'zod';
import { GameService } from '../../game/game.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type AdminOperation, defineOperation, done } from './operation';

/** The months the history shows, and the ranks' length. */
export const HISTORY_MONTHS = 12;
export const HISTORY_TOP = 5;

/**
 * The instance's statistics: what is played right now, and the state of the
 * instance at a glance. Read often (the page polls it): cheap counts only,
 * never the media volume's scan the media page does.
 */
@Injectable()
export class StatsOperations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GameService,
  ) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'stats.live',
        domain: 'instance',
        category: 'stats',
        effect: 'read',
        summary:
          'What is played right now — every game, its host, its players — and the instance at a glance: accounts, quizzes, media, history.',
        params: z.object({}),
        run: async () => done(await this.live()),
      }),
      defineOperation({
        id: 'stats.history',
        domain: 'instance',
        category: 'stats',
        effect: 'read',
        summary: `How the instance was used over the last ${HISTORY_MONTHS} months: games and players by month, the most played quizzes, the most active hosts, players with an account or as guests.`,
        params: z.object({}),
        run: async () => done(await this.history()),
      }),
    ];
  }

  async live(): Promise<LiveStats> {
    const [games, instance] = await Promise.all([this.liveGames(), this.instance()]);
    const lobby = games.filter((g) => g.phase === 'lobby').length;
    return {
      at: new Date().toISOString(),
      games,
      totals: {
        games: games.length,
        lobby,
        playing: games.length - lobby,
        players: games.reduce((n, g) => n + g.players, 0),
      },
      instance,
    };
  }

  private async liveGames(): Promise<LiveGame[]> {
    const games: LiveGame[] = [];
    // What the listing read already: no second read of each game's state.
    for (const game of await this.games.listAllActiveGames()) {
      const lobby = game.state === GameState.Lobby;
      games.push({
        pin: game.pin,
        title: game.title,
        host: game.host ?? '',
        phase: lobby ? 'lobby' : 'playing',
        players: game.playerCount,
        since: new Date(game.createdAt).toISOString(),
        question: lobby ? null : { index: game.currentIndex + 1, total: game.totalQuestions },
      });
    }
    // The oldest first: the order they were opened in.
    return games.sort((a, b) => a.since.localeCompare(b.since));
  }

  private async instance(): Promise<LiveStats['instance']> {
    const alive: Prisma.UserWhereInput = { deletedAt: null };
    const [total, hosts, admins, quizzes, media, sessions, last] = await Promise.all([
      this.prisma.user.count({ where: alive }),
      this.prisma.user.count({ where: { ...alive, ...holdsRole(UserRole.host) } }),
      this.prisma.user.count({ where: { ...alive, ...holdsRole(UserRole.admin) } }),
      this.prisma.quiz.groupBy({ by: ['status'], _count: true }),
      // One file counted once, however many media share it (the media page's own key).
      this.prisma.$queryRaw<Array<{ files: number; bytes: bigint | null }>>`
        SELECT COUNT(*)::int AS files, SUM(bytes) AS bytes FROM (
          SELECT MAX(m.size_bytes) AS bytes FROM media_asset m
          GROUP BY COALESCE(m.blob_sha256, m.id)
        ) f`,
      this.prisma.gameSessionLog.count(),
      this.prisma.gameSessionLog.findFirst({
        orderBy: { endedAt: 'desc' },
        select: { endedAt: true },
      }),
    ]);
    const byStatus = Object.fromEntries(Object.values(QuizStatus).map((s) => [s, 0])) as Record<
      QuizStatus,
      number
    >;
    for (const row of quizzes) byStatus[row.status] = row._count;
    return {
      accounts: { total, hosts, admins },
      quizzes: byStatus,
      media: { files: media[0]?.files ?? 0, bytes: Number(media[0]?.bytes ?? 0) },
      history: { sessions, lastEndedAt: last?.endedAt.toISOString() ?? null },
    };
  }

  async history(now = new Date()): Promise<HistoryStats> {
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (HISTORY_MONTHS - 1), 1),
    );
    const since = Prisma.sql`started_at >= ${from}`;
    const [months, totals, participants, quizzes, hosts, oldest] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ month: string; games: number; players: number; rate: number | null }>
      >`
        SELECT to_char(date_trunc('month', started_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
               COUNT(*)::int AS games, COALESCE(SUM(player_count), 0)::int AS players,
               (SUM(success_rate * player_count) / NULLIF(SUM(player_count)
                  FILTER (WHERE success_rate IS NOT NULL), 0))::float AS rate
        FROM game_session_log WHERE ${since} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ games: number; players: number; rate: number | null }>>`
        SELECT COUNT(*)::int AS games, COALESCE(SUM(player_count), 0)::int AS players,
               (SUM(success_rate * player_count) / NULLIF(SUM(player_count)
                  FILTER (WHERE success_rate IS NOT NULL), 0))::float AS rate
        FROM game_session_log WHERE ${since}`,
      this.prisma.$queryRaw<Array<{ with_account: number; guests: number }>>`
        SELECT COUNT(*) FILTER (WHERE p.user_id IS NOT NULL)::int AS with_account,
               COUNT(*) FILTER (WHERE p.user_id IS NULL)::int AS guests
        FROM player_result_log p JOIN game_session_log g ON g.id = p.session_log_id
        WHERE g.started_at >= ${from}`,
      this.rank(
        Prisma.sql`g.quiz_id`,
        Prisma.sql`q.title`,
        Prisma.sql`o.display_name`,
        Prisma.sql`JOIN quiz q ON q.id = g.quiz_id JOIN "user" o ON o.id = q.owner_id`,
        from,
      ),
      this.rank(
        Prisma.sql`g.host_id`,
        Prisma.sql`u.display_name`,
        Prisma.sql`NULL::text`,
        Prisma.sql`JOIN "user" u ON u.id = g.host_id`,
        from,
      ),
      this.prisma.gameSessionLog.findFirst({
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      }),
    ]);
    // Every month of the period, the quiet ones too, from the first one played.
    const played = new Map(months.map((m) => [m.month, m]));
    const all: HistoryMonth[] = [];
    for (let i = 0; i < HISTORY_MONTHS; i++) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
      const key = d.toISOString().slice(0, 7);
      const m = played.get(key);
      if (!m && all.length === 0) continue;
      all.push({
        month: key,
        games: m?.games ?? 0,
        players: m?.players ?? 0,
        successRate: m?.rate ?? null,
      });
    }
    return {
      from: from.toISOString(),
      months: all,
      totals: {
        games: totals[0]?.games ?? 0,
        players: totals[0]?.players ?? 0,
        successRate: totals[0]?.rate ?? null,
        participants: {
          withAccount: participants[0]?.with_account ?? 0,
          guests: participants[0]?.guests ?? 0,
        },
      },
      quizzes,
      hosts,
      oldest: oldest?.startedAt.toISOString() ?? null,
    };
  }

  /** The quizzes or the hosts that played the most games since `from`. */
  private rank(
    key: Prisma.Sql,
    name: Prisma.Sql,
    owner: Prisma.Sql,
    join: Prisma.Sql,
    from: Date,
  ): Promise<HistoryRank[]> {
    return this.prisma.$queryRaw<HistoryRank[]>`
      SELECT ${key} AS id, MIN(${name}) AS name, MIN(${owner}) AS owner, COUNT(*)::int AS games,
             COALESCE(SUM(g.player_count), 0)::int AS players
      FROM game_session_log g ${join}
      WHERE g.started_at >= ${from}
      GROUP BY ${key} ORDER BY games DESC, players DESC LIMIT ${HISTORY_TOP}`;
  }
}
