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

  it('shows how many sessions of a quiz are running (badge on the card)', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/mine',
        body: [
          { pin: '111111', quizId: 'q1', title: 'Histoire', state: 'LOBBY', playerCount: 0 },
          { pin: '222222', quizId: 'q1', title: 'Histoire', state: 'ANSWERING', playerCount: 3 },
        ],
      },
      {
        method: 'GET',
        path: '/quizzes',
        body: [quiz({ id: 'q1' }), quiz({ id: 'q2', title: 'Géo' })],
      },
    ]);
    renderApp('/quizzes');
    expect(await screen.findByText('2 sessions en cours')).toBeInTheDocument();
    expect(screen.queryByText(/1 session en cours/)).toBeNull();
  });

  it('affiche un état vide sans quiz', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/quizzes');
    expect(await screen.findByText(/Aucun quiz/)).toBeInTheDocument();
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
    renderApp('/quizzes');

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
