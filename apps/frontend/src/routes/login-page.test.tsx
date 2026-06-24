import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

describe('LoginPage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('connecte en mode local et redirige vers le tableau de bord', async () => {
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/login');

    const input = await screen.findByLabelText('Votre nom');
    fireEvent.change(input, { target: { value: 'Marie' } });
    fireEvent.click(screen.getByText('Continuer'));

    // l'identité locale est mémorisée
    expect(localStorage.getItem('live.localUser')).toBe('Marie');
    // navigation effective vers le tableau de bord (rendu après login)
    expect(await screen.findByText('Mes quiz')).toBeInTheDocument();
  });
});
