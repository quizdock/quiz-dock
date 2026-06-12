import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/harness';
import { QuestionForm } from './question-form';

function renderForm(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <QuestionForm quizId="q1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const lastPost = (fetchMock: ReturnType<typeof mockApi>) => {
  const call = fetchMock.mock.calls.find(
    ([url, opts]) => String(url).includes('/quizzes/q1/questions') && opts?.method === 'POST',
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
};

describe('QuestionForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('affiche 2 options par défaut (single_choice) et soumet le payload', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/quizzes/q1/questions', status: 201, body: {} },
    ]);
    const { onClose } = renderForm();

    fireEvent.change(screen.getByLabelText('Énoncé'), {
      target: { value: 'Capitale ?' },
    });
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

  it('affiche l’erreur de validation renvoyée par l’API (400)', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/quizzes/q1/questions',
        status: 400,
        body: { message: 'Exactement une option correcte requise.' },
      },
    ]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Énoncé'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByText('Ajouter'));
    expect(await screen.findByText('Exactement une option correcte requise.')).toBeInTheDocument();
  });
});
