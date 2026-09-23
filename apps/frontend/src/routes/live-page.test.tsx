import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const session = (over: Record<string, unknown> = {}) => ({
  pin: '482913',
  quizId: 'q1',
  title: 'Histoire',
  state: 'LOBBY',
  playerCount: 2,
  ...over,
});

/**
 * La page des sessions en direct : même traitement que la banque de quiz, parce
 * qu'une instance active en compte bien plus que ce qu'un menu peut tenir.
 */
describe('LivePage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('cherche par titre, par PIN ou par animateur, filtre et pagine', async () => {
    const many = [
      ...Array.from({ length: 21 }, (_, i) =>
        session({ pin: String(200000 + i), title: `Partie ${i}`, playerCount: i }),
      ),
      session({ pin: '999999', title: 'Géographie', state: 'ANSWERING', host: 'Carol' }),
    ];
    mockApi([{ method: 'GET', path: '/games/mine', body: many }]);
    renderApp('/live');

    expect(await screen.findByText('22 sessions')).toBeInTheDocument();
    expect(screen.getByText('Page 1 sur 2')).toBeInTheDocument();

    // Le PIN se cherche : c'est souvent tout ce qu'on a sous les yeux.
    fireEvent.change(screen.getByPlaceholderText(/Rechercher une session/), {
      target: { value: '999999' },
    });
    await waitFor(() => expect(screen.getByText('1 session')).toBeInTheDocument());
    expect(screen.getByText('Géographie')).toBeInTheDocument();
    expect(screen.getByText(/animée par Carol/)).toBeInTheDocument();

    // Et l'état : salle d'attente ou en jeu.
    fireEvent.change(screen.getByPlaceholderText(/Rechercher une session/), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('État'), { target: { value: 'playing' } });
    await waitFor(() => expect(screen.getByText('1 session')).toBeInTheDocument());
  });

  it('arrête une session après confirmation', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/games/mine', body: [session()] },
      { method: 'POST', path: '/games/482913/end', status: 204, body: {} },
    ]);
    renderApp('/live');

    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter la session' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/games/482913/end') &&
            (opts as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('le dit quand rien ne tourne', async () => {
    mockApi([{ method: 'GET', path: '/games/mine', body: [] }]);
    renderApp('/live');
    expect(await screen.findByText('Aucune session en cours.')).toBeInTheDocument();
  });
});
