import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

describe('Garde de route', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('redirige vers /login si non connecté', async () => {
    mockApi([]);
    renderApp('/dashboard');
    // la garde renvoie vers la connexion (champ propre à la page de login)
    expect(await screen.findByLabelText('Votre nom')).toBeInTheDocument();
    expect(screen.queryByText('Mes quiz')).not.toBeInTheDocument();
  });
});
