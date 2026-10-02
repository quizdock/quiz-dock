import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../test/harness';
import { AdminStatsPage } from './admin-stats-page';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));

const now = new Date().toISOString();
const stats = (games: unknown[]) => ({
  kind: 'result',
  result: {
    outcome: 'done',
    notes: [],
    data: {
      at: now,
      games,
      totals: { games: games.length, lobby: 1, playing: games.length - 1, players: 7 },
      instance: {
        accounts: { total: 12, hosts: 4, admins: 1 },
        quizzes: { draft: 3, ready: 9, archived: 2 },
        media: { files: 32, bytes: 5_800_000 },
        history: { sessions: 41, lastEndedAt: now },
      },
    },
  },
});

const history = {
  kind: 'result',
  result: {
    outcome: 'done',
    notes: [],
    data: {
      from: '2025-11-01T00:00:00.000Z',
      months: [
        { month: '2026-08', games: 3, players: 20, successRate: 0.62 },
        { month: '2026-09', games: 0, players: 0, successRate: null },
      ],
      totals: {
        games: 3,
        players: 20,
        successRate: 0.62,
        participants: { withAccount: 5, guests: 15 },
      },
      quizzes: [{ id: 'q1', name: 'Capitales', owner: 'Billy', games: 2, players: 14 }],
      hosts: [{ id: 'u1', name: 'Claire', owner: null, games: 3, players: 20 }],
      oldest: '2026-08-03T10:00:00.000Z',
    },
  },
};

function renderPage(games: unknown[]) {
  mockApi([
    { method: 'POST', path: '/admin/operations/stats.live', body: stats(games) },
    { method: 'POST', path: '/admin/operations/stats.history', body: history },
  ]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminStatsPage />
    </QueryClientProvider>,
  );
}

describe('AdminStatsPage', () => {
  it('lists the games played right now: their host, where they are, their players', async () => {
    renderPage([
      {
        pin: '123456',
        title: 'Capitales',
        host: 'Claire',
        phase: 'playing',
        players: 5,
        since: now,
        question: { index: 3, total: 10 },
      },
      {
        pin: '654321',
        title: 'Fleuves',
        host: 'Marc',
        phase: 'lobby',
        players: 2,
        since: now,
        question: null,
      },
    ]);
    const row = (await screen.findByText('Capitales')).closest('tr')!;
    expect(within(row).getByText('Claire')).toBeInTheDocument();
    expect(within(row).getByText('Question 3 sur 10')).toBeInTheDocument();
    expect(within(row).getByText('PIN 123456')).toBeInTheDocument();
    const lobby = screen.getByText('Fleuves').closest('tr')!;
    expect(within(lobby).getByText('Salle d’attente')).toBeInTheDocument();
    expect(screen.getByText('1 en salle d’attente · 1 en jeu')).toBeInTheDocument();
  });

  it('says when nothing is played, and shows the instance at a glance', async () => {
    renderPage([]);
    expect(await screen.findByText('Aucune partie en cours.')).toBeInTheDocument();
    expect(screen.getByText('4 animateurs · 1 administrateur')).toBeInTheDocument();
    expect(screen.getByText('3 brouillons · 2 archivés')).toBeInTheDocument();
    expect(screen.getByText('32 fichiers')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it('shows the last twelve months by month, the most played quizzes, the most active hosts', async () => {
    renderPage([]);
    const months = (await screen.findByText('Par mois')).closest('table')!;
    expect(within(months).getByText('août 2026')).toBeInTheDocument();
    expect(within(months).getByText('62 %')).toBeInTheDocument();
    const quizzes = screen.getByText('Quiz les plus joués').closest('table')!;
    expect(within(quizzes).getByText('Capitales')).toBeInTheDocument();
    expect(within(quizzes).getByText('Billy')).toBeInTheDocument();
    const hosts = screen.getByText('Animateurs les plus actifs').closest('table')!;
    expect(within(hosts).getByText('Claire')).toBeInTheDocument();
    expect(screen.getByText('25 %')).toBeInTheDocument();
    expect(screen.getByText('5 avec un compte · 15 invités')).toBeInTheDocument();
  });
});
