import { fireEvent, screen } from '@testing-library/react';
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
    // Le menu dit que la portée change ; le détail « animée par qui » est sur la
    // page dédiée, où une ligne a la place de le porter.
    expect(screen.getByText('Toutes les sessions de l’instance')).toBeInTheDocument();
  });

  it('reste dans la barre, pas dans le burger : une partie en cours se voit', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/mine',
        body: [{ pin: '111111', quizId: 'q1', title: 'Histoire', state: 'LOBBY', playerCount: 0 }],
      },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/quizzes');

    // L'indicateur est accessible sans ouvrir quoi que ce soit, à toute taille.
    fireEvent.click(await screen.findByRole('button', { name: /1 en direct/ }));
    expect(screen.getByText('Sessions en cours')).toBeInTheDocument();
    expect(screen.getByText('111111')).toBeInTheDocument();
  });

  it('plafonne la liste et renvoie vers la page dédiée', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      pin: String(100000 + i),
      quizId: 'q1',
      title: `Partie ${i}`,
      state: 'LOBBY',
      playerCount: i,
    }));
    mockApi([
      { method: 'GET', path: '/games/mine', body: many },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/quizzes');

    fireEvent.click(await screen.findByRole('button', { name: /12 en direct/ }));
    // Cinq aperçus, pas douze : le menu est une porte d'entrée.
    expect(screen.getByText('Partie 0')).toBeInTheDocument();
    expect(screen.queryByText('Partie 11')).toBeNull();
    expect(screen.getByRole('link', { name: /Voir toutes les sessions \(12\)/ })).toHaveAttribute(
      'href',
      '/live',
    );
  });
});
