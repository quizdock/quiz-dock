import { GameState } from '@quiz-dock/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { renderApp } from '../test/harness';

const { fakeSocket, hookState } = vi.hoisted(() => ({
  fakeSocket: { emit: vi.fn() },
  hookState: { value: null as unknown },
}));
const markJoined = vi.fn();
const claimMediaElements = vi.fn();

vi.mock('../game/media/media-pool', () => ({
  claimMediaElements: () => claimMediaElements(),
}));
vi.mock('../game/media/audio-unlock', () => ({ unlockAudio: () => Promise.resolve(true) }));
// The stage plays real media elements; here it only says how it was asked to play.
vi.mock('../game/media/question-media-stage', () => ({
  QuestionMediaStage: (p: { audible: boolean; muted: boolean; mode: string }) => (
    <div data-testid="stage" data-audible={String(p.audible)} data-muted={String(p.muted)} />
  ),
}));
const joinSession = vi.fn();
const loadPlayerSession = vi.fn();
const peekSession = vi.fn(() => Promise.resolve({ hasSound: false }));

vi.mock('../game/use-game-session', () => ({
  useGameSession: () => ({ view: hookState.value, socket: fakeSocket, markJoined }),
}));
vi.mock('../game/game-client', () => ({
  joinSession: (...a: unknown[]) => joinSession(...a),
  peekSession: () => peekSession(),
  loadPlayerSession: () => loadPlayerSession(),
  loadAvatarSeed: () => null,
  loadNickname: () => '',
  saveNickname: () => undefined,
  clearPlayerSession: () => undefined,
  saveAvatarSeed: () => undefined,
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
  nav: null,
  joinBaseUrl: null,
  ...partial,
});

const PARIS = { id: 'opt-paris', text: 'Paris', color: 'red', shape: 'triangle' } as const;

describe('PlayerPage (client participant)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    loadPlayerSession.mockReturnValue(null);
  });

  it('no-session : affiche le pseudo, rejoint et signale markJoined', async () => {
    hookState.value = view({ status: 'no-session' });
    joinSession.mockResolvedValue({ sessionToken: 't', playerId: 'p1', nickname: 'Alice' });
    renderApp('/join/771122');

    fireEvent.change(await screen.findByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /C'est parti/ }));

    await waitFor(() =>
      expect(joinSession).toHaveBeenCalledWith('771122', 'Alice', undefined, undefined),
    );
    await waitFor(() => expect(markJoined).toHaveBeenCalled());
    // A quiz without sound: nobody is asked where they play from.
    expect(screen.queryByText(/joues-tu/)).not.toBeInTheDocument();
  });

  it('no-session, quiz with sound: asks where the player is and joins remote', async () => {
    hookState.value = view({ status: 'no-session' });
    peekSession.mockResolvedValueOnce({ hasSound: true });
    joinSession.mockResolvedValue({ sessionToken: 't', playerId: 'p1', nickname: 'Alice' });
    renderApp('/join/771122');

    expect(await screen.findByRole('radio', { name: /Dans la salle/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /À distance/ }));
    fireEvent.change(screen.getByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /C'est parti/ }));

    await waitFor(() =>
      expect(joinSession).toHaveBeenCalledWith('771122', 'Alice', undefined, 'remote'),
    );
    // The click itself started the phone's media elements (iOS plays sound only from them).
    expect(claimMediaElements).toHaveBeenCalled();
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

  it('LOBBY : l’avis dit ce que la session enregistre (RG-16)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });

    // Sans compte (mode local), l'avis parle du pseudo, pas d'un compte inexistant.
    hookState.value = view({ state: GameState.Lobby });
    const guest = renderApp('/join/771122');
    expect(
      await screen.findByText(/enregistrés avec les résultats de la session/i),
    ).toBeInTheDocument();
    guest.unmount();

    hookState.value = view({ state: GameState.Lobby });
    const plain = renderApp('/join/771122', 'oidc', true);
    expect(await screen.findByText(/enregistrés sous ton compte\.$/i)).toBeInTheDocument();
    plain.unmount();

    hookState.value = view({ state: GameState.Lobby, fullCapture: true });
    const captured = renderApp('/join/771122', 'oidc', true);
    expect(await screen.findByText(/chacune de tes réponses est conservée/i)).toBeInTheDocument();
    captured.unmount();

    hookState.value = view({ state: GameState.Lobby, personalTracking: false });
    renderApp('/join/771122');
    expect(
      await screen.findByText(/résultats individuels ne sont pas enregistrés/i),
    ).toBeInTheDocument();
  });

  it("ANSWERING : l'image de la question s'affiche sur le téléphone (#41)", async () => {
    const question = {
      questionIndex: 0,
      type: 'single_choice',
      prompt: 'Qui est ce joueur ?',
      options: [PARIS],
      timeLimitS: 5,
      basePoints: 1000,
      startedAt: Date.now(),
      endsAt: Date.now() + 5000,
    };

    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        ...question,
        media: { visual: { kind: 'image', url: '/api/v1/media/abc', alt: null }, audio: null },
      } as never,
    });
    const withImage = renderApp('/join/771122');
    const img = await screen.findByRole('img', { name: /Illustration de la question/i });
    expect(img).toHaveAttribute('src', '/api/v1/media/abc');
    // Les boutons de réponse restent atteignables : l'image ne les remplace pas.
    expect(screen.getByRole('button', { name: /Paris/ })).toBeInTheDocument();
    withImage.unmount();

    // In the room, with the sound meant for the projection: the phone stays silent.
    const sound = { url: '/api/v1/media/snd', durationMs: 1000, peaks: [], gainDb: 0 };
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        ...question,
        media: { visual: null, audio: sound },
        audioTarget: 'projection_remote',
      } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findByRole('button', { name: /Paris/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Illustration de la question/i })).toBeNull();
    expect(screen.queryByTestId('stage')).toBeNull();
  });

  it('ANSWERING, remote: the phone plays the question’s sound, and its owner can mute it', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Ada',
      sessionToken: 't',
      playerId: 'p1',
    });
    const sound = { url: '/api/v1/media/snd', durationMs: 1000, peaks: [], gainDb: 0 };
    const question = {
      questionIndex: 0,
      type: 'single_choice',
      prompt: 'Quel morceau ?',
      options: [PARIS],
      timeLimitS: 5,
      basePoints: 1000,
      startedAt: Date.now(),
      endsAt: Date.now() + 5000,
      media: { visual: null, audio: sound },
    };
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      players: [{ playerId: 'p1', nickname: 'Ada', presence: 'remote' }],
      question: { ...question, audioTarget: 'projection_remote' } as never,
    });
    const heard = renderApp('/join/771122');
    const stage = await screen.findByTestId('stage');
    expect(stage).toHaveAttribute('data-audible', 'true');
    fireEvent.click(await screen.findByRole('button', { name: 'Couper le son' }));
    expect(screen.getByTestId('stage')).toHaveAttribute('data-muted', 'true');
    heard.unmount();
    sessionStorage.clear();

    // The sound kept for the projection: a remote phone still shows the question, silently.
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      players: [{ playerId: 'p1', nickname: 'Ada', presence: 'remote' }],
      question: { ...question, audioTarget: 'projection' } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findByTestId('stage')).toHaveAttribute('data-audible', 'false');
    expect(screen.queryByRole('button', { name: 'Couper le son' })).toBeNull();
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

  it('REVEAL: renders the answer explanation as Markdown when the payload carries one (#5)', async () => {
    hookState.value = view({
      state: GameState.Reveal,
      result: { correct: false, points: 0, totalScore: 0, rank: 5 },
      reveal: { distribution: {}, answerExplanation: 'Paris is the **capital**.' },
    });
    renderApp('/join/771122');

    const box = await screen.findByRole('region', { name: 'Explication' });
    expect(box.querySelector('strong')?.textContent).toBe('capital');
  });

  it('REVEAL: no explanation block when the payload has none', async () => {
    hookState.value = view({ state: GameState.Reveal, reveal: { distribution: {} } });
    renderApp('/join/771122');

    await screen.findByText(/réponses/i);
    expect(screen.queryByRole('region', { name: 'Explication' })).toBeNull();
  });
});
