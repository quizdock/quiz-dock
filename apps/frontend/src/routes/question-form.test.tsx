import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, setMarkdownField } from '../test/harness';
import type { QuizDetailDtoQuestionsItem } from '../api/generated/model';
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

  it('a draft saves unfinished (no right answer), then says what is left to finish', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();
    setMarkdownField('Énoncé', 'Capitale ?');
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPost(fetchMock).options.every((o: { isCorrect: boolean }) => !o.isCorrect)).toBe(
      true,
    );
  });

  it('true or false starts with True ticked; another type clears the ticks', () => {
    mockApi([]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'true_false' } });
    expect(screen.getAllByRole('radio')[0]).toBeChecked();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'multiple_choice' } });
    for (const box of screen.getAllByRole('checkbox', { name: 'Correcte' })) {
      expect(box).not.toBeChecked();
    }
  });

  it('a time out of bounds becomes the nearest bound, with a note', () => {
    mockApi([]);
    renderForm();
    const time = screen.getByLabelText('Temps (s)');
    fireEvent.change(time, { target: { value: '500' } });
    fireEvent.blur(time);
    expect(time).toHaveValue(240);
    expect(screen.getByRole('note')).toHaveTextContent('240');
  });

  it('ordering: taking a place swaps it with the answer that held it', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();
    setMarkdownField('Énoncé', 'Du plus petit au plus grand');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ordering' } });
    const place = (i: number) =>
      screen.getByLabelText(`Place de la réponse ${i} dans le bon ordre`);
    expect(place(1)).toHaveValue('0');
    fireEvent.change(place(1), { target: { value: '1' } });
    expect(place(2)).toHaveValue('0');
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      lastPost(fetchMock).options.map((o: { correctOrderIndex: number }) => o.correctOrderIndex),
    ).toEqual([1, 0]);
  });

  it('numeric: decimals are fine, and the target may wait in a draft', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();
    setMarkdownField('Énoncé', 'Pi ?');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'numeric' } });
    expect(screen.getByLabelText('Valeur cible')).toHaveAttribute('step', 'any');
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPost(fetchMock)).not.toHaveProperty('numericValue');
  });

  it("no text field offers an image to add: a question's picture goes in its Media section", () => {
    renderForm();
    for (const label of ['Énoncé', 'Explication de la réponse (affichée après la révélation)']) {
      const editor = screen.getByLabelText(label).closest('[data-markdown-editor]') as HTMLElement;
      expect(within(editor).queryByRole('button', { name: /image/i })).toBeNull();
      expect(editor.querySelector('input[type="file"]')).toBeNull();
    }
  });

  it('offers to move an image of the prompt to the media, its description with it', async () => {
    const ID = '01M3GM8JMFRA3DJ04SWWDWPPBY';
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: `/media/${ID}/meta`,
        body: { id: ID, alt: null, credit: null, durationMs: null },
      },
      { method: 'PUT', path: `/media/${ID}/alt`, body: { id: ID, alt: 'La tour Eiffel' } },
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();
    setMarkdownField('Énoncé', `Quelle ville ?\n\n![La tour Eiffel](/api/v1/media/${ID})`);
    fireEvent.click(await screen.findByRole('button', { name: 'Déplacer dans les médias' }));
    // Moved: the suggestion is gone, the description follows the image.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Déplacer dans les médias' })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, o]) => String(url).includes(`/media/${ID}/alt`) && o?.method === 'PUT',
        ),
      ).toBe(true),
    );
    // With a picture, where it sits on the big screen: below the text unless placed elsewhere.
    fireEvent.click(await screen.findByRole('button', { name: 'À gauche du texte' }));
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const payload = lastPost(fetchMock);
    expect(payload.prompt).toBe('Quelle ville ?');
    expect(payload.media.visual).toEqual({ kind: 'image', assetId: ID });
    expect(payload.mediaPosition).toBe('left');
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
    // 42 s of sound starting 3 s before the answers, + the default 1 s pause → 40 s.
    expect(await screen.findByRole('note', { name: '' })).toHaveTextContent(
      'Le média dure 42 s : la question durera 40 s',
    );
  });

  it('listen first: the timer starts after the sound, and the hint says so', async () => {
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
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Lancer le chrono à la fin du média/ }),
    );
    expect(screen.getByRole('note', { name: '' })).toHaveTextContent(
      'Le média joue 42 s, puis les 20 s de réponse commencent.',
    );
  });
});

