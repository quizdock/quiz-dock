import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Socket factice : capture les listeners et les ack des emits pour les piloter.
const { fakeSocket, listeners, emitted, setAckOk } = vi.hoisted(() => {
  const listeners = new Map<string, (p: unknown) => void>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  let ackOk = true;
  return {
    listeners,
    emitted,
    setAckOk: (v: boolean) => {
      ackOk = v;
    },
    fakeSocket: {
      on: (e: string, cb: (p: unknown) => void) => listeners.set(e, cb),
      off: (e: string) => listeners.delete(e),
      emit: (e: string, payload: unknown, ack?: (r: { ok: boolean }) => void) => {
        emitted.push({ event: e, payload });
        ack?.({ ok: ackOk });
      },
    },
  };
});

const loadPlayerSession = vi.fn();
const clearPlayerSession = vi.fn();

vi.mock('./game-client', () => ({
  ensureGameSocket: () => Promise.resolve(fakeSocket),
  loadPlayerSession: () => loadPlayerSession(),
  clearPlayerSession: () => clearPlayerSession(),
}));

import { useGameSession } from './use-game-session';

const fire = (event: string, payload: unknown) => act(() => listeners.get(event)?.(payload));

describe('useGameSession', () => {
  afterEach(() => {
    listeners.clear();
    emitted.length = 0;
    setAckOk(true);
    vi.clearAllMocks();
  });

  it('hôte : émet host:attach après avoir posé les listeners, puis suit l’état + le roster', async () => {
    const { result } = renderHook(() => useGameSession('482913', 'host'));

    // Le kick host:attach part une fois les listeners en place.
    await waitFor(() => expect(emitted.some((e) => e.event === 'host:attach')).toBe(true));
    expect(listeners.has('game:state')).toBe(true); // listeners posés AVANT (sinon rafale ratée)

    fire('game:roster', { players: [{ playerId: 'p1', nickname: 'Alice' }] });
    fire('game:state', { state: 'LOBBY', questionIndex: -1, totalQuestions: 5 });

    await waitFor(() => expect(result.current.view.status).toBe('ready'));
    expect(result.current.view.state).toBe('LOBBY');
    expect(result.current.view.players.map((p) => p.nickname)).toEqual(['Alice']);
  });

  it('joueur sans session locale : statut no-session (écran Rejoindre), aucun reconnect', async () => {
    loadPlayerSession.mockReturnValue(null);
    const { result } = renderHook(() => useGameSession('482913', 'player'));

    await waitFor(() => expect(result.current.view.status).toBe('no-session'));
    expect(emitted.some((e) => e.event === 'player:reconnect')).toBe(false);
  });

  it('joueur avec session : tente player:reconnect ; ack ko → session purgée + no-session', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '482913',
      sessionToken: 'tok',
      playerId: 'p1',
      nickname: 'Bob',
    });
    setAckOk(false);
    const { result } = renderHook(() => useGameSession('482913', 'player'));

    await waitFor(() => expect(emitted.some((e) => e.event === 'player:reconnect')).toBe(true));
    await waitFor(() => expect(result.current.view.status).toBe('no-session'));
    expect(clearPlayerSession).toHaveBeenCalled();
  });
});
