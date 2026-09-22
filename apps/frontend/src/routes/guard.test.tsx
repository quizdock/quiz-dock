import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

describe('Garde de route', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sends a participant to the sign-in page under OIDC (RG-15)', async () => {
    mockApi([]);
    renderApp('/join/123456', 'oidc');
    expect(await screen.findByText('Connectez-vous pour participer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Votre pseudo')).not.toBeInTheDocument();
  });

  it('keeps the join pages public in local mode', async () => {
    mockApi([]);
    renderApp('/join');
    expect(await screen.findByLabelText('Code PIN')).toBeInTheDocument();
  });

  it('redirige vers /login si non connecté', async () => {
    mockApi([]);
    renderApp('/quizzes');
    // la garde renvoie vers la connexion (champ propre à la page de login)
    expect(await screen.findByLabelText('Votre nom')).toBeInTheDocument();
    expect(screen.queryByText('Mes quiz')).not.toBeInTheDocument();
  });
});

describe('document title', () => {
  it('reads "<page> · <app>" from the matched route', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([{ method: 'GET', path: '/quizzes', body: [] }]);
    renderApp('/quizzes');
    await waitFor(() => expect(document.title).toBe('Mes quiz · QuizDock'));
    localStorage.clear();
  });
});
