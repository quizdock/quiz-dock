import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/harness';
import { joinSession } from '../game/game-client';

vi.mock('../game/game-client', () => ({
  joinSession: vi.fn(),
  getGameSocket: () => null,
  createSession: vi.fn(),
  connectPlayer: vi.fn(),
}));

const mockedJoin = vi.mocked(joinSession);

describe('JoinPage (entrée joueur)', () => {
  afterEach(() => vi.clearAllMocks());

  it('pré-remplit le PIN depuis /join/:pin et rejoint avec succès', async () => {
    mockedJoin.mockResolvedValue({ sessionToken: 't', playerId: 'p1' });
    renderApp('/join/771122');

    const pinInput = (await screen.findByPlaceholderText('123456')) as HTMLInputElement;
    expect(pinInput.value).toBe('771122');

    fireEvent.change(screen.getByPlaceholderText('Votre pseudo'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));

    expect(mockedJoin).toHaveBeenCalledWith('771122', 'Alice');
    expect(await screen.findByText(/Bienvenue Alice/)).toBeInTheDocument();
  });

  it("affiche l'erreur (sans rester bloqué) si le join échoue", async () => {
    mockedJoin.mockRejectedValue(new Error('Ce pseudo est déjà pris dans cette partie.'));
    renderApp('/join/771122');

    fireEvent.change(await screen.findByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));

    expect(await screen.findByText(/déjà pris/)).toBeInTheDocument();
    // Le bouton est de nouveau actionnable (pas de spinner infini).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Rejoindre/ })).not.toBeDisabled(),
    );
  });
});
