import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  ownerId: 'o',
  title: 'Mon quiz',
  description: null,
  coverMediaId: null,
  status: 'draft',
  visibility: 'private',
  language: 'fr',
  questionCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  questions: [
    {
      id: 'qq',
      quizId: 'q1',
      orderIndex: 0,
      type: 'single_choice',
      prompt: 'Capitale de la France ?',
      mediaId: null,
      timeLimitS: 20,
      pointsMode: 'standard',
      numericValue: null,
      numericTolerance: null,
      options: [],
      acceptedAnswers: [],
    },
  ],
  ...over,
});

describe('EditorPage', () => {
  beforeEach(() => localStorage.setItem('roux.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('affiche le quiz, ses métadonnées et ses questions', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');

    expect(await screen.findByText('Éditeur de quiz')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Mon quiz')).toBeInTheDocument();
    expect(screen.getByText('Capitale de la France ?')).toBeInTheDocument();
  });

  it('publie le quiz (PATCH status) au clic', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail() },
      { method: 'PATCH', path: '/quizzes/q1/status', body: detail({ status: 'ready' }) },
    ]);
    renderApp('/quizzes/q1');

    fireEvent.click(await screen.findByText('Publier (prêt)'));
    await waitFor(() => {
      const patched = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes('/quizzes/q1/status') && opts?.method === 'PATCH',
      );
      expect(patched).toBe(true);
    });
  });

  it('désactive la publication si aucune question', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({ questionCount: 0, questions: [] }),
      },
    ]);
    renderApp('/quizzes/q1');
    const publish = await screen.findByText('Publier (prêt)');
    expect(publish).toBeDisabled();
  });
});
