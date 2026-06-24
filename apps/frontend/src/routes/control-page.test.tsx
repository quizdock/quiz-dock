import { GameState } from '@quiz-dock/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { renderApp } from '../test/harness';

const { fakeSocket, hookState } = vi.hoisted(() => ({
  fakeSocket: { emit: vi.fn() },
  hookState: { value: null as unknown },
}));

vi.mock('../game/use-game-session', () => ({
  useGameSession: () => ({ view: hookState.value, socket: fakeSocket, markJoined: vi.fn() }),
}));

const view = (partial: Partial<GameView>): GameView => ({
  status: 'ready',
  error: null,
  state: GameState.Lobby,
  questionIndex: -1,
  totalQuestions: 0,
  question: null,
  answerCount: null,
  reveal: null,
  result: null,
  leaderboard: null,
  podium: null,
  players: [],
  answerAccepted: null,
  fullCapture: false,
  kicked: null,
  mode: 'manual',
  paused: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizDescription: null,
  outline: [],
  ...partial,
});

describe('ControlPage (console hôte)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('LOBBY : PIN + QR + roster ; « Démarrer » émet host:start', async () => {
    localStorage.setItem('live.localUser', 'Animateur'); // passe requireAuth
    hookState.value = view({ players: [{ playerId: 'p1', nickname: 'Alice' }] });
    const { container } = renderApp('/present/482913/control');

    expect(await screen.findByLabelText('Code PIN')).toHaveTextContent('482913');
    expect(container.querySelector('svg[aria-label="QR code pour rejoindre"]')).toBeTruthy();
    expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    expect(screen.getByText('Alice')).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: /Démarrer/ }).click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:start', { pin: '482913' });
  });

  it('ANSWERING : compteur + « Révéler » émet host:reveal', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: { prompt: 'Capitale ?' } as never,
      answerCount: { answered: 2, total: 3 },
    });
    renderApp('/present/482913/control');

    expect(await screen.findByText('Capitale ?')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: /Révéler/ }).click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:reveal', { pin: '482913' });
  });

  it('le bouton « Partager » diffuse le lien de la partie (Web Share)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({});
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, canShare: () => false });

    renderApp('/present/482913/control');
    const btn = await screen.findByRole('button', { name: /Partager/ });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].url).toContain('/join/482913');
    vi.unstubAllGlobals();
  });
});
