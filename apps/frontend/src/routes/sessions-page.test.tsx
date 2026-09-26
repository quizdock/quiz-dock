import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const summary = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  pin: '123456',
  status: 'ended',
  playerCount: 2,
  successRate: 0.5,
  personalTracking: true,
  fullCapture: false,
  startedAt: '2026-09-26T18:00:00.000Z',
  endedAt: '2026-09-26T18:05:00.000Z',
  roomSize: null,
  ...over,
});

const detail = (room: unknown) => ({
  ...summary({ roomSize: room ? 2 : null }),
  quizTitle: 'Manche A',
  language: 'fr',
  totalQuestions: 0,
  questions: [],
  players: [],
  room,
});

const room = (standings: unknown) => ({
  sessions: [
    {
      id: 's1',
      quizId: 'q1',
      quizTitle: 'Manche A',
      startedAt: '2026-09-26T18:00:00.000Z',
      current: true,
    },
    {
      id: 's2',
      quizId: 'q2',
      quizTitle: 'Manche B',
      startedAt: '2026-09-26T18:10:00.000Z',
      current: false,
    },
  ],
  standings,
});

describe('Session history: the room (#89)', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('marks a session played in a room in the list', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1/sessions',
        body: { sessions: [summary({ roomSize: 2 })] },
      },
    ]);
    renderApp('/quizzes/q1/history');
    expect(await screen.findByText('Salon · 2 quiz')).toBeInTheDocument();
  });

  it('shows the room’s other quizzes and its standings in the detail', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1/sessions/s1',
        body: detail(
          room([
            {
              rank: 1,
              nickname: 'Hana',
              score: 1800,
              correctCount: 2,
              answeredCount: 2,
              avgResponseMs: 1500,
              maxStreak: 1,
              quizzes: 2,
            },
          ]),
        ),
      },
    ]);
    renderApp('/quizzes/q1/history/s1');
    const other = await screen.findByRole('link', { name: 'Manche B' });
    expect(other).toHaveAttribute('href', '/quizzes/q2/history/s2');
    expect(screen.getByText('(cette session)')).toBeInTheDocument();
    const row = screen.getByText('Hana').closest('tr')!;
    expect(within(row).getByText('1800')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exporter le classement/ })).toBeEnabled();
  });

  it('says why a room has no standings when a session did not track participants', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1/sessions/s1', body: detail(room(null)) }]);
    renderApp('/quizzes/q1/history/s1');
    expect(await screen.findByText(/Pas de classement du salon/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exporter le classement/ })).toBeNull();
  });

  it('reads a session played alone as before', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1/sessions/s1', body: detail(null) }]);
    renderApp('/quizzes/q1/history/s1');
    expect(await screen.findByText('Manche A')).toBeInTheDocument();
    expect(screen.queryByText('Salon')).toBeNull();
  });
});
