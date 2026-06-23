import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/harness';

// La cible de navigation (`/join/$pin` → PlayerPage) s'appuie sur useGameSession :
// on le neutralise (no-session) pour vérifier uniquement la navigation depuis /join.
vi.mock('../game/use-game-session', () => ({
  useGameSession: () => ({
    view: { status: 'no-session', players: [], questionIndex: -1 },
    socket: null,
    markJoined: vi.fn(),
  }),
}));
vi.mock('../game/game-client', () => ({
  joinSession: vi.fn(),
  loadPlayerSession: () => null,
  loadAvatarSeed: () => null,
  saveAvatarSeed: () => undefined,
}));

describe('JoinPage (saisie du PIN)', () => {
  it('navigue vers /join/$pin après saisie du PIN', async () => {
    renderApp('/join');

    fireEvent.change(await screen.findByPlaceholderText('123456'), { target: { value: '771122' } });
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

    // PlayerPage (no-session) demande alors le pseudo.
    expect(await screen.findByPlaceholderText('Votre pseudo')).toBeInTheDocument();
  });
});
