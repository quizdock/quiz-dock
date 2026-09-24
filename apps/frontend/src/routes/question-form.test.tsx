import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, setMarkdownField } from '../test/harness';
import { QuestionForm } from './question-form';

function renderForm(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <QuestionForm quizId="q1" onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

const lastPost = (fetchMock: ReturnType<typeof mockApi>) => {
  const call = fetchMock.mock.calls.find(
    ([url, opts]) => String(url).includes('/quizzes/q1/questions') && opts?.method === 'POST',
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
};

describe('QuestionForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear(); // drafts must not leak from one test into the next
  });

  it('affiche 2 options par défaut (single_choice) et soumet le payload', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();

    setMarkdownField('Énoncé', 'Capitale ?');
    expect(screen.getByLabelText('option 1')).toBeInTheDocument();
    expect(screen.getByLabelText('option 2')).toBeInTheDocument();
    // marque la 1re option correcte (radio pour single_choice)
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByText('Ajouter'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const payload = lastPost(fetchMock);
    expect(payload.type).toBe('single_choice');
    expect(payload.prompt).toBe('Capitale ?');
    expect(payload.options).toHaveLength(2);
    expect(payload.options[0].isCorrect).toBe(true);
    expect(payload.options[1].isCorrect).toBe(false);
    // #5 / #6: optional fields left empty are sent as null (= defaults)
    expect(payload.answerExplanation).toBeNull();
    expect(payload.revealDelayS).toBeNull();
  });

  it('sends the per-question reveal delay when set (#6)', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();

    setMarkdownField('Énoncé', 'Q ?');
    fireEvent.change(screen.getByLabelText('Délai de révélation (s)'), { target: { value: '12' } });
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByText('Ajouter'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPost(fetchMock).revealDelayS).toBe(12);
  });

  it('bascule les champs selon le type (texte → réponses acceptées)', () => {
    mockApi([]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'text_input' },
    });
    expect(screen.getByText('Réponses acceptées')).toBeInTheDocument();
    expect(screen.queryByText('Options')).not.toBeInTheDocument();
  });

  it('affiche les champs numériques pour le type numeric', () => {
    mockApi([]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'numeric' },
    });
    expect(screen.getByLabelText('Valeur cible')).toBeInTheDocument();
    expect(screen.getByLabelText('Tolérance ±')).toBeInTheDocument();
  });

  it('offers a scoring variant per type and sends it (numeric → closest wins)', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();
    // No variant for a single choice: the select is not there.
    expect(screen.queryByLabelText('Barème')).toBeNull();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'numeric' } });
    const scoring = screen.getByLabelText('Barème') as HTMLSelectElement;
    expect([...scoring.options].map((o) => o.textContent)).toEqual([
      'Dans la tolérance',
      'Le plus proche gagne',
    ]);
    fireEvent.change(scoring, { target: { value: 'closest' } });
    setMarkdownField('Énoncé', 'Hauteur ?');
    fireEvent.change(screen.getByLabelText('Valeur cible'), { target: { value: '330' } });
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPost(fetchMock)).toMatchObject({ type: 'numeric', scoring: 'closest' });
  });

  it('résout le code d’erreur tokenisé renvoyé par l’API (400) en texte i18n', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/quizzes/q1/questions',
        status: 400,
        body: { code: 'validation' },
      },
    ]);
    renderForm();
    setMarkdownField('Énoncé', 'X');
    fireEvent.click(screen.getByText('Ajouter'));
    expect(await screen.findByText('Certains champs sont invalides.')).toBeInTheDocument();
  });

  it('keeps a draft in localStorage until saved: a reopened form restores it, discard clears it', async () => {
    mockApi([]);
    localStorage.clear();
    const first = renderForm();
    setMarkdownField('Énoncé', 'Brouillon en cours');
    expect(localStorage.getItem('draft:quiz:q1:question:new')).toContain('Brouillon en cours');
    first.unmount();

    // Same form again (new question of the same quiz): the draft comes back with a notice.
    renderForm();
    expect(await screen.findByText(/Brouillon restauré/)).toBeInTheDocument();
    expect(screen.getByLabelText('Énoncé').textContent).toContain('Brouillon en cours');

    fireEvent.click(screen.getByRole('button', { name: 'Ignorer le brouillon' }));
    expect(localStorage.getItem('draft:quiz:q1:question:new')).toBeNull();
    expect(screen.queryByText(/Brouillon restauré/)).toBeNull();
  });
});

describe('QuestionForm — media slots', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('refuses to save a video with an audio track, before asking the server', async () => {
    const id = (c: string) => c.repeat(26);
    localStorage.setItem(
      'draft:quiz:q1:question:new',
      JSON.stringify({
        type: 'poll',
        prompt: 'Q ?',
        media: {
          visual: { kind: 'video', source: 'upload', assetId: id('V') },
          audio: {
            assetId: id('A'),
            origin: 'upload',
            durationMs: 1000,
            peaks: new Array(200).fill(0.5),
          },
        },
        answerExplanation: '',
        background: { mediaId: null, gradient: null, textTone: 'light', textOutline: true },
        timeLimitS: 20,
        revealDelayS: null,
        pointsMode: 'none',
        scoring: 'standard',
        numericValue: 0,
        numericTolerance: 0,
        options: [
          {
            key: 'a',
            text: 'A',
            color: 'red',
            shape: 'triangle',
            isCorrect: false,
            correctOrderIndex: 0,
          },
          {
            key: 'b',
            text: 'B',
            color: 'blue',
            shape: 'diamond',
            isCorrect: false,
            correctOrderIndex: 1,
          },
        ],
        acceptedAnswers: [],
      }),
    );
    const fetchMock = mockApi([]);
    const { onClose } = renderForm();
    fireEvent.click(screen.getByText('Ajouter'));
    expect(await screen.findByText(/Une vidéo a déjà son propre son/)).toBeInTheDocument();
    expect(lastPost(fetchMock)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('QuestionForm — media timing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('says when a long sound stretches the question, and by how much', async () => {
    localStorage.setItem(
      'draft:quiz:q1:question:new',
      JSON.stringify({
        type: 'poll',
        prompt: 'Q ?',
        media: {
          visual: null,
          audio: {
            assetId: 'A'.repeat(26),
            origin: 'upload',
            durationMs: 42_000,
            peaks: new Array(200).fill(0.5),
          },
        },
        answerExplanation: '',
        background: { mediaId: null, gradient: null, textTone: 'light', textOutline: true },
        timeLimitS: 20,
        revealDelayS: null,
        pointsMode: 'none',
        scoring: 'standard',
        numericValue: 0,
        numericTolerance: 0,
        options: [],
        acceptedAnswers: [],
      }),
    );
    mockApi([]);
    renderForm();
    // 42 s of sound starting 3 s before the answers, + the default 3 s pause → 42 s.
    expect(await screen.findByRole('note', { name: '' })).toHaveTextContent(
      'Le média dure 42 s : la question durera 42 s',
    );
  });
});
