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

/** The owner filter on everyone's quizzes, as a tab that chose it would find it. */
const everyone = () => sessionStorage.setItem('quizdock.quizzes.filter.owner', JSON.stringify(''));

describe('DashboardPage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('affiche les quiz du animateur', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [quiz({ title: 'Histoire' })] }]);
    renderApp('/quizzes');
    expect(await screen.findByText('Histoire')).toBeInTheDocument();
  });

  it('a quiz another host shares: a lock, read-only, and « Créer un quiz à partir de ceci »', async () => {
    const fetchMock = mockApi([
      {
        method: 'POST',
        path: '/quizzes/shared/duplicate',
        status: 201,
        body: quiz({ id: 'copy' }),
      },
      {
        method: 'GET',
        path: '/quizzes/copy',
        body: { ...quiz({ id: 'copy' }), questions: [], slides: [] },
      },
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz({
            id: 'shared',
            title: 'Partagé',
            status: 'ready',
            editable: false,
            shared: true,
            ownerName: 'Alice',
          }),
        ],
      },
    ]);
    everyone();
    renderApp('/quizzes');
    expect(await screen.findByText('Partagé')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Lecture seule : partagé par un autre animateur'),
    ).toBeInTheDocument();
    // Nothing of an owner's: no editing, no presenting.
    expect(screen.queryByRole('button', { name: /Éditer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Présenter/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Créer un quiz à partir de ceci/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/quizzes/shared/duplicate') && opts?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('one action per card, the rest in its ⋮; the card opens the quiz (UI system §3)', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz({ id: 'd1', title: 'Brouillon' }),
          quiz({ id: 'r1', title: 'Prêt', status: 'ready' }),
        ],
      },
      { method: 'PATCH', path: '/quizzes/r1/status', body: quiz({ id: 'r1', status: 'archived' }) },
      { method: 'DELETE', path: '/quizzes/d1', body: {} },
    ]);
    const { router } = renderApp('/quizzes');

    // The title's link is the card's.
    expect(await screen.findByRole('link', { name: 'Brouillon' })).toHaveAttribute(
      'href',
      '/quizzes/d1',
    );
    expect(screen.getByRole('button', { name: /Présenter/ })).toBeInTheDocument();
    const publish = screen.getByRole('button', { name: /Publier pour présenter/ });

    // Archive, from the ready one's ⋮.
    fireEvent.click(screen.getByRole('button', { name: 'Actions pour « Prêt »' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archiver' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, o]) =>
            String(url).endsWith('/quizzes/r1/status') && (o as RequestInit)?.method === 'PATCH',
        ),
      ).toBe(true),
    );

    // Delete asks first.
    fireEvent.click(screen.getByRole('button', { name: 'Actions pour « Brouillon »' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le quiz' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit)?.method === 'DELETE')).toBe(
        true,
      ),
    );

    // Publishing a draft happens in its editor (which lists what is missing, if anything).
    fireEvent.click(publish);
    await waitFor(() => expect(router.state.location.pathname).toBe('/quizzes/d1'));
  });

  it('filters by owner: me first and by default, then the others, then everyone', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz({ id: 'mine', title: 'Le mien' }),
          quiz({ id: 'b', title: 'De Billy', editable: false, shared: true, ownerName: 'Billy' }),
          quiz({ id: 'a', title: 'D’Alice', editable: false, shared: true, ownerName: 'Alice' }),
        ],
      },
    ]);
    renderApp('/quizzes');
    await screen.findByText('Le mien');
    const select = screen.getByLabelText('Propriétaire') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Moi', 'Alice', 'Billy', 'Tous']);
    // Mine by default: the others' quizzes wait behind the filter.
    expect(select.value).toBe(select.options[0].value);
    expect(screen.queryByText('De Billy')).toBeNull();
    fireEvent.change(select, { target: { value: 'Billy' } });
    expect(screen.getByText('De Billy')).toBeInTheDocument();
    expect(screen.queryByText('Le mien')).toBeNull();
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByText('Le mien')).toBeInTheDocument();
    expect(screen.getByText('D’Alice')).toBeInTheDocument();
  });

  it('keeps the filters for the tab: back on the list, it is as it was left', async () => {
    const body = [
      quiz({ id: 'mine', title: 'Le mien' }),
      quiz({ id: 'b', title: 'De Billy', editable: false, shared: true, ownerName: 'Billy' }),
    ];
    mockApi([{ method: 'GET', path: '/quizzes', body }]);
    const first = renderApp('/quizzes');
    await screen.findByText('Le mien');
    fireEvent.change(screen.getByLabelText('Propriétaire'), { target: { value: 'Billy' } });
    first.unmount();
    renderApp('/quizzes');
    expect(await screen.findByText('De Billy')).toBeInTheDocument();
    expect(screen.queryByText('Le mien')).toBeNull();
  });

  it('many owners: the owner filter becomes a list to type into', async () => {
    const names = ['Ana', 'Ben', 'Cléo', 'Dan', 'Eva', 'Fred', 'Gus', 'Hana', 'Ivo'];
    mockApi([
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz({ id: 'mine', title: 'Le mien' }),
          ...names.map((n) =>
            quiz({ id: n, title: `Quiz ${n}`, editable: false, shared: true, ownerName: n }),
          ),
        ],
      },
    ]);
    renderApp('/quizzes');
    await screen.findByText('Le mien');
    const box = screen.getByRole('combobox', { name: 'Propriétaire' });
    fireEvent.change(box, { target: { value: 'cleo' } });
    fireEvent.click(screen.getByRole('option', { name: 'Cléo' }));
    await waitFor(() => expect(screen.queryByText('Le mien')).toBeNull());
    expect(screen.getByText('Quiz Cléo')).toBeInTheDocument();
  });

  it('narrows by language and tag, and shows what tells quizzes apart', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz({ id: 'a', title: 'Capitales', tags: ['geo'], questionCount: 3 }),
          quiz({ id: 'b', title: 'Capitals', language: 'en', tags: ['geo'], license: 'CC-BY-4.0' }),
          quiz({ id: 'c', title: 'Fromages', tags: ['food'] }),
        ],
      },
    ]);
    renderApp('/quizzes');
    expect(await screen.findByText('Capitales')).toBeInTheDocument();
    expect(screen.getByText(/3 questions/)).toBeInTheDocument();
    expect(screen.getByText(/CC-BY-4.0/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Langue'), { target: { value: 'fr' } });
    expect(screen.queryByText('Capitals')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'geo' }));
    expect(screen.getByText('Capitales')).toBeInTheDocument();
    expect(screen.queryByText('Fromages')).toBeNull();
  });

  it('switches to a grid, and remembers it in this browser', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [quiz({ title: 'Histoire' })] }]);
    renderApp('/quizzes');
    await screen.findByText('Histoire');
    fireEvent.click(screen.getByRole('button', { name: 'Grille' }));
    expect(screen.getByRole('button', { name: 'Grille' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('quizdock.quizzes.view')).toBe('grid');
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

  it('crée un quiz au clic sur « Nouveau quiz », avec une slide d’intro et une question à compléter', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes', body: [] },
      { method: 'POST', path: /\/slides$/, status: 201, body: { id: 'intro' } },
      { method: 'POST', path: /\/questions$/, status: 201, body: { id: 'first' } },
      { method: 'PATCH', path: /\/items\/reorder$/, body: [] },
      { method: 'POST', path: '/quizzes', status: 201, body: quiz({ id: 'fresh' }) },
    ]);
    renderApp('/quizzes');
    const create = await screen.findByText('Nouveau quiz');
    fireEvent.click(create);
    fireEvent.click(create); // a double click makes one quiz
    const bodyOf = (suffix: string) => {
      const call = fetchMock.mock.calls.find(
        ([url, opts]) =>
          String(url).endsWith(`/quizzes/fresh/${suffix}`) && opts?.method === 'POST',
      );
      return call ? JSON.parse(String(call[1]?.body)) : null;
    };
    await waitFor(() => expect(bodyOf('slides')).not.toBeNull());
    // The intro names the quiz through its variables, on a gradient drawn at random.
    const slide = bodyOf('slides');
    expect(slide.blocks.map((b: { text?: string; md?: string }) => b.text ?? b.md)).toEqual([
      '{title}',
      '{description}',
    ]);
    expect(slide.gradient.colors).toHaveLength(2);
    // The intro first, then the question.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([url]) => String(url).endsWith('/quizzes/fresh/items/reorder')),
      ).toBeTruthy(),
    );
    const reorder = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/quizzes/fresh/items/reorder'),
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url, opts]) => String(url).endsWith('/quizzes') && opts?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(JSON.parse(String(reorder?.[1]?.body)).items).toEqual([
      { kind: 'slide', id: 'intro' },
      { kind: 'question', id: 'first' },
    ]);
    expect(bodyOf('questions')).toMatchObject({
      type: 'single_choice',
      prompt: 'Votre question ?',
      options: [
        { text: 'Réponse 1', isCorrect: true },
        { text: 'Réponse 2', isCorrect: false },
      ],
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

  it('opens a Kahoot sheet’s draft with what became of its rows, until closed', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/kahoot',
        body: { ...quiz({ id: 'kahoot', title: 'Capitales' }), questions: [], slides: [] },
      },
      { method: 'GET', path: '/quizzes', body: [] },
      {
        method: 'POST',
        path: '/quizzes/import',
        status: 201,
        body: quiz({
          id: 'kahoot',
          title: 'Capitales',
          importReport: {
            source: 'kahoot',
            converted: 2,
            incomplete: [10],
            skipped: [{ row: 12, reason: 'formula' }],
          },
        }),
      },
    ]);
    renderApp('/quizzes');
    const input = await screen.findByLabelText('Importer');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xlsx'));
    fireEvent.change(input, { target: { files: [new File(['x'], 'quiz.xlsx')] } });
    expect(await screen.findByDisplayValue('Capitales')).toBeInTheDocument();
    expect(screen.getByText('2 questions importées de Kahoot.')).toBeInTheDocument();
    expect(screen.getByText(/1 question à finir avant de publier/)).toBeInTheDocument();
    expect(screen.getByText(/Ligne 12 laissée de côté/)).toHaveTextContent('formules');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByText(/importées de Kahoot/)).toBeNull());
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
    // The statuses are ticked in a list (draft and ready by default, archived out): ready alone.
    fireEvent.click(screen.getByRole('button', { name: 'Statut' }));
    expect(screen.getByRole('checkbox', { name: 'Archivé' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brouillon' }));
    await waitFor(() => expect(screen.getByText('1 quiz')).toBeInTheDocument());
    expect(screen.queryByText('Page 1 sur 2')).toBeNull();

    // Recherche : insensible à la casse et aux accents, et elle ramène à la page 1.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brouillon' }));
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

  it('says so when a quiz cannot be created, or copied (audit E3)', async () => {
    mockApi([
      { method: 'POST', path: '/quizzes/shared/duplicate', status: 500, body: {} },
      { method: 'POST', path: '/quizzes', status: 500, body: {} },
      {
        method: 'GET',
        path: '/quizzes',
        body: [quiz({ id: 'shared', title: 'Partagé', editable: false, shared: true })],
      },
    ]);
    everyone();
    renderApp('/quizzes');
    fireEvent.click((await screen.findAllByRole('button', { name: /Nouveau quiz/ }))[0]);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Créer un quiz à partir de ceci/ }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  });
});
