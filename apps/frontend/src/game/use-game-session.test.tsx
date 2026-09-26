import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Socket factice : capture les listeners et les ack des emits pour les piloter.
const { fakeSocket, listeners, emitted, setAckOk, managerListeners } = vi.hoisted(() => {
  const listeners = new Map<string, (p: unknown) => void>();
  // Manager-level events (socket.io `socket.io.on('reconnect')`).
  const managerListeners = new Map<string, () => void>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  let ackOk = true;
  return {
    listeners,
    managerListeners,
    emitted,
    setAckOk: (v: boolean) => {
      ackOk = v;
    },
    fakeSocket: {
      io: {
        on: (e: string, cb: () => void) => managerListeners.set(e, cb),
        off: (e: string) => managerListeners.delete(e),
      },
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
    managerListeners.clear();
    emitted.length = 0;
    setAckOk(true);
    vi.clearAllMocks();
  });

  it('re-attaches after a reconnection (server restart), and stops on unmount', async () => {
    const { unmount } = renderHook(() => useGameSession('482913', 'host'));
    await waitFor(() => expect(emitted.filter((e) => e.event === 'host:attach')).toHaveLength(1));
    // The socket came back by itself but is no longer in the room: attach again.
    act(() => managerListeners.get('reconnect')?.());
    expect(emitted.filter((e) => e.event === 'host:attach')).toHaveLength(2);
    unmount();
    expect(managerListeners.has('reconnect')).toBe(false);
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

  it('the room’s next quiz: its lobby clears the last quiz, keeps what came just before, and the quiz to rate', async () => {
    loadPlayerSession.mockReturnValue({ pin: '482913', sessionToken: 't', playerId: 'p1' });
    const { result } = renderHook(() => useGameSession('482913', 'player'));
    await waitFor(() => expect(listeners.has('game:podium')).toBe(true));

    fire('game:state', { state: 'PODIUM', questionIndex: 0, totalQuestions: 1 });
    fire('game:podium', {
      podium: [{ nickname: 'Ada', score: 900, rank: 1 }],
      quizId: 'quiz-1',
      you: { score: 900, rank: 1 },
    });
    fire('room:standings', { quizzesPlayed: 1, top: [], you: { score: 900, rank: 1 } });
    // What the server sends ahead of the next lobby's state (sendStateTo).
    fire('game:media', {
      title: 'Quiz 2',
      hasSound: true,
      hasMedia: true,
      audioTarget: 'everyone',
    });
    fire('game:state', { state: 'LOBBY', questionIndex: -1, totalQuestions: 3 });

    const v = result.current.view;
    expect(v.podium).toBeNull();
    expect(v.quizHasSound).toBe(true);
    expect(v.quizTitle).toBe('Quiz 2');
    expect(v.standings?.quizzesPlayed).toBe(1);
    expect(v.rateable).toEqual({ quizId: 'quiz-1', feedbackEnabled: true });

    // The next quiz starts: the previous one can no longer be rated from here.
    fire('game:state', { state: 'ANSWERING', questionIndex: 0, totalQuestions: 3 });
    expect(result.current.view.rateable).toBeNull();
  });

  it('a participant who joined at the podium has no quiz to rate', async () => {
    loadPlayerSession.mockReturnValue({ pin: '482913', sessionToken: 't', playerId: 'p2' });
    const { result } = renderHook(() => useGameSession('482913', 'player'));
    await waitFor(() => expect(listeners.has('game:podium')).toBe(true));
    fire('game:podium', { podium: [], quizId: 'quiz-1' });
    fire('game:ended', { quizId: 'quiz-1', feedbackEnabled: true });
    expect(result.current.view.rateable).toBeNull();
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
