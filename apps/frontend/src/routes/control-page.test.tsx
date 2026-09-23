import { GameState } from '@quiz-dock/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
  slide: null,
  answerCount: null,
  reveal: null,
  result: null,
  leaderboard: null,
  podium: null,
  feedbackEnabled: true,
  players: [],
  answerAccepted: null,
  fullCapture: false,
  personalTracking: true,
  pickOwnName: true,
  kicked: null,
  mode: 'manual',
  paused: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizId: null,
  quizDescription: null,
  outline: [],
  preload: null,
  mediaControl: null,
  quizHasSound: null,
  gameAudioTarget: null,
  quizHasMedia: null,
  readiness: null,
  mediaPosition: null,
  mediaWait: null,
  nav: null,
  joinBaseUrl: null,
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
    const { container } = renderApp('/session/482913/console');

    expect(await screen.findByLabelText('Code PIN')).toHaveTextContent('482913');
    expect(container.querySelector('svg[aria-label="QR code pour rejoindre"]')).toBeTruthy();
    expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    expect(screen.getByText('Alice')).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: /Démarrer/ }).click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:start', { pin: '482913' });
  });

  it('LOBBY: who hears the sound, only for a quiz with sound, sent as a session option', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      players: [{ playerId: 'p1', nickname: 'Alice', presence: 'remote' }],
      quizHasSound: true,
      quizHasMedia: true,
      gameAudioTarget: 'projection_remote',
      readiness: {
        questionIndex: 0,
        ready: 1,
        total: 2,
        players: [{ playerId: 'p1', ready: false }],
        screens: { ready: 1, total: 1 },
      },
    });
    renderApp('/session/482913/console');

    const select = await screen.findByLabelText('Qui entend le son dans cette session');
    expect(select).toHaveValue('projection_remote');
    expect(screen.getByLabelText('Participe à distance')).toBeInTheDocument();
    // Who is still loading the first question's sound: Alice, the projection is ready.
    expect(screen.getByTestId('readiness')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('readiness')).toHaveTextContent('projection prête');
    expect(screen.getByLabelText('Médias en chargement')).toBeInTheDocument();
    // The host is told the media reach the phones ahead.
    expect(screen.getByText(/quelques secondes avant/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'everyone' } });
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:options', {
      pin: '482913',
      audioTarget: 'everyone',
    });
  });

  it('LOBBY: a quiz without sound asks nothing about it', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({ quizHasSound: false, gameAudioTarget: 'projection_remote' });
    renderApp('/session/482913/console');
    await screen.findByLabelText('Code PIN');
    expect(screen.queryByText('Qui entend le son dans cette session')).not.toBeInTheDocument();
  });

  it('MEDIA_LOADING: names who is still loading, and starts anyway on request', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.MediaLoading,
      questionIndex: 1,
      players: [
        { playerId: 'p1', nickname: 'Alice', presence: 'remote' },
        { playerId: 'p2', nickname: 'Bob', presence: 'remote' },
      ],
      readiness: {
        questionIndex: 1,
        ready: 2,
        total: 3,
        players: [
          { playerId: 'p1', ready: false },
          { playerId: 'p2', ready: true },
        ],
        screens: { ready: 1, total: 1 },
      },
      mediaWait: { questionIndex: 1, until: Date.now() + 8000 },
    });
    renderApp('/session/482913/console');
    expect(await screen.findByText('Encore en chargement : Alice')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: /Lancer quand même/ }).click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:next', { pin: '482913' });
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
    renderApp('/session/482913/console');

    expect(await screen.findByText('Capitale ?')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: /Révéler/ }).click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:reveal', { pin: '482913' });
  });

  it('le bouton « Partager » diffuse le lien de la partie (Web Share)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({});
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share });

    renderApp('/session/482913/console');
    const btn = await screen.findByRole('button', { name: /Partager/ });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].url).toContain('/join/482913');
    // The link, never an image of the QR code; the PIN rides in the text.
    expect(share.mock.calls[0][0]).not.toHaveProperty('files');
    expect(share.mock.calls[0][0].text).toContain('482913');
    vi.unstubAllGlobals();
  });
});
