import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const question = (over: Record<string, unknown> = {}) => ({
  id: 'qq1',
  quizId: 'q1',
  orderIndex: 0,
  type: 'single_choice',
  prompt: 'Capitale de la France ?',
  mediaId: null,
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
  visibility: 'private',
  language: 'fr',
  questionCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  questions: [question()],
  ...over,
});

describe('PreviewPage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('rend la question en vue apprenant (énoncé, options, temps, bonne réponse)', async () => {
    mockApi([{ method: 'GET', path: '/quizzes/q1', body: detail() }]);
    renderApp('/quizzes/q1/preview');

    expect(await screen.findByText('Capitale de la France ?')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Lyon')).toBeInTheDocument();
    expect(screen.getByText('⏱ 20 s')).toBeInTheDocument();
    // l'option correcte est marquée
    expect(screen.getByLabelText('bonne réponse')).toBeInTheDocument();
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

    const btn = await screen.findByText('Plein écran');
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

    expect(await screen.findByText('Question une')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Suivant'));
    expect(screen.getByText('Question deux')).toBeInTheDocument();
  });
});
