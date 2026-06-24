import { GameState } from '@live-quizz/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { renderApp } from '../test/harness';

const { fakeSocket, hookState } = vi.hoisted(() => ({
  fakeSocket: { emit: vi.fn() },
  hookState: { value: null as unknown },
}));
const markJoined = vi.fn();
const joinSession = vi.fn();
const loadPlayerSession = vi.fn();

vi.mock('../game/use-game-session', () => ({
  useGameSession: () => ({ view: hookState.value, socket: fakeSocket, markJoined }),
}));
vi.mock('../game/game-client', () => ({
  joinSession: (...a: unknown[]) => joinSession(...a),
  loadPlayerSession: () => loadPlayerSession(),
  loadAvatarSeed: () => null,
  saveAvatarSeed: () => undefined,
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

const PARIS = { id: 'opt-paris', text: 'Paris', color: 'red', shape: 'triangle' } as const;

describe('PlayerPage (client apprenant)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    loadPlayerSession.mockReturnValue(null);
  });

  it('no-session : affiche le pseudo, rejoint et signale markJoined', async () => {
    hookState.value = view({ status: 'no-session' });
    joinSession.mockResolvedValue({ sessionToken: 't', playerId: 'p1' });
    renderApp('/join/771122');

    fireEvent.change(await screen.findByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /C'est parti/ }));

    await waitFor(() => expect(joinSession).toHaveBeenCalledWith('771122', 'Alice', undefined));
    await waitFor(() => expect(markJoined).toHaveBeenCalled());
  });

  it('LOBBY : salle d’attente avec le pseudo', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({ state: GameState.Lobby });
    renderApp('/join/771122');

    expect(await screen.findByText(/Tu es dans la session/)).toBeInTheDocument();
    expect(screen.getByText(/« Bob »/)).toBeInTheDocument();
  });

  it('ANSWERING : taper une option émet player:submit puis verrouille', async () => {
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Capitale ?',
        options: [PARIS],
        timeLimitS: 5,
        basePoints: 1000,
        startedAt: Date.now(),
        endsAt: Date.now() + 5000,
      } as never,
    });
    renderApp('/join/771122');

    fireEvent.click(await screen.findByRole('button', { name: /Paris/ }));
    expect(fakeSocket.emit).toHaveBeenCalledWith('player:submit', {
      pin: '771122',
      questionIndex: 0,
      answer: 'opt-paris',
    });
    expect(await screen.findByText(/Réponse enregistrée/)).toBeInTheDocument();
  });

  it('multi-réponses : sélectionner plusieurs puis Valider (pas de submit au 1ᵉʳ clic)', async () => {
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        questionIndex: 0,
        type: 'multiple_choice',
        prompt: 'Lesquels ?',
        options: [
          { id: 'a', text: 'A', color: 'red', shape: 'triangle' },
          { id: 'b', text: 'B', color: 'blue', shape: 'diamond' },
        ],
        timeLimitS: 5,
        basePoints: 1000,
        startedAt: Date.now(),
        endsAt: Date.now() + 5000,
      } as never,
    });
    renderApp('/join/771122');

    fireEvent.click(await screen.findByRole('button', { name: /A/ }));
    fireEvent.click(screen.getByRole('button', { name: /B/ }));
    // Aucun submit tant que « Valider » n'est pas cliqué (sinon on perdrait au 1ᵉʳ clic).
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('player:submit', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    expect(fakeSocket.emit).toHaveBeenCalledWith('player:submit', {
      pin: '771122',
      questionIndex: 0,
      answer: ['a', 'b'],
    });
  });

  it('numérique : saisie + Valider émet un nombre', async () => {
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        questionIndex: 0,
        type: 'numeric',
        prompt: 'Combien ?',
        options: undefined,
        timeLimitS: 5,
        basePoints: 1000,
        startedAt: Date.now(),
        endsAt: Date.now() + 5000,
      } as never,
    });
    renderApp('/join/771122');

    fireEvent.change(await screen.findByPlaceholderText(/nombre/), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    expect(fakeSocket.emit).toHaveBeenCalledWith('player:submit', {
      pin: '771122',
      questionIndex: 0,
      answer: 42,
    });
  });

  it('REVEAL : feedback personnel (juste + points + rang)', async () => {
    hookState.value = view({
      state: GameState.Reveal,
      result: { correct: true, points: 850, totalScore: 850, rank: 3 },
    });
    renderApp('/join/771122');

    expect(await screen.findByText(/Juste/)).toBeInTheDocument();
    expect(screen.getByText(/\+850 points/)).toBeInTheDocument();
    expect(screen.getByText(/Rang : 3/)).toBeInTheDocument();
  });
});
