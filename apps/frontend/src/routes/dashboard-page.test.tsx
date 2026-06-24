import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  ownerId: 'o',
  title: 'Histoire',
  description: null,
  coverMediaId: null,
  status: 'draft',
  visibility: 'private',
  language: 'fr',
  questionCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  ...over,
});

describe('DashboardPage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('affiche les quiz du formateur', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [quiz({ title: 'Histoire' })] }]);
    renderApp('/dashboard');
    expect(await screen.findByText('Histoire')).toBeInTheDocument();
  });

  it('affiche un état vide sans quiz', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/dashboard');
    expect(await screen.findByText(/Aucun quiz/)).toBeInTheDocument();
  });

  it('crée un quiz au clic sur « Nouveau quiz »', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes', body: [] },
      { method: 'POST', path: '/quizzes', status: 201, body: quiz() },
    ]);
    renderApp('/dashboard');
    fireEvent.click(await screen.findByText('Nouveau quiz'));
    await waitFor(() => {
      const posted = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes('/quizzes') && opts?.method === 'POST',
      );
      expect(posted).toBe(true);
    });
  });

  it('arrête une session en cours depuis la liste (confirmation → POST end)', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes', body: [] },
      {
        method: 'GET',
        path: '/games/mine',
        body: [{ pin: '482913', title: 'Histoire', state: 'LOBBY', playerCount: 2 }],
      },
      { method: 'POST', path: '/games/482913/end', status: 204, body: {} },
    ]);
    renderApp('/dashboard');

    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter la session' }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes('/games/482913/end') && opts?.method === 'POST',
      );
      expect(posted).toBe(true);
    });
  });
});
