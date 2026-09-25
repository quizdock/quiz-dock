import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, setMarkdownField } from '../test/harness';

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
  language: 'fr',
  questionCount: 1,
  license: null,
  tags: [],
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
  slides: [],
  ...over,
});

describe('EditorPage', () => {
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
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('affiche le quiz, ses métadonnées et ses questions', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');

    expect(await screen.findByDisplayValue('Mon quiz')).toBeInTheDocument();
    // Listed in the sequence and opened in the editing pane (first item is auto-selected).
    expect(screen.getAllByText('Capitale de la France ?').length).toBeGreaterThanOrEqual(1);
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
          distribution: [0, 0, 0, 1, 1],
          items: [
            { id: 'f1', rating: 5, comment: 'Génial', nickname: 'Zoé', createdAt: '2026-01-02' },
          ],
          page: 1,
          pageSize: 1,
          total: 2,
        },
      },
      { method: 'GET', path: '/quizzes/q1', body: detail() },
    ]);
    renderApp('/quizzes/q1');

    // Plus de tiroir « Réglages » : le résumé des avis est à même la page.
    expect(await screen.findByText('4.5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir les 2 avis/ })).toHaveAttribute(
      'href',
      '/quizzes/q1/reviews',
    );
  });

  it('expose un lien Aperçu ouvrant le quiz dans un nouvel onglet', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');
    const link = await screen.findByRole('link', { name: /Aperçu/ });
    expect(link).toHaveAttribute('href', '/quizzes/q1/preview');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('exports the quiz as a bundle download (authenticated fetch, server filename)', async () => {
    const fetchMock = mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    const json = fetchMock.getMockImplementation() as (
      u: string,
      o?: RequestInit,
    ) => Promise<Response>;
    let exportHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (!String(url).includes('/quizzes/q1/export')) return json(url, opts);
      exportHeaders = opts?.headers as Record<string, string>;
      return new Response(new Blob(['PK']), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="histoire.quizdock.zip"',
        },
      });
    });
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderApp('/quizzes/q1');
    fireEvent.click(await screen.findByRole('button', { name: /Exporter/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByText(/Impossible d’exporter/)).toBeNull();
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('histoire.quizdock.zip');
    expect(exportHeaders?.['X-Local-User']).toBeDefined();
    click.mockRestore();
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

  it('sets the licence and the tags of the quiz (PUT), a typed tag turned into kebab-case', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail({ tags: ['histoire'] }) },
      { method: 'PUT', path: '/quizzes/q1', body: detail() },
    ]);
    renderApp('/quizzes/q1');
    const patches = () =>
      fetchMock.mock.calls
        .filter(([url, opts]) => String(url).endsWith('/quizzes/q1') && opts?.method === 'PUT')
        .map(([, opts]) => JSON.parse(String(opts?.body)) as Record<string, unknown>);

    fireEvent.change(await screen.findByLabelText('Licence', { selector: 'select' }), {
      target: { value: 'CC-BY-4.0' },
    });
    await waitFor(() => expect(patches()).toContainEqual({ license: 'CC-BY-4.0' }));

    const input = screen.getByPlaceholderText('Ajouter un tag…');
    fireEvent.change(input, { target: { value: 'Pop Culture ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(patches()).toContainEqual({ tags: ['histoire', 'pop-culture'] }));

    fireEvent.click(screen.getByLabelText('Retirer le tag histoire'));
    await waitFor(() => expect(patches()).toContainEqual({ tags: [] }));
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

  it('« Présenter » crée la session et ouvre sa console ; les sessions en cours du quiz sont listées', async () => {
    mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail({ status: 'ready' }) },
      {
        method: 'GET',
        path: '/games/mine',
        body: [
          { pin: '111111', quizId: 'q1', title: 'Mon quiz', state: 'LOBBY', playerCount: 3 },
          { pin: '222222', quizId: 'other', title: 'Autre', state: 'LOBBY', playerCount: 0 },
        ],
      },
    ]);
    const { router } = renderApp('/quizzes/q1');

    // Only this quiz's sessions, each linking to its console.
    expect(await screen.findByText('1 session en cours')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /111111/ })).toHaveAttribute(
      'href',
      '/session/111111/console',
    );
    expect(screen.queryByText(/222222/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Présenter/ }));
    // createSession is mocked (pin 482913): the editor hands over to the session's console.
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/482913/console'));
  });

  it('title is edited in place: « Enregistrer » only appears once something changed', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');

    const title = await screen.findByDisplayValue('Mon quiz');
    // The header form is the first form on the page (the item form has its own Save).
    const header = within(title.closest('form') as HTMLElement);
    expect(header.queryByRole('button', { name: /Enregistrer/ })).toBeNull();

    fireEvent.change(title, { target: { value: 'Mon quiz révisé' } });
    expect(await header.findByRole('button', { name: /Enregistrer/ })).toBeEnabled();
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

    // La zone dangereuse est visible, plus cachée derrière un tiroir.
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer le quiz' }));
    expect(deleted()).toBe(false); // la modal s'ouvre, rien n'est supprimé encore

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(deleted()).toBe(true));
  });

  it('reorders the sequence (↓ → PATCH items/reorder with the new order)', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)],
        }),
      },
      { method: 'PATCH', path: '/quizzes/q1/items/reorder', body: [] },
    ]);
    renderApp('/quizzes/q1');

    const down = await screen.findAllByLabelText('Descendre');
    fireEvent.click(down[0]); // descend la 1re question
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes('/items/reorder') && opts?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const items = JSON.parse(String((call![1] as RequestInit).body)).items;
      expect(items).toEqual([
        { kind: 'question', id: 'b' },
        { kind: 'question', id: 'a' },
      ]);
    });
  });

  it('lists slides in the sequence before their anchor question and moves them with it (#7)', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)],
          slides: [
            {
              id: 's1',
              quizId: 'q1',
              beforeQuestionId: 'b',
              orderIndex: 0,
              blocks: [{ type: 'heading', id: 'h', text: 'Interlude', level: 1 }],
              mediaId: null,
              textTone: 'light',
              textOutline: false,
              displayDelayS: null,
            },
          ],
        }),
      },
      { method: 'PATCH', path: '/quizzes/q1/items/reorder', body: [] },
    ]);
    renderApp('/quizzes/q1');

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Première'),
      expect.stringContaining('Interlude'),
      expect.stringContaining('Seconde'),
    ]);
    const up = screen.getAllByLabelText('Monter');
    fireEvent.click(up[1]); // the slide moves above « Première »
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes('/items/reorder') && opts?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body)).items).toEqual([
        { kind: 'slide', id: 's1' },
        { kind: 'question', id: 'a' },
        { kind: 'question', id: 'b' },
      ]);
    });
  });

  it('guards unsaved edits: leaving a dirty item form asks before discarding', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)],
        }),
      },
    ]);
    renderApp('/quizzes/q1');

    fireEvent.click(await screen.findByRole('button', { name: /Première/ }));
    // Two « Enregistrer »: the settings one (folded details, first in DOM) and the item form's.
    const save = (await screen.findAllByRole('button', { name: 'Enregistrer' })).at(-1)!;
    expect(save).toBeDisabled(); // nothing changed yet
    setMarkdownField('Énoncé', 'Première (modifiée)');
    expect(save).toBeEnabled();

    // Opening another item while dirty → confirm dialog, the form stays until confirmed.
    fireEvent.click(screen.getByRole('button', { name: /Seconde/ }));
    // The editing sheet is a <dialog> too (and nests the form's own closed confirm);
    // the editor-level confirm is the last open dialog in the DOM.
    const openDialog = await waitFor(() => {
      const d = [...document.querySelectorAll('dialog[open]')]
        .filter((x) => x.textContent?.includes('Abandonner les modifications ?'))
        .at(-1);
      if (!d) throw new Error('no open confirm dialog');
      return d as HTMLElement;
    });
    expect(openDialog.textContent).toContain('Abandonner les modifications ?');
    fireEvent.click(within(openDialog).getByRole('button', { name: 'Abandonner' }));
    await waitFor(() => expect(screen.getByLabelText('Énoncé').textContent).toContain('Seconde'));
  });
});
