import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, setMarkdownField } from '../test/harness';

vi.mock('../game/game-client', () => ({
  createSession: vi.fn().mockResolvedValue({ pin: '482913' }),
  // No live connection in the editor's tests: a socket that never comes.
  ensureGameSocket: vi.fn(() => new Promise(() => undefined)),
}));

/** Two answers, the first right: a complete question. */
const OPTIONS = [
  {
    id: 'o1',
    text: 'Paris',
    color: 'red',
    shape: 'triangle',
    isCorrect: true,
    mediaId: null,
    alt: null,
  },
  {
    id: 'o2',
    text: 'Lyon',
    color: 'blue',
    shape: 'diamond',
    isCorrect: false,
    mediaId: null,
    alt: null,
  },
];

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
  editable: true,
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
      options: OPTIONS,
      acceptedAnswers: [],
    },
  ],
  slides: [],
  ...over,
});

/** Opens the header's ⋯ Plus menu and picks one of its lines. */
async function more(item: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Plus' }));
  fireEvent.click(await screen.findByRole('button', { name: item }));
}

/** Opens a step's ⋯ in the list and picks one of its lines. */
async function stepMenu(step: string, item: string) {
  const trigger = await screen.findByRole('button', { name: `Actions pour « ${step} »` });
  fireEvent.click(trigger);
  // The menu opens next to its trigger, in a portal appended to the page: the last match.
  fireEvent.click(screen.getAllByRole('button', { name: item }).at(-1)!);
}

