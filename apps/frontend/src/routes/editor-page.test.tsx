import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

vi.mock('../game/game-client', () => ({
  createSession: vi.fn().mockResolvedValue({ pin: '482913' }),
}));

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

  it('affiche les avis des joueurs (moyenne + commentaires) côté propriétaire', async () => {
    // Le handler feedback est listé AVANT /quizzes/q1 (le matcher `includes` prend
    // le premier qui correspond, et l'URL feedback contient aussi « /quizzes/q1 »).
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1/feedback',
        body: {
          count: 2,
          average: 4.5,
          items: [
            { id: 'f1', rating: 5, comment: 'Génial', nickname: 'Zoé', createdAt: '2026-01-02' },
            { id: 'f2', rating: 4, comment: null, nickname: 'Tom', createdAt: '2026-01-01' },
          ],
        },
      },
      { method: 'GET', path: '/quizzes/q1', body: detail() },
    ]);
    renderApp('/quizzes/q1');

    expect(await screen.findByText('Avis des joueurs')).toBeInTheDocument();
    expect(await screen.findByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('Génial')).toBeInTheDocument();
    expect(screen.getByText('Zoé')).toBeInTheDocument();
  });

  it('expose un lien Aperçu ouvrant le quiz dans un nouvel onglet', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');
    const link = await screen.findByRole('link', { name: /Aperçu/ });
    expect(link).toHaveAttribute('href', '/quizzes/q1/preview');
    expect(link).toHaveAttribute('target', '_blank');
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

  it('« Présenter » crée la partie et révèle les 3 accès (contrôle/projection/invitation)', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail({ status: 'ready' }) }]);
    renderApp('/quizzes/q1');

    fireEvent.click(await screen.findByRole('button', { name: /Présenter/ }));

    expect(await screen.findByText(/Partie en cours/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contrôle/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /projection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invitation/i })).toBeInTheDocument();
  });

  it('« Enregistrer » est inactif sans modification, actif dès qu’on édite', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');

    const save = await screen.findByRole('button', { name: /Enregistrer/ });
    expect(save).toBeDisabled();

    fireEvent.change(await screen.findByDisplayValue('Mon quiz'), {
      target: { value: 'Mon quiz révisé' },
    });
    await waitFor(() => expect(save).not.toBeDisabled());
  });

  it('supprimer le quiz demande confirmation (modal) avant le DELETE', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail() },
      { method: 'DELETE', path: '/quizzes/q1', body: {} },
    ]);
    renderApp('/quizzes/q1');

    const deleted = () =>
      fetchMock.mock.calls.some(
        ([url, opts]) =>
          String(url).includes('/quizzes/q1') && (opts as RequestInit)?.method === 'DELETE',
      );

    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer le quiz' }));
    expect(deleted()).toBe(false); // la modal s'ouvre, rien n'est supprimé encore

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(deleted()).toBe(true));
  });

  it('réordonne les questions (↓ → PATCH reorder avec le nouvel ordre)', async () => {
    const q = (id: string, prompt: string, orderIndex: number) => ({
      id,
      quizId: 'q1',
      orderIndex,
      type: 'single_choice',
      prompt,
      mediaId: null,
      timeLimitS: 20,
      pointsMode: 'standard',
      numericValue: null,
      numericTolerance: null,
      options: [],
      acceptedAnswers: [],
    });
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)],
        }),
      },
      { method: 'PATCH', path: '/quizzes/q1/questions/reorder', body: [] },
    ]);
    renderApp('/quizzes/q1');

    const down = await screen.findAllByLabelText('Descendre');
    fireEvent.click(down[0]); // descend la 1re question
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes('/questions/reorder') && opts?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const items = JSON.parse(String((call![1] as RequestInit).body)).items;
      expect(items).toEqual([
        { questionId: 'b', orderIndex: 0 },
        { questionId: 'a', orderIndex: 1 },
      ]);
    });
  });
});
