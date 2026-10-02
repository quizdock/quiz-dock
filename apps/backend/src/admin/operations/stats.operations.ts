import { Injectable } from '@nestjs/common';
import { GameState } from '@quiz-dock/contracts';
import { Prisma, QuizStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { GameService } from '../../game/game.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type AdminOperation, defineOperation, done } from './operation';

/** A game being played right now, as the statistics show it. */
export interface LiveGame {
  pin: string;
  title: string;
  host: string;
  /** Its players still waiting for it to start, or playing it. */
  phase: 'lobby' | 'playing';
  /** Players connected right now. */
  players: number;
  /** When its host opened it (ISO). */
  since: string;
  /** The question on screen, from 1, out of how many; null in the lobby. */
  question: { index: number; total: number } | null;
}

export interface LiveStats {
  at: string;
  games: LiveGame[];
  totals: { games: number; lobby: number; playing: number; players: number };
  instance: {
    accounts: { total: number; hosts: number; admins: number };
    quizzes: Record<QuizStatus, number>;
    media: { files: number; bytes: number };
    /** The games kept in the history, and when the last one ended (ISO). */
    history: { sessions: number; lastEndedAt: string | null };
  };
}

const hasRole = (role: UserRole): Prisma.UserWhereInput => ({
  OR: [{ roles: { has: role } }, { assignedRoles: { has: role } }],
});

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
    for (const game of await this.games.listAllActiveGames()) {
      const meta = await this.games.getMeta(game.pin);
      if (!meta) continue;
      const lobby = meta.state === GameState.Lobby;
      games.push({
        pin: game.pin,
        title: game.title,
        host: game.host ?? meta.hostName,
        phase: lobby ? 'lobby' : 'playing',
        players: game.playerCount,
        since: new Date(meta.createdAt).toISOString(),
        question: lobby ? null : { index: meta.currentIndex + 1, total: meta.totalQuestions },
      });
    }
    // The oldest first: the order they were opened in.
    return games.sort((a, b) => a.since.localeCompare(b.since));
  }

  private async instance(): Promise<LiveStats['instance']> {
    const alive: Prisma.UserWhereInput = { deletedAt: null };
    const [total, hosts, admins, quizzes, media, sessions, last] = await Promise.all([
      this.prisma.user.count({ where: alive }),
      this.prisma.user.count({ where: { ...alive, ...hasRole(UserRole.host) } }),
      this.prisma.user.count({ where: { ...alive, ...hasRole(UserRole.admin) } }),
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
}
