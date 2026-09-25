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
  language: 'fr',
  questionCount: 0,
  license: null,
  tags: [],
  editable: true,
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

  it('affiche les quiz du animateur', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [quiz({ title: 'Histoire' })] }]);
    renderApp('/quizzes');
    expect(await screen.findByText('Histoire')).toBeInTheDocument();
  });

  it('affiche un état vide sans quiz', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/quizzes');
    expect(await screen.findByText(/Aucun quiz/)).toBeInTheDocument();
  });

  it('sans quiz, propose les deux façons de commencer', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/quizzes');

    expect(await screen.findByText(/Aucun quiz pour l’instant/)).toBeInTheDocument();
    // Partir de rien, ou partir d'un modèle : les exemples ne sont plus versés d'office.
    expect(screen.getAllByRole('button', { name: /Nouveau quiz/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Parcourir les modèles/ })).toBeInTheDocument();
  });

  it('crée un quiz au clic sur « Nouveau quiz »', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes', body: [] },
      { method: 'POST', path: '/quizzes', status: 201, body: quiz() },
    ]);
    renderApp('/quizzes');
    fireEvent.click(await screen.findByText('Nouveau quiz'));
    await waitFor(() => {
      const posted = fetchMock.mock.calls.some(
        ([url, opts]) => String(url).includes('/quizzes') && opts?.method === 'POST',
      );
      expect(posted).toBe(true);
    });
  });

  it('imports a bundle (multipart POST) and opens the new draft in the editor', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/imported',
        body: { ...quiz({ id: 'imported', title: 'Importé' }), questions: [], slides: [] },
      },
      { method: 'GET', path: '/quizzes', body: [] },
      {
        method: 'POST',
        path: '/quizzes/import',
        status: 201,
        body: quiz({ id: 'imported', title: 'Importé' }),
      },
    ]);
    renderApp('/quizzes');
    const input = (await screen.findByLabelText('Importer')) as HTMLInputElement;
    const file = new File(['{}'], 'geo.quizdock.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes('/quizzes/import') && opts?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toBeInstanceOf(FormData);
      expect((call?.[1]?.body as FormData).get('file')).toBeInstanceOf(File);
    });
    expect(await screen.findByDisplayValue('Importé')).toBeInTheDocument();
  });

  it('shows the tokenised import error', async () => {
    mockApi([
      { method: 'GET', path: '/quizzes', body: [] },
      {
        method: 'POST',
        path: '/quizzes/import',
        status: 400,
        body: { code: 'import.media_missing', params: { path: 'media/a.png' } },
      },
    ]);
    renderApp('/quizzes');
    const input = (await screen.findByLabelText('Importer')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'q.json')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('media/a.png');
  });

  it('filtre, trie et pagine une banque qui dépasse un écran', async () => {
    // 25 quiz : au-delà d'une page (20), de quoi exercer les trois contrôles.
    const many = Array.from({ length: 25 }, (_, i) =>
      quiz({
        id: `q${i}`,
        title: `Quiz ${String(i).padStart(2, '0')}`,
        status: i === 0 ? 'ready' : 'draft',
        questionCount: i,
        updatedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    mockApi([{ method: 'GET', path: '/quizzes', body: many }]);
    renderApp('/quizzes');

    expect(await screen.findByText('25 quiz')).toBeInTheDocument();
    expect(screen.getByText('Page 1 sur 2')).toBeInTheDocument();

    // Filtre par statut : un seul quiz est « prêt ».
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'ready' } });
    await waitFor(() => expect(screen.getByText('1 quiz')).toBeInTheDocument());
    expect(screen.queryByText('Page 1 sur 2')).toBeNull();

    // Recherche : insensible à la casse et aux accents, et elle ramène à la page 1.
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'all' } });
    fireEvent.change(screen.getByPlaceholderText('Rechercher un quiz'), {
      target: { value: 'quiz 1' },
    });
    await waitFor(() => expect(screen.getByText('10 quiz')).toBeInTheDocument());

    // Aucun résultat : on le dit, au lieu d'une liste vide sans explication.
    fireEvent.change(screen.getByPlaceholderText('Rechercher un quiz'), {
      target: { value: 'introuvable' },
    });
    expect(await screen.findByText(/Aucun quiz ne correspond/)).toBeInTheDocument();
  });

  it('tourne les pages sans perdre le filtre', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      quiz({ id: `q${i}`, title: `Quiz ${String(i).padStart(2, '0')}` }),
    );
    mockApi([{ method: 'GET', path: '/quizzes', body: many }]);
    renderApp('/quizzes');

    expect(await screen.findByText('Quiz 00')).toBeInTheDocument();
    expect(screen.queryByText('Quiz 24')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(await screen.findByText('Quiz 24')).toBeInTheDocument();
    expect(screen.getByText('Page 2 sur 2')).toBeInTheDocument();
  });
});
