import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/harness';

/**
 * Test d'intégration de la couture **hook réel + `joinSession` réel** : seul le
 * transport `socket.io-client` est mocké, et chaque appel `io()` crée un socket
 * **distinct** (comme `forceNew`). Garde-fou contre la régression « join sur un 2ᵉ
 * socket » : `player:join` et `player:submit` doivent atterrir sur le MÊME socket
 * (celui porteur des listeners du hook), sinon l'écran fige et la réponse est rejetée.
 */
interface FakeSocket {
  emitted: Array<{ event: string; payload: unknown }>;
  handlers: Map<string, (p: unknown) => void>;
  on: (e: string, cb: (p: unknown) => void) => void;
  once: () => void;
  off: (e: string) => void;
  emit: (e: string, payload: unknown, ack?: (r: unknown) => void) => void;
  disconnect: () => void;
  connected: boolean;
}

const { sockets } = vi.hoisted(() => ({ sockets: [] as unknown[] }));

const makeSocket = (): FakeSocket => {
  const handlers = new Map<string, (p: unknown) => void>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emitted,
    handlers,
    connected: true,
    on: (e, cb) => handlers.set(e, cb),
    once: () => {},
    off: (e) => handlers.delete(e),
    disconnect: () => {},
    emit: (e, payload, ack) => {
      emitted.push({ event: e, payload });
      if (typeof ack === 'function') {
        ack(e === 'player:join' ? { sessionToken: 't', playerId: 'p1' } : { ok: true });
      }
    },
  };
};

vi.mock('socket.io-client', () => ({
  io: () => {
    const s = makeSocket();
    sockets.push(s);
    return s;
  },
}));

describe('PlayerPage (intégration socket réel)', () => {
  afterEach(() => {
    sockets.length = 0;
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('join → suit l’état → répond, le tout sur un seul et même socket', async () => {
    renderApp('/join/771122');

    fireEvent.change(await screen.findByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /C'est parti/ }));

    await waitFor(() =>
      expect(
        (sockets as FakeSocket[]).some((s) => s.emitted.some((e) => e.event === 'player:join')),
      ).toBe(true),
    );

    // Un seul socket a été créé (réutilisation du singleton) — pas de 2ᵉ socket forké.
    expect(sockets).toHaveLength(1);
    const sock = sockets[0] as FakeSocket;

    // La rafale d'état arrive sur le socket du hook → la question s'affiche.
    sock.handlers.get('game:state')?.({ state: 'ANSWERING', questionIndex: 0, totalQuestions: 1 });
    sock.handlers.get('question:start')?.({
      questionIndex: 0,
      type: 'single_choice',
      prompt: 'Capitale ?',
      options: [{ id: 'opt-paris', text: 'Paris', color: 'red', shape: 'triangle' }],
      timeLimitS: 5,
      basePoints: 1000,
      startedAt: Date.now(),
      endsAt: Date.now() + 5000,
    });

    fireEvent.click(await screen.findByRole('button', { name: /Paris/ }));

    // join ET submit sur le même socket (sinon le serveur rejette le submit).
    expect(sock.emitted.some((e) => e.event === 'player:join')).toBe(true);
    expect(sock.emitted.some((e) => e.event === 'player:submit')).toBe(true);
    expect(await screen.findByText(/Réponse enregistrée/)).toBeInTheDocument();
  });
});
