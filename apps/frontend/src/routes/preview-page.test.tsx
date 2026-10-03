import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const question = (over: Record<string, unknown> = {}) => ({
  id: 'qq1',
  quizId: 'q1',
  orderIndex: 0,
  type: 'single_choice',
  prompt: 'Capitale de la France ?',
  media: { visual: null, audio: null },
  timeLimitS: 20,
  pointsMode: 'standard',
  numericValue: null,
  numericTolerance: null,
  options: [
    {
      id: 'o1',
      orderIndex: 0,
      text: 'Paris',
      mediaId: null,
      color: 'red',
      shape: 'triangle',
      isCorrect: true,
      correctOrderIndex: null,
    },
    {
      id: 'o2',
      orderIndex: 1,
      text: 'Lyon',
      mediaId: null,
      color: 'blue',
      shape: 'circle',
      isCorrect: false,
      correctOrderIndex: null,
    },
  ],
  acceptedAnswers: [],
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  ownerId: 'o',
  title: 'Quiz géo',
  description: null,
  coverMediaId: null,
  status: 'draft',
  language: 'fr',
  questionCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  questions: [question()],
  slides: [],
  ...over,
});

describe('PreviewPage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('draws the real projection, the answer on request, and the phone', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    const { container } = renderApp('/quizzes/q1/preview');

    expect(await screen.findByRole('link', { name: /Retour à l’éditeur/ })).toBeInTheDocument();
    const projection = () => container.querySelector('.qd-screen') as HTMLElement;
    expect(within(projection()).getByText('Capitale de la France ?')).toBeInTheDocument();
    expect(within(projection()).getByText('Paris')).toBeInTheDocument();
    expect(container.querySelector('[data-correct="true"]')).toBeNull();
    // Its clock stands at the full time: not counting, not paused.
    const timer = projection().querySelector('.qd-timer') as HTMLElement;
    expect(timer.dataset.tone).toBe('ok');
    expect(timer).toHaveTextContent('20');

    // The answer, as the room sees it once revealed.
    fireEvent.click(screen.getByRole('switch', { name: 'Montrer la réponse' }));
    expect(projection().dataset.state).toBe('REVEAL');
    expect(container.querySelector('.qd-answer[data-correct="true"]')).toHaveTextContent('Paris');

    // A participant's phone.
    fireEvent.click(screen.getByRole('button', { name: 'Téléphone' }));
    expect(container.querySelector('.qd-screen')).toBeNull();
    expect(screen.getAllByText('Paris').length).toBeGreaterThan(0);
  });

  it('propose le plein écran et déclenche requestFullscreen', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
      writable: true,
    });
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1/preview');

    const btn = await screen.findByRole('button', { name: 'Plein écran' });
    fireEvent.click(btn);
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('navigue d’une question à l’autre', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/quizzes/q1',
        body: detail({
          questionCount: 2,
          questions: [
            question({ id: 'a', prompt: 'Question une' }),
            question({ id: 'b', prompt: 'Question deux' }),
          ],
        }),
      },
    ]);
    renderApp('/quizzes/q1/preview');

    const onStage = (name: string) => screen.queryByRole('heading', { name });
    expect(await screen.findByRole('heading', { name: 'Question une' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Suivant'));
    expect(onStage('Question deux')).toBeInTheDocument();
    // The keyboard walks too, and the list picks any step.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(onStage('Question une')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Étapes' })).getByText('Question deux'),
    );
    expect(onStage('Question deux')).toBeInTheDocument();
  });
});