describe('QuestionForm — image choice', () => {
  const CAT = '01M3GM8JMFRA3DJ04SWWDWPPC1';
  const DOG = '01M3GM8JMFRA3DJ04SWWDWPPC2';
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const pictureQuestion = (over: Partial<QuizDetailDtoQuestionsItem> = {}) =>
    ({
      id: 'qi',
      quizId: 'q1',
      orderIndex: 0,
      type: 'image_choice',
      prompt: 'Which one is a cat?',
      media: { visual: null, audio: null },
      answerExplanation: null,
      backgroundMediaId: null,
      backgroundGradient: null,
      textTone: 'light',
      textOutline: true,
      timeLimitS: 20,
      revealDelayS: null,
      audioTarget: null,
      waveformSize: 'M',
      timerAfterMedia: false,
      pointsMode: 'standard',
      scoring: 'standard',
      numericValue: null,
      numericTolerance: null,
      multiSelect: false,
      options: [
        {
          id: 'o1',
          orderIndex: 0,
          text: null,
          mediaId: CAT,
          alt: 'A cat',
          color: 'red',
          shape: 'triangle',
          isCorrect: true,
          correctOrderIndex: null,
        },
        {
          id: 'o2',
          orderIndex: 1,
          text: null,
          mediaId: DOG,
          alt: '',
          color: 'blue',
          shape: 'diamond',
          isCorrect: false,
          correctOrderIndex: null,
        },
      ],
      acceptedAnswers: [],
      ...over,
    }) as unknown as QuizDetailDtoQuestionsItem;

  function renderEdit(
    question: QuizDetailDtoQuestionsItem,
    onClose = vi.fn(),
    quizStatus: 'draft' | 'ready' = 'draft',
  ) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <QuestionForm quizId="q1" question={question} quizStatus={quizStatus} onClose={onClose} />
      </QueryClientProvider>,
    );
    return onClose;
  }
  const lastPut = (fetchMock: ReturnType<typeof mockApi>) => {
    const call = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/questions/qi') && opts?.method === 'PUT',
    );
    return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
  };

  it('switching to it gives 2 empty pictures, no visual slot, and 4 on request', () => {
    mockApi([]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'image_choice' } });
    expect(screen.getAllByLabelText(/Texte alternatif de l’image/)).toHaveLength(2);
    expect(screen.queryByLabelText('option 1')).toBeNull();
    // The media section keeps the sound only.
    expect(screen.queryByText('Ajouter une vidéo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(screen.getAllByLabelText(/Texte alternatif de l’image/)).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '3' })).toBeNull();
  });

  it('a media credit typed in the form is saved with it, not before', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: `/media/${CAT}/meta`, body: { id: CAT, alt: null, credit: null } },
      { method: 'PUT', path: `/media/${CAT}/credit`, body: { id: CAT, credit: 'Photo : Ana' } },
      { method: 'PUT', path: '/questions/qi', body: {} },
    ]);
    const onClose = renderEdit(
      pictureQuestion({
        type: 'single_choice',
        media: { visual: { kind: 'image', assetId: CAT }, audio: null },
        options: [
          {
            id: 'o1',
            orderIndex: 0,
            text: 'Oui',
            mediaId: null,
            alt: null,
            color: 'red',
            shape: 'triangle',
            isCorrect: true,
            correctOrderIndex: null,
          },
          {
            id: 'o2',
            orderIndex: 1,
            text: 'Non',
            mediaId: null,
            alt: null,
            color: 'blue',
            shape: 'diamond',
            isCorrect: false,
            correctOrderIndex: null,
          },
        ],
      } as never),
    );
    const methodCalls = (method: string, path: string) =>
      fetchMock.mock.calls.filter(
        ([url, opts]) => String(url).includes(path) && (opts as RequestInit)?.method === method,
      );
    const credit = await screen.findByLabelText(/^Crédit/);
    fireEvent.change(credit, { target: { value: 'Photo : Ana' } });
    fireEvent.blur(credit);
    expect(methodCalls('PUT', '/credit')).toHaveLength(0);
    // The change alone makes the form savable.
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(methodCalls('PUT', '/credit')).toHaveLength(1);
    expect(methodCalls('PUT', '/questions/qi')).toHaveLength(1);
  });

  it('a poll turned into a single choice is worth points again', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const onClose = renderEdit(
      pictureQuestion({
        type: 'poll',
        pointsMode: 'none',
        options: [
          {
            id: 'o1',
            orderIndex: 0,
            text: 'Oui',
            mediaId: null,
            alt: null,
            color: 'red',
            shape: 'triangle',
            isCorrect: false,
            correctOrderIndex: null,
          },
          {
            id: 'o2',
            orderIndex: 1,
            text: 'Non',
            mediaId: null,
            alt: null,
            color: 'blue',
            shape: 'diamond',
            isCorrect: false,
            correctOrderIndex: null,
          },
        ],
      } as never),
    );
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'single_choice' } });
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPut(fetchMock)).toMatchObject({ type: 'single_choice', pointsMode: 'standard' });
  });

  it('says which picture misses its alt; a draft saves it anyway (UI system §1.5)', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const onClose = renderEdit(pictureQuestion());
    // A saved question says at once what it still misses, under the picture.
    expect(screen.getByLabelText('Texte alternatif de l’image 2')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('button', { name: /1 point à finir/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Texte alternatif de l’image 1'), {
      target: { value: 'A black cat' },
    });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPut(fetchMock)).toMatchObject({ options: [{ alt: 'A black cat' }, { alt: '' }] });
  });

  it('in a published quiz, an unfinished question offers to go back to draft', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const onClose = renderEdit(pictureQuestion(), vi.fn(), 'ready');
    fireEvent.change(screen.getByLabelText('Texte alternatif de l’image 1'), {
      target: { value: 'A black cat' },
    });
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(await screen.findByText('Enregistrer cette question inachevée ?')).toBeInTheDocument();
    expect(lastPut(fetchMock)).toBeNull();
    fireEvent.click(screen.getByText('Continuer à modifier'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves the pictures with their alt, several right answers and partial credit', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const onClose = renderEdit(pictureQuestion());
    fireEvent.change(screen.getByLabelText('Texte alternatif de l’image 2'), {
      target: { value: ' A dog ' },
    });
    fireEvent.click(screen.getByLabelText('Plusieurs bonnes réponses'));
    // Now checkboxes: tick the second picture too.
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Correcte' })[1]);
    fireEvent.change(screen.getByLabelText('Barème'), { target: { value: 'partial' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const payload = lastPut(fetchMock);
    expect(payload).toMatchObject({
      type: 'image_choice',
      multiSelect: true,
      scoring: 'partial',
      media: { visual: null, audio: null },
      options: [
        { mediaId: CAT, alt: 'A cat', isCorrect: true, color: 'red', shape: 'triangle' },
        { mediaId: DOG, alt: 'A dog', isCorrect: true, color: 'blue', shape: 'diamond' },
      ],
    });
    expect(payload.options[0].text).toBeUndefined();
  });

  it('back to one right picture keeps the first one ticked', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const q = pictureQuestion({ multiSelect: true, scoring: 'partial' } as never);
    (q.options as unknown as { isCorrect: boolean; alt: string }[]).forEach((o) => {
      o.isCorrect = true;
      o.alt = o.alt || 'A dog';
    });
    const onClose = renderEdit(q);
    fireEvent.click(screen.getByLabelText('Plusieurs bonnes réponses'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const payload = lastPut(fetchMock);
    expect(payload.options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([true, false]);
    expect(payload.multiSelect).toBe(false);
    // Partial credit needs several right pictures: back to the standard rule.
    expect(payload.scoring).toBe('standard');
  });

  it('keeps the picture an imported text answer holds when saving another type', async () => {
    const fetchMock = mockApi([{ method: 'PUT', path: '/questions/qi', body: {} }]);
    const q = pictureQuestion({ type: 'single_choice' } as never);
    (q.options as unknown as { text: string | null }[]).forEach((o, i) => (o.text = `T${i}`));
    const onClose = renderEdit(q);
    fireEvent.change(screen.getByLabelText('Temps (s)'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastPut(fetchMock).options.map((o: { mediaId?: string }) => o.mediaId)).toEqual([
      CAT,
      DOG,
    ]);
  });

  it('never gives two options the same key after a reload (audit E2)', async () => {
    const option = (key: string, text: string) => ({
      key,
      text,
      color: 'red',
      shape: 'triangle',
      isCorrect: text === 'A',
      mediaId: null,
      alt: '',
    });
    // A draft saved on the previous page load, with three options.
    localStorage.setItem(
      'draft:quiz:q1:question:new',
      JSON.stringify({
        type: 'single_choice',
        prompt: 'Q ?',
        media: { visual: null, audio: null },
        answerExplanation: '',
        background: { mediaId: null, gradient: null, textTone: 'light', textOutline: true },
        timeLimitS: 20,
        revealDelayS: null,
        pointsMode: 'standard',
        scoring: 'standard',
        numericValue: 0,
        numericTolerance: 0,
        multiSelect: false,
        options: [option('opt-1', 'A'), option('opt-2', 'B'), option('opt-3', 'C')],
        acceptedAnswers: [],
      }),
    );
    // The page is loaded again: the form's module starts over.
    vi.resetModules();
    const { QuestionForm: Fresh } = await import('./question-form');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Fresh quizId="q1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter une option/ }));
    const duplicate = errors.mock.calls.some((c) => String(c[0]).includes('same key'));
    errors.mockRestore();
    expect(duplicate).toBe(false);
  });
});