/** A step's row in the list (its ⋯ carries a label, the row does not). */
const stepRow = (name: RegExp) =>
  screen.getAllByRole('button', { name }).find((b) => !b.hasAttribute('aria-label'))!;

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
    options: OPTIONS,
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
    await more('Exporter');
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByText(/Impossible d’exporter/)).toBeNull();
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('histoire.quizdock.zip');
    expect(exportHeaders?.['X-Local-User']).toBeDefined();
    click.mockRestore();
  });

  describe('export for publication (#21)', () => {
    const report = (over: Record<string, unknown> = {}) => ({
      slug: 'histoire',
      slugSet: true,
      language: 'fr',
      license: 'CC-BY-4.0',
      tags: ['histoire'],
      estimatedBytes: 3 * 1024 * 1024,
      maxBytes: 20 * 1024 * 1024,
      issues: [],
      heaviest: [],
      uncredited: [],
      ...over,
    });

    it('lists what blocks and keeps the download disabled', async () => {
      mockApi([
        {
          method: 'GET',
          path: '/quizzes/q1/publication',
          body: report({
            license: null,
            tags: [],
            issues: [
              { code: 'not_ready', level: 'block' },
              { code: 'license', level: 'block' },
              { code: 'tags', level: 'block' },
              { code: 'credit_missing', level: 'warn', count: 1 },
            ],
            uncredited: [{ id: 'm1', kind: 'image', name: 'carte.webp', sizeBytes: 10 }],
          }),
        },
        { method: 'GET', path: '/quizzes/q1', body: detail() },
      ]);
      renderApp('/quizzes/q1');
      await more('Exporter pour publication');
      const dialog = within((await screen.findByText('Nom court')).closest('dialog')!);
      expect(dialog.getByText('Le quiz n’est pas prêt')).toBeInTheDocument();
      expect(dialog.getByText('Aucune licence')).toBeInTheDocument();
      expect(dialog.getByText('Aucun tag')).toBeInTheDocument();
      expect(dialog.getByText('1 média sans crédit')).toBeInTheDocument();
      expect(dialog.getByText('carte.webp')).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Télécharger' })).toBeDisabled();
    });

    it('downloads under the confirmed slug, warning when it changes', async () => {
      const fetchMock = mockApi([
        { method: 'GET', path: '/quizzes/q1/publication', body: report() },
        { method: 'GET', path: '/quizzes/q1', body: detail() },
      ]);
      const json = fetchMock.getMockImplementation() as (
        u: string,
        o?: RequestInit,
      ) => Promise<Response>;
      let body: unknown;
      fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
        if (!String(url).includes('/publication/export')) return json(url, opts);
        body = JSON.parse(String(opts?.body));
        return new Response(new Blob(['PK']), {
          status: 200,
          headers: {
            'content-disposition': 'attachment; filename="histoire-de-france.quizdock.zip"',
          },
        });
      });
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      renderApp('/quizzes/q1');
      await more('Exporter pour publication');
      const input = await screen.findByLabelText('Nom court');
      expect(input).toHaveValue('histoire');
      fireEvent.change(input, { target: { value: 'Histoire de France' } });
      fireEvent.blur(input);
      expect(input).toHaveValue('histoire-de-france');
      expect(within(input.closest('dialog')!).getByRole('status')).toHaveTextContent(
        '« histoire »',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(body).toEqual({ slug: 'histoire-de-france' });
      click.mockRestore();
    });
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

  it('publishing an unfinished quiz lists what is missing, each step one click away', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), { ...q('b', 'Seconde', 1), options: [] }],
        }),
      },
    ]);
    renderApp('/quizzes/q1');

    fireEvent.click(await screen.findByText('Publier (prêt)'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 étape à finir avant de publier')).toBeInTheDocument();
    expect(within(dialog).getByText('Ajoutez au moins 2 réponses.')).toBeInTheDocument();
    expect(within(dialog).getByText('Cochez la bonne réponse.')).toBeInTheDocument();
    // Nothing was sent: the list says what to do first.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/status'))).toBe(false);
    // The unfinished step says so in the list too.
    expect(screen.getAllByText(/Inachevée/).length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ouvrir' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('arriving to publish (from the dashboard) lists what is missing first', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({ questions: [{ ...q('a', 'Première', 0), options: [] }] }),
      },
    ]);
    const { router } = renderApp('/quizzes/q1?publish=true');
    expect(await screen.findByText('1 étape à finir avant de publier')).toBeInTheDocument();
    // Done once: the address is clean again.
    await waitFor(() => expect(router.state.location.search).toEqual({}));
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

  it('sets the language of the quiz, offered by name with the instance language first (#83)', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail({ language: 'fr' }) },
      { method: 'PUT', path: '/quizzes/q1', body: detail() },
    ]);
    renderApp('/quizzes/q1');
    const select = await screen.findByLabelText('Langue', { selector: 'select' });
    const options = within(select).getAllByRole('option');
    // Tests pin the UI to French: French is the instance's language, listed first.
    expect(options[0]).toHaveTextContent('français');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toContain('zh-TW');

    fireEvent.change(select, { target: { value: 'de' } });
    await waitFor(() => {
      const bodies = fetchMock.mock.calls
        .filter(([url, opts]) => String(url).endsWith('/quizzes/q1') && opts?.method === 'PUT')
        .map(([, opts]) => JSON.parse(String(opts?.body)) as Record<string, unknown>);
      expect(bodies).toContainEqual({ language: 'de' });
    });
  });

  it('saving the title never writes back the language chosen before (audit E1)', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail({ language: 'fr' }) },
      { method: 'PUT', path: '/quizzes/q1', body: detail() },
    ]);
    renderApp('/quizzes/q1');
    const puts = () =>
      fetchMock.mock.calls
        .filter(([url, opts]) => String(url).endsWith('/quizzes/q1') && opts?.method === 'PUT')
        .map(([, opts]) => JSON.parse(String(opts?.body)) as Record<string, unknown>);
    const title = await screen.findByDisplayValue('Mon quiz');
    fireEvent.change(title, { target: { value: 'Mon quiz révisé' } });
    // The language is changed on its own, then the title is saved.
    fireEvent.change(screen.getByLabelText('Langue', { selector: 'select' }), {
      target: { value: 'de' },
    });
    await waitFor(() => expect(puts()).toContainEqual({ language: 'de' }));
    // Leaving the field saves it.
    fireEvent.blur(title);
    await waitFor(() => expect(puts().some((b) => b.title === 'Mon quiz révisé')).toBe(true));
    const titleSave = puts().find((b) => b.title === 'Mon quiz révisé');
    expect(titleSave).not.toHaveProperty('language');
  });

  describe("another host's quiz, opened by a manager (#82)", () => {
    const foreign = () => detail({ editable: false, ownerName: 'Alice', title: 'Quiz d’Alice' });

    it('shows it read-only, with its owner, and no editing controls', async () => {
      mockApi([
        { method: 'GET', path: '/quizzes/q1', body: foreign() },
        {
          method: 'GET',
          path: '/me',
          body: { id: 'm', displayName: 'M', roles: ['admin', 'host'] },
        },
      ]);
      renderApp('/quizzes/q1');
      expect(
        await screen.findByText(/Quiz de Alice : vous pouvez le consulter/),
      ).toBeInTheDocument();
      // Each step as it shows: its label, and the question on its stage.
      expect(screen.getAllByText('Capitale de la France ?').length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Exporter' })).toBeNull();
      expect(screen.queryByText('Publier (prêt)')).toBeNull();
      expect(screen.queryByLabelText('Licence')).toBeNull();
    });
  });

  describe('a save the server refuses says so, instead of snapping back in silence (#82)', () => {
    const FAILED = 'Impossible d’enregistrer la modification.';
    const refused = (method: string, path: string) => ({ method, path, status: 500, body: {} });
    const slide = {
      id: 's1',
      quizId: 'q1',
      beforeQuestionId: 'qq',
      orderIndex: 0,
      blocks: [{ type: 'heading', id: 'h', text: 'Bienvenue', level: 1 }],
      mediaId: null,
      textTone: 'light',
      textOutline: false,
      displayDelayS: null,
    };
    const twoQuestions = () =>
      detail({ questionCount: 2, questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)] });

    /** Each way the editor writes, the request it sends, and how to trigger it. */
    const cases: {
      name: string;
      quiz?: ReturnType<typeof detail>;
      request: [string, string];
      act: () => Promise<void>;
    }[] = [
      {
        name: 'the feedback switch',
        request: ['PUT', '/quizzes/q1'],
        act: async () => {
          fireEvent.click(await screen.findByLabelText('Autoriser les avis des participants'));
        },
      },
      {
        name: 'the sound levelling',
        request: ['PUT', '/quizzes/q1'],
        act: async () => {
          fireEvent.change(
            await screen.findByLabelText('Égalisation du son', { selector: 'select' }),
            {
              target: { value: '-23' },
            },
          );
        },
      },
      {
        name: 'the licence',
        request: ['PUT', '/quizzes/q1'],
        act: async () => {
          fireEvent.change(await screen.findByLabelText('Licence', { selector: 'select' }), {
            target: { value: 'CC0-1.0' },
          });
        },
      },
      {
        name: 'the language',
        request: ['PUT', '/quizzes/q1'],
        act: async () => {
          fireEvent.change(await screen.findByLabelText('Langue', { selector: 'select' }), {
            target: { value: 'de' },
          });
        },
      },
      {
        name: 'a tag',
        request: ['PUT', '/quizzes/q1'],
        act: async () => {
          const input = await screen.findByPlaceholderText('Ajouter un tag…');
          fireEvent.change(input, { target: { value: 'histoire' } });
          fireEvent.keyDown(input, { key: 'Enter' });
        },
      },
      {
        name: 'the status (publish)',
        request: ['PATCH', '/quizzes/q1/status'],
        act: async () => {
          fireEvent.click(await screen.findByText('Publier (prêt)'));
        },
      },
      {
        name: 'the status (archive)',
        request: ['PATCH', '/quizzes/q1/status'],
        act: async () => {
          await more('Archiver');
        },
      },
      {
        name: 'the order of the sequence',
        quiz: twoQuestions(),
        request: ['PATCH', '/quizzes/q1/items/reorder'],
        act: async () => {
          fireEvent.click((await screen.findAllByLabelText('Descendre'))[0]);
        },
      },
      {
        name: 'deleting a question',
        request: ['DELETE', '/questions/qq'],
        act: async () => {
          await stepMenu('Capitale de la France ?', 'Supprimer la question');
          fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
        },
      },
      {
        name: 'deleting a slide',
        quiz: detail({ slides: [slide] }),
        request: ['DELETE', '/slides/s1'],
        act: async () => {
          await stepMenu('Bienvenue', 'Supprimer la slide');
          fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
        },
      },
      {
        name: 'deleting the quiz',
        request: ['DELETE', '/quizzes/q1'],
        act: async () => {
          await more('Supprimer le quiz');
          fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
        },
      },
    ];

    for (const { name, quiz, request, act } of cases) {
      it(`${name}: the error is shown`, async () => {
        const fetchMock = mockApi([
          refused(...request),
          { method: 'GET', path: '/quizzes/q1', body: quiz ?? detail() },
        ]);
        renderApp('/quizzes/q1');
        await act();
        // The request did go out, and its refusal is on screen.
        await waitFor(() =>
          expect(
            fetchMock.mock.calls.some(
              ([url, opts]) =>
                String(url).includes(request[1]) && (opts?.method ?? 'GET') === request[0],
            ),
          ).toBe(true),
        );
        expect(await screen.findByText(FAILED)).toBeInTheDocument();
      });
    }

    it('a setting that saves shows no error', async () => {
      mockApi([
        { method: 'PUT', path: '/quizzes/q1', body: detail() },
        { method: 'GET', path: '/quizzes/q1', body: detail() },
      ]);
      renderApp('/quizzes/q1');
      fireEvent.change(await screen.findByLabelText('Licence', { selector: 'select' }), {
        target: { value: 'CC0-1.0' },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText(FAILED)).toBeNull();
    });

    it('a title that fails to save stays typed', async () => {
      mockApi([
        refused('PUT', '/quizzes/q1'),
        { method: 'GET', path: '/quizzes/q1', body: detail() },
      ]);
      renderApp('/quizzes/q1');
      const title = await screen.findByDisplayValue('Mon quiz');
      fireEvent.change(title, { target: { value: 'Mon quiz révisé' } });
      fireEvent.blur(title);
      expect(await screen.findByText(FAILED)).toBeInTheDocument();
      // What was typed stays, to be saved again on the next leave.
      expect(title).toHaveValue('Mon quiz révisé');
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
    expect(await screen.findByText('1 salon le joue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /111111/ })).toHaveAttribute(
      'href',
      '/session/111111/console',
    );
    expect(screen.queryByText(/222222/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Présenter/ }));
    // createSession is mocked (pin 482913): the editor hands over to the session's console.
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/482913/console'));
  });

  it('the title saves itself when left, and says it is saved (UI system §3)', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/quizzes/q1', body: detail() },
      { method: 'PUT', path: '/quizzes/q1', body: detail({ title: 'Mon quiz révisé' }) },
    ]);
    renderApp('/quizzes/q1');

    const title = await screen.findByDisplayValue('Mon quiz');
    fireEvent.change(title, { target: { value: 'Mon quiz révisé' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    expect(await screen.findByText('Enregistré')).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, o]) => (o as RequestInit)?.method === 'PUT');
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ title: 'Mon quiz révisé' });
  });

  it('an emptied title comes back: a quiz keeps one', async () => {
    const fetchMock = mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');
    const title = await screen.findByDisplayValue('Mon quiz');
    fireEvent.change(title, { target: { value: '  ' } });
    fireEvent.blur(title);
    expect(title).toHaveValue('Mon quiz');
    expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit)?.method === 'PUT')).toBe(false);
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

    // In the header's ⋯, after its separator.
    await more('Supprimer le quiz');
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
    fireEvent.click(down[0]); // a second move before the list is read again: held
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
    expect(
      fetchMock.mock.calls.filter(
        ([url, opts]) => String(url).includes('/items/reorder') && opts?.method === 'PATCH',
      ),
    ).toHaveLength(1);
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
    // The slide moves above « Première », from its ⋯ (the open step is « Première »).
    await stepMenu('Interlude', 'Monter');
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

    await screen.findAllByRole('button', { name: /Première/ });
    fireEvent.click(stepRow(/Première/));
    // Two « Enregistrer »: the settings one (folded details, first in DOM) and the item form's.
    const save = (await screen.findAllByRole('button', { name: 'Enregistrer' })).at(-1)!;
    expect(save).toBeDisabled(); // nothing changed yet
    setMarkdownField('Énoncé', 'Première (modifiée)');
    expect(save).toBeEnabled();

    // Opening another item while dirty → confirm dialog, the form stays until confirmed.
    fireEvent.click(stepRow(/Seconde/));
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
    expect(localStorage.getItem('draft:quiz:q1:question:a')).not.toBeNull();
    fireEvent.click(within(openDialog).getByRole('button', { name: 'Abandonner et continuer' }));
    await waitFor(() => expect(screen.getByLabelText('Énoncé').textContent).toContain('Seconde'));
    // Discarded for good: no draft brings the changes back when it is opened again.
    expect(localStorage.getItem('draft:quiz:q1:question:a')).toBeNull();
  });

  it('saves on the way to another item when asked, and goes on once saved (#195)', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [q('a', 'Première', 0), q('b', 'Seconde', 1)],
        }),
      },
      { method: 'PUT', path: '/questions/a', body: {} },
    ]);
    renderApp('/quizzes/q1');

    await screen.findAllByRole('button', { name: /Première/ });
    fireEvent.click(stepRow(/Première/));
    await screen.findAllByRole('button', { name: 'Enregistrer' });
    setMarkdownField('Énoncé', 'Première (modifiée)');
    fireEvent.click(stepRow(/Seconde/));
    const openDialog = await waitFor(() => {
      const d = [...document.querySelectorAll('dialog[open]')]
        .filter((x) => x.textContent?.includes('Abandonner les modifications ?'))
        .at(-1);
      if (!d) throw new Error('no open confirm dialog');
      return d as HTMLElement;
    });
    fireEvent.click(within(openDialog).getByRole('button', { name: 'Enregistrer et continuer' }));
    await waitFor(() => expect(screen.getByLabelText('Énoncé').textContent).toContain('Seconde'));
    const put = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/questions/a') && opts?.method === 'PUT',
    );
    expect(JSON.parse(String((put![1] as RequestInit).body)).prompt).toContain('modifiée');
  });

  it('a reading again that fails keeps the open editor, and says so', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1');
    expect(await screen.findByDisplayValue('Mon quiz')).toBeInTheDocument();
    mockApi([{ method: 'GET', path: '/quizzes/q1', status: 500, body: {} }]);
    window.dispatchEvent(new Event('visibilitychange')); // back to the tab: read again
    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mon quiz')).toBeInTheDocument();
  });

  it('says the quiz is not found only when the server says so (audit E5)', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', status: 500, body: {} }]);
    const { unmount } = renderApp('/quizzes/q1');
    expect(await screen.findByText('Une erreur est survenue.')).toBeInTheDocument();
    expect(screen.queryByText('Quiz introuvable.')).toBeNull();
    unmount();
    mockApi([
      { method: 'GET', path: '/quizzes/q1', status: 404, body: { code: 'quiz.not_found' } },
    ]);
    renderApp('/quizzes/q1');
    expect(await screen.findByText('Quiz introuvable.')).toBeInTheDocument();
  });
});
