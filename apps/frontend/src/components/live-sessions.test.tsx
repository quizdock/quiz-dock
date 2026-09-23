import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

/**
 * Les sessions en cours vivent dans la barre du haut, pas dans « Mes quiz » :
 * une session n'est pas un quiz, et l'indicateur suit l'hôte sur toutes les
 * pages. Un hôte voit les siennes ; seul un admin a la vue d'ensemble.
 */
describe('LiveSessions (barre du haut)', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('reste invisible quand rien ne tourne', async () => {
    mockApi([
      { method: 'GET', path: '/games/mine', body: [] },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/quizzes');
    // « Mes quiz » est à la fois le lien de navigation et le titre de la page.
    expect(await screen.findByRole('heading', { name: 'Mes quiz' })).toBeInTheDocument();
    expect(screen.queryByText(/en direct/)).toBeNull();
  });

  it('compte les sessions et les détaille au clic', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/mine',
        body: [
          { pin: '111111', quizId: 'q1', title: 'Histoire', state: 'LOBBY', playerCount: 0 },
          { pin: '222222', quizId: 'q1', title: 'Géo', state: 'ANSWERING', playerCount: 3 },
        ],
      },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/quizzes');

    fireEvent.click(await screen.findByRole('button', { name: /2 en direct/ }));
    expect(screen.getByText('Sessions en cours')).toBeInTheDocument();
    expect(screen.getByText('222222')).toBeInTheDocument();
    expect(screen.getByText('3 participants')).toBeInTheDocument();
  });

  it('dit de qui sont les sessions dans la vue d’ensemble d’un admin', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/mine',
        body: [
          {
            pin: '333333',
            quizId: 'q9',
            title: 'Histoire',
            state: 'LOBBY',
            playerCount: 1,
            host: 'Carol',
          },
        ],
      },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/quizzes');

    fireEvent.click(await screen.findByRole('button', { name: /1 en direct/ }));
    expect(screen.getByText('Toutes les sessions de l’instance')).toBeInTheDocument();
    expect(screen.getByText(/animée par Carol/)).toBeInTheDocument();
  });

  it('arrête une session après confirmation', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/games/mine',
        body: [{ pin: '482913', quizId: 'q1', title: 'Histoire', state: 'LOBBY', playerCount: 2 }],
      },
      { method: 'GET', path: '/quizzes', body: [] },
      { method: 'POST', path: '/games/482913/end', status: 204, body: {} },
    ]);
    renderApp('/quizzes');

    fireEvent.click(await screen.findByRole('button', { name: /1 en direct/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
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
});
