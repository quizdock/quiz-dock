import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/harness';

// Socket factice (émetteur minimal) — on capture les handlers pour les déclencher.
const { listeners, fakeSocket } = vi.hoisted(() => {
  const listeners = new Map<string, (p: unknown) => void>();
  return {
    listeners,
    fakeSocket: {
      on: (e: string, cb: (p: unknown) => void) => listeners.set(e, cb),
      off: (e: string) => listeners.delete(e),
      emit: vi.fn(),
    },
  };
});

vi.mock('../game/game-client', () => ({
  getGameSocket: () => fakeSocket,
  createSession: vi.fn(),
  joinSession: vi.fn(),
  connectPlayer: vi.fn(),
}));

describe('PresentPage (lobby hôte)', () => {
  afterEach(() => {
    listeners.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('affiche le PIN + un QR code et incrémente le compteur sur player:joined', async () => {
    localStorage.setItem('roux.localUser', 'Formateur'); // passe requireAuth
    const { container } = renderApp('/present/482913');

    expect(await screen.findByLabelText('Code PIN')).toHaveTextContent('482913');
    expect(container.querySelector('svg[aria-label="QR code pour rejoindre"]')).toBeTruthy();
    expect(screen.getByTestId('player-count')).toHaveTextContent('0');

    act(() =>
      listeners.get('player:joined')?.({ playerId: 'p1', nickname: 'Alice', playerCount: 1 }),
    );
    expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('émet host:start au clic « Démarrer » (un joueur présent)', async () => {
    localStorage.setItem('roux.localUser', 'Formateur');
    renderApp('/present/482913');
    await screen.findByLabelText('Code PIN');

    act(() =>
      listeners.get('player:joined')?.({ playerId: 'p1', nickname: 'Bob', playerCount: 1 }),
    );
    act(() => screen.getByRole('button', { name: /Démarrer/ }).click());

    expect(fakeSocket.emit).toHaveBeenCalledWith('host:start', { pin: '482913' });
  });

  it('le bouton « Partager » diffuse le lien de la partie (Web Share)', async () => {
    localStorage.setItem('roux.localUser', 'Formateur');
    // jsdom n'implémente pas canvas.toBlob → repli sans image (partage du lien).
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, canShare: () => false });

    renderApp('/present/482913');
    const btn = await screen.findByRole('button', { name: /Partager/ });
    await act(async () => {
      btn.click();
    });

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toMatchObject({
      url: expect.stringContaining('/join/482913'),
    });
    vi.unstubAllGlobals();
  });
});
