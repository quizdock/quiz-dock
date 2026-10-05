import { fireEvent, screen, within } from '@testing-library/react';
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
  playedQuestions: 0,
  questions: [],
  players: [],
  room,
});

const room = (standings: unknown) => ({
  name: null,
  hostName: 'Billy',
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
    // No name of its own: the default one, from its host.
    expect(screen.getByText('Salon de Billy')).toBeInTheDocument();
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

  it('a quiz stopped after one question: played out of all, the others not played, the rate out of its answers', async () => {
    const question = (orderIndex: number, played: boolean) => ({
      orderIndex,
      prompt: `Question ${orderIndex + 1}`,
      type: 'single_choice',
      played,
      answerCount: played ? 2 : 0,
      correctCount: played ? 2 : 0,
      successRate: played ? 1 : null,
      avgResponseMs: played ? 1500 : null,
    });
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1/sessions/s1',
        body: {
          ...detail(null),
          status: 'interrupted',
          successRate: 1,
          totalQuestions: 12,
          playedQuestions: 1,
          questions: Array.from({ length: 12 }, (_, i) => question(i, i === 0)),
        },
      },
    ]);
    renderApp('/quizzes/q1/history/s1');
    expect(await screen.findByText('1 question jouée sur 12')).toBeInTheDocument();
    expect(screen.getAllByText('Non jouée')).toHaveLength(11);
    expect(screen.getByText('2 bonnes réponses sur 2')).toBeInTheDocument();
  });
});

describe('Session history (UI system §4)', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sorts its sessions by a column, the latest first by default', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1/sessions',
        body: {
          sessions: [
            summary({
              id: 'a',
              pin: '111111',
              startedAt: '2026-09-20T18:00:00.000Z',
              successRate: 0.9,
            }),
            summary({
              id: 'b',
              pin: '222222',
              startedAt: '2026-09-26T18:00:00.000Z',
              successRate: 0.2,
            }),
          ],
        },
      },
    ]);
    renderApp('/quizzes/q1/history');
    const pins = () => screen.getAllByText(/^PIN \d+/).map((el) => el.textContent?.slice(0, 10));
    await screen.findByText(/PIN 222222/);
    expect(pins()).toEqual(['PIN 222222', 'PIN 111111']);
    // By success: the best first on the first click, then the weakest.
    fireEvent.click(screen.getByRole('button', { name: /Réussite/ }));
    expect(pins()).toEqual(['PIN 111111', 'PIN 222222']);
    fireEvent.click(screen.getByRole('button', { name: /Réussite/ }));
    expect(pins()).toEqual(['PIN 222222', 'PIN 111111']);
  });

  it('with no session yet, leads to presenting the quiz', async () => {
    mockApi([
      { method: 'GET', path: '/quizzes/q1/sessions', body: { sessions: [] } },
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: { id: 'q1', status: 'ready', title: 'Q', questions: [], slides: [] },
      },
    ]);
    renderApp('/quizzes/q1/history');
    expect(await screen.findByRole('button', { name: /Présenter ce quiz/ })).toBeInTheDocument();
  });
});
