import { GameState } from '@quiz-dock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { configureAnonymousParticipants } from '../config';
import { renderApp } from '../test/harness';
import { resetMixerForTests } from '../game/media/audio-mixer';

const { fakeSocket, hookState, audio } = vi.hoisted(() => ({
  fakeSocket: { emit: vi.fn(), emitWithAck: vi.fn(() => Promise.resolve({ ok: true })) },
  hookState: { value: null as unknown },
  audio: { unlocked: true },
}));
const markJoined = vi.fn();
const markReady = vi.fn();
const claimMediaElements = vi.fn();

vi.mock('../game/media/media-pool', () => ({
  claimMediaElements: () => claimMediaElements(),
  mediaElementsClaimed: () => audio.unlocked,
}));
vi.mock('../game/media/audio-unlock', () => ({
  unlockAudio: () => Promise.resolve(true),
  useAudioUnlocked: () => true,
  // No Web Audio here: the mixer builds nothing and every sound call is a no-op.
  audioContext: () => null,
  isAudioUnlocked: () => true,
}));
// The stage plays real media elements; here it only says how it was asked to play.
vi.mock('../game/media/question-media-stage', () => ({
  FollowedWaveform: (p: { follow: { t: number } | null }) => (
    <div data-testid="followed" data-t={String(p.follow?.t ?? '')} />
  ),
  QuestionMediaStage: (p: { audible: boolean; muted: boolean; mode: string }) => (
    <div data-testid="stage" data-audible={String(p.audible)} data-muted={String(p.muted)} />
  ),
}));
const joinSession = vi.fn();
const disconnectGame = vi.fn();
const loadPlayerSession = vi.fn();
const peekSession = vi.fn(() =>
  Promise.resolve({ hasSound: false, participantAccess: 'account' as 'account' | 'open' }),
);

vi.mock('../game/use-game-session', () => ({
  useGameSession: (pin: string) => ({
    view: hookState.value,
    socket: fakeSocket,
    markJoined,
    markReady,
    submitAnswer: (questionIndex: number, answer: unknown) =>
      fakeSocket.emit('player:submit', { pin, questionIndex, answer }),
  }),
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
  disconnectGame: () => disconnectGame(),
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
  answerRefusal: null,
  answerAckAt: null,
  answerPending: false,
  lobbyCount: null,
  fullCapture: false,
  personalTracking: true,
  pickOwnName: true,
  participantAccess: 'account',
  joinLocked: false,
  kicked: null,
  connectionLost: false,
  mode: 'manual',
  paused: false,
  still: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizId: null,
  quizDescription: null,
  outline: [],
  outlineSlides: [],
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
  youReady: false,
  sounds: null,
  motion: null,
  roomName: null,
  hostName: null,
  standings: null,
  scores: null,
  lobbyStartAt: null,
  rateable: null,
  ...partial,
});

const PARIS = { id: 'opt-paris', text: 'Paris', color: 'red', shape: 'triangle' } as const;

describe('PlayerPage (client participant)', () => {
  afterEach(() => {
    // This device's sound choices live in the mixer's module: back to the defaults.
    resetMixerForTests();
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
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre le salon/ }));

    await waitFor(() =>
      expect(joinSession).toHaveBeenCalledWith('771122', 'Alice', undefined, 'room'),
    );
    await waitFor(() => expect(markJoined).toHaveBeenCalled());
    // A quiz without sound still asks where they play from: remote gets the answers' text (#92).
    expect(screen.getByRole('radio', { name: /Dans la salle/ })).toBeChecked();
    expect(claimMediaElements).not.toHaveBeenCalled();
  });

  it('no-session, quiz with sound: asks where the player is and joins remote', async () => {
    hookState.value = view({ status: 'no-session' });
    peekSession.mockResolvedValueOnce({ hasSound: true, participantAccess: 'account' });
    joinSession.mockResolvedValue({ sessionToken: 't', playerId: 'p1', nickname: 'Alice' });
    renderApp('/join/771122');

    expect(await screen.findByRole('radio', { name: /Dans la salle/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /À distance/ }));
    fireEvent.change(screen.getByPlaceholderText('Votre pseudo'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre le salon/ }));

    await waitFor(() =>
      expect(joinSession).toHaveBeenCalledWith('771122', 'Alice', undefined, 'remote'),
    );
    // The click itself started the phone's media elements (iOS plays sound only from them).
    expect(claimMediaElements).toHaveBeenCalled();
  });

  it('listen first: the phone says to listen, and counts down to the answers', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Quel morceau ?',
        options: [PARIS],
        timeLimitS: 5,
        basePoints: 1000,
        startedAt: Date.now() + 8000,
        endsAt: Date.now() + 13000,
        listenFirst: true,
        media: { visual: null, audio: null },
      } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findByText(/Écoute jusqu’au bout/)).toBeInTheDocument();
    expect(screen.getByLabelText('Écoute en cours')).toHaveTextContent('🎧');
  });

  it('listen first, paused: the phone shows what is left of the listening, as the screen (audit F5)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    const startedAt = Date.now() + 10_000;
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      paused: true,
      // Frozen 4 s before the answers open: the listening's 4 s, then the answers' 20.
      pausedRemainingMs: 24_000,
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Quel morceau ?',
        options: [PARIS],
        timeLimitS: 20,
        basePoints: 1000,
        startedAt,
        endsAt: startedAt + 20_000,
        mediaStartAt: startedAt - 30_000,
        listenFirst: true,
        media: { visual: null, audio: null },
      } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findByRole('timer', { name: 'Écoute en cours' })).toHaveTextContent('4');
  });

  it('carries the branding hooks: the page, its state, the clock, the prompt, the answers (lot 5)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Capitale ?',
        options: [PARIS],
        timeLimitS: 20,
        basePoints: 1000,
        startedAt: now - 1_000,
        endsAt: now + 19_000,
        media: { visual: null, audio: null },
      } as never,
    });
    const { container } = renderApp('/join/771122');
    await screen.findByText('Capitale ?');
    const $ = (sel: string) => container.querySelector(sel);
    expect($('.qd-shell[data-shell="participant"] .qd-main')).not.toBeNull();
    expect($('.qd-player[data-state="ANSWERING"] .qd-timer')).not.toBeNull();
    expect($('.qd-player .qd-prompt')).toHaveTextContent('Capitale ?');
    expect($('.qd-player .qd-answer[data-color="red"]')).not.toBeNull();
  });

  // The question's background is the page's, in every phase of that question (#130).
  it.each([GameState.QuestionShow, GameState.Answering, GameState.Reveal, GameState.Leaderboard])(
    'the question background covers the participant page in %s',
    async (state) => {
      loadPlayerSession.mockReturnValue({
        pin: '771122',
        nickname: 'Bob',
        sessionToken: 't',
        playerId: 'p1',
      });
      const now = Date.now();
      hookState.value = view({
        state,
        questionIndex: 0,
        question: {
          questionIndex: 0,
          type: 'single_choice',
          prompt: 'Capitale ?',
          options: [PARIS],
          timeLimitS: 20,
          basePoints: 1000,
          startedAt: now - 1_000,
          endsAt: now + 19_000,
          media: { visual: null, audio: null },
          background: { gradient: { angle: 135, colors: ['#1e3a8a', '#dfdce5'] } },
        } as never,
      });
      const { container } = renderApp('/join/771122');
      await screen.findByRole('main');
      const surfaces = container.querySelectorAll<HTMLElement>('[style*="linear-gradient"]');
      // One surface, filling the page, with its own palette for the text over it.
      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]).toHaveClass('flex-1');
      expect(surfaces[0]).toHaveAttribute('data-scheme');
    },
  );

  it('MEDIA_LOADING: the phone says the question is coming', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({ state: GameState.MediaLoading, questionIndex: 1 });
    renderApp('/join/771122');
    expect(await screen.findByText('La question arrive…')).toBeInTheDocument();
  });

  it('removed from the room: says so, and offers another room (UI system §4)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({ state: GameState.Lobby, kicked: { minutes: 5 } });
    renderApp('/join/771122');
    expect(await screen.findByRole('link', { name: 'Rejoindre un autre salon' })).toHaveAttribute(
      'href',
      '/join',
    );
  });

  it('the host gone: it waits, and shows it', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({ state: GameState.HostDisconnected, hostName: 'Claire' });
    renderApp('/join/771122');
    expect(await screen.findByText(/dès que Claire revient/)).toBeInTheDocument();
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

    expect(await screen.findByText(/^dans /)).toBeInTheDocument();
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
  });

  it('leaving closes this device’s connection for good, so it can join another game (audit F1)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    hookState.value = view({ state: GameState.Lobby });
    renderApp('/join/771122');

    fireEvent.click(await screen.findByRole('button', { name: 'Quitter' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quitter' }));
    // Forgotten, not just disconnected: the next join opens a new connection.
    await waitFor(() => expect(disconnectGame).toHaveBeenCalled());
  });

  it('the host adjusting the time keeps the order a player is putting together (audit F4)', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    const now = Date.now();
    const ordering = (endsAt: number) =>
      ({
        questionIndex: 0,
        type: 'ordering',
        prompt: 'Dans l’ordre ?',
        options: ['Alpha', 'Beta', 'Gamma'].map((text) => ({ id: text, text })),
        startedAt: now - 1_000,
        endsAt,
        timeLimitS: 20,
      }) as never;
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: ordering(now + 20_000),
    });
    renderApp('/join/771122');
    await screen.findByText('Dans l’ordre ?');

    // The host adds 5 s: the same question comes back with a later end…
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: ordering(now + 25_000),
    });
    // …while the player moves Alpha down.
    fireEvent.click(screen.getAllByRole('button', { name: 'Descendre' })[0]);
    const text = () => document.body.textContent ?? '';
    await waitFor(() => expect(text().indexOf('Beta')).toBeLessThan(text().indexOf('Alpha')));
  });

  it('at the reveal, an ordering never sent is not shown as the answer', async () => {
    loadPlayerSession.mockReturnValue({
      pin: '771122',
      nickname: 'Bob',
      sessionToken: 't',
      playerId: 'p1',
    });
    const question = {
      questionIndex: 0,
      type: 'ordering',
      prompt: 'Dans l’ordre ?',
      options: ['Alpha', 'Beta', 'Gamma'].map((text) => ({ id: text, text })),
      startedAt: Date.now() - 1_000,
      endsAt: Date.now() + 20_000,
      timeLimitS: 20,
    } as never;
    hookState.value = view({ state: GameState.Answering, questionIndex: 0, question });
    renderApp('/join/771122');
    await screen.findByText('Dans l’ordre ?');
    hookState.value = view({
      state: GameState.Reveal,
      questionIndex: 0,
      question,
      reveal: { distribution: {}, correctOrder: ['Gamma', 'Beta', 'Alpha'] } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findAllByText('Dans l’ordre ?')).not.toHaveLength(0);
    expect(screen.queryByText('Ta réponse :')).toBeNull();
  });

  describe('“Ready!” in the lobby (#104)', () => {
    const session = { pin: '771122', nickname: 'Bob', sessionToken: 't', playerId: 'p1' };

    it('says so once the server took it', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({ state: GameState.Lobby });
      renderApp('/join/771122');
      fireEvent.click(await screen.findByRole('button', { name: 'Je suis prêt' }));
      await waitFor(() => expect(markReady).toHaveBeenCalledWith(true));
      expect(fakeSocket.emitWithAck).toHaveBeenCalledWith('player:ready', {
        pin: '771122',
        ready: true,
      });
    });

    it('once ready, tells what the room waits for: the quiz to come and who is ready', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({
        state: GameState.Lobby,
        youReady: true,
        quizTitle: 'Capitales',
        lobbyCount: { ready: 2, total: 5 },
      });
      renderApp('/join/771122');
      expect(await screen.findByText(/À suivre : Capitales/)).toBeInTheDocument();
      expect(screen.getByText(/5 joueurs dans le salon/)).toBeInTheDocument();
      expect(screen.getByText(/2 sur 5 prêts/)).toBeInTheDocument();
    });

    it('a new avatar stays a draft until saved: the top bar keeps the room’s, Cancel goes back', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({ state: GameState.Lobby });
      renderApp('/join/771122');
      await screen.findByText(/^dans /);
      const topbarAvatar = () =>
        document.getElementById('participant-topbar')?.querySelector('svg, img')?.outerHTML;
      const before = topbarAvatar();
      expect(before).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Avatar aléatoire/ }));
      expect(topbarAvatar()).toBe(before);
      expect(fakeSocket.emit).not.toHaveBeenCalledWith('player:avatar', expect.anything());
      fireEvent.click(screen.getByRole('button', { name: 'Garder l’avatar actuel' }));
      expect(screen.queryByRole('button', { name: 'Garder l’avatar actuel' })).toBeNull();
    });

    it('once ready, waits for the host and can take it back', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({ state: GameState.Lobby, youReady: true });
      renderApp('/join/771122');
      expect(await screen.findByText(/Prêt — en attente de l’animateur/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Pas encore' }));
      await waitFor(() => expect(markReady).toHaveBeenCalledWith(false));
    });
  });

  describe('the projection on another device, or on this one (#104)', () => {
    const session = { pin: '771122', nickname: 'Bob', sessionToken: 't', playerId: 'p1' };
    afterEach(() => {
      vi.unstubAllGlobals();
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });

    it('shares the projection’s link: the PIN, never the seat; with sound for a remote participant', async () => {
      loadPlayerSession.mockReturnValue(session);
      const share = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
      hookState.value = view({
        state: GameState.Lobby,
        players: [{ playerId: 'p1', nickname: 'Bob', presence: 'remote' }],
      });
      renderApp('/join/771122');
      fireEvent.click(await screen.findByRole('button', { name: /Partager la projection/ }));
      await waitFor(() => expect(share).toHaveBeenCalled());
      const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
      expect(url).toMatch(/\/join\/771122\/screen\?sound=1$/);
    });

    it('without a share sheet, shows the link as a QR code', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({ state: GameState.Lobby });
      renderApp('/join/771122');
      fireEvent.click(await screen.findByRole('button', { name: /Partager la projection/ }));
      expect(await screen.findByText(/Lien copié/)).toBeInTheDocument();
    });

    it('switches this phone to the big screen and back', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({ state: GameState.Lobby, hostName: 'Billy' });
      renderApp('/join/771122');
      fireEvent.click(await screen.findByRole('button', { name: 'Afficher le grand écran' }));
      // The projection's lobby: the PIN in big, the room's name as its title.
      expect(await screen.findByRole('heading', { name: 'Salon de Billy' })).toBeInTheDocument();
      expect(screen.queryByText(/^dans /)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Revenir à mes réponses' }));
      expect(await screen.findByText(/^dans /)).toBeInTheDocument();
    });
  });

  describe('in a room, between two quizzes (#89)', () => {
    const standings = {
      quizzesPlayed: 1,
      top: [{ nickname: 'Bob', score: 900, rank: 1 }],
      you: {
        score: 900,
        rank: 1,
        correct: 1,
        answered: 1,
        avgResponseMs: 1200,
        maxStreak: 1,
        quizzes: 1,
      },
    };
    const session = { pin: '771122', nickname: 'Bob', sessionToken: 't', playerId: 'p1' };
    afterEach(() => {
      audio.unlocked = true;
    });

    it('says where they stand and waits for the next quiz, the last one still to rate', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({
        state: GameState.Lobby,
        standings,
        rateable: { quizId: 'quiz-1', feedbackEnabled: true },
      });
      renderApp('/join/771122');
      expect(await screen.findByText(/Dans le salon : #1 — 900 pts/)).toBeInTheDocument();
      expect(screen.getByText(/En attente du quiz suivant/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Envoyer mon avis/ })).toBeInTheDocument();
    });

    it('asks this phone for sound when the next quiz has some and it never enabled it', async () => {
      loadPlayerSession.mockReturnValue(session);
      audio.unlocked = false;
      hookState.value = view({ state: GameState.Lobby, standings, quizHasSound: true });
      renderApp('/join/771122');
      fireEvent.click(await screen.findByRole('button', { name: /Activer le son/ }));
      expect(claimMediaElements).toHaveBeenCalled();
    });

    it('offers no rating to someone who only saw the podium', async () => {
      loadPlayerSession.mockReturnValue(session);
      hookState.value = view({
        state: GameState.Podium,
        podium: { podium: [], quizId: 'quiz-1' },
        feedbackEnabled: true,
        rateable: null,
      });
      renderApp('/join/771122');
      expect(await screen.findByText('Podium')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Envoyer mon avis/ })).toBeNull();
      // Still in the room at a podium: no way out to another PIN from here.
      expect(screen.queryByRole('link', { name: /autre partie|another/i })).toBeNull();
    });
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
      await screen.findByText(/enregistrés avec les résultats de chaque quiz/i),
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
    const background = renderApp('/join/771122');
    expect(await screen.findByRole('button', { name: /Paris/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Illustration de la question/i })).toBeNull();
    expect(screen.queryByTestId('stage')).toBeNull();
    // A background sound: no waveform on the phone, the answers keep the room (#92)…
    expect(screen.queryByTestId('followed')).toBeNull();
    background.unmount();

    // …but when the sound is the question (listen first), its waveform follows the projection's playhead.
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        ...question,
        media: { visual: null, audio: sound },
        audioTarget: 'projection_remote',
        listenFirst: true,
      } as never,
    });
    renderApp('/join/771122');
    expect(await screen.findByTestId('followed')).toBeInTheDocument();
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
    // On a phone the sound button opens its panel (one tap more); the mute is in it.
    fireEvent.click(await screen.findByRole('button', { name: 'Couper le son' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Couper le son' })[1]);
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

  it('a refused answer is never shown as saved: too late, it says so; too early, the tiles come back', async () => {
    const answering = (over: Partial<GameView>) =>
      view({
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
        ...over,
      });
    hookState.value = answering({ answerAccepted: false, answerRefusal: 'late', answerAckAt: 1 });
    const { unmount } = renderApp('/join/771122');
    expect(await screen.findByRole('alert')).toHaveTextContent(/trop tard/);
    expect(screen.queryByText(/Réponse enregistrée/)).toBeNull();
    unmount();

    hookState.value = answering({ answerAccepted: false, answerRefusal: 'early', answerAckAt: 2 });
    renderApp('/join/771122');
    expect(await screen.findByText(/Trop tôt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Paris/ })).toBeEnabled();
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

    // The answers are open: the input has the focus, the phone's keyboard with it.
    const input = await screen.findByPlaceholderText(/nombre/);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '42' } });
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

    expect(await screen.findByText('Juste !')).toBeInTheDocument();
    expect(screen.getByText('+850 points')).toBeInTheDocument();
    // Said too, in the region a screen reader follows.
    expect(screen.getByText('Juste ! +850 points')).toHaveAttribute('aria-live', 'polite');
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

  describe('participant access (#57)', () => {
    afterEach(() => configureAnonymousParticipants(false));

    it('sends to the sign-in a guest whose game requires accounts', async () => {
      configureAnonymousParticipants(true);
      hookState.value = view({ status: 'no-session' });
      const { router } = renderApp('/join/771122', 'oidc');
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    });

    it('lets a guest join a game in open access, without signing in', async () => {
      configureAnonymousParticipants(true);
      peekSession.mockResolvedValueOnce({ hasSound: false, participantAccess: 'open' });
      hookState.value = view({ status: 'no-session' });
      const { router } = renderApp('/join/771122', 'oidc');
      expect(await screen.findByPlaceholderText('Votre pseudo')).toBeInTheDocument();
      await waitFor(() => expect(peekSession).toHaveBeenCalled());
      expect(router.state.location.pathname).toBe('/join/771122');
    });
  });

  describe('image choice', () => {
    const picture = (i: number) => ({
      id: `pic-${i}`,
      text: null,
      color: ['red', 'blue', 'yellow', 'green'][i],
      shape: ['triangle', 'diamond', 'circle', 'square'][i],
      media: { url: `/api/v1/media/p${i}`, kind: 'image', alt: `Picture ${i}` },
    });
    const answering = (presence: 'room' | 'remote', multiSelect = false) => {
      loadPlayerSession.mockReturnValue({
        pin: '771122',
        nickname: 'Ada',
        sessionToken: 't',
        playerId: 'p1',
      });
      hookState.value = view({
        state: GameState.Answering,
        questionIndex: 0,
        players: [{ playerId: 'p1', nickname: 'Ada', presence }],
        question: {
          questionIndex: 0,
          type: 'image_choice',
          prompt: 'Which one is a cat?',
          options: [0, 1, 2, 3].map(picture),
          ...(multiSelect ? { multiSelect: true } : {}),
          timeLimitS: 20,
          basePoints: 1000,
          startedAt: Date.now() - 1000,
          endsAt: Date.now() + 20_000,
          media: { visual: null, audio: null },
        } as never,
      });
      return renderApp('/join/771122');
    };

    it('remote: the pictures themselves, a tap answers', async () => {
      answering('remote');
      const tile = await screen.findByRole('button', { name: 'Picture 2' });
      // Each tile shows its picture (named by the tile, the picture is part of it).
      expect(
        [...document.querySelectorAll('button img')].map((img) => img.getAttribute('src')),
      ).toEqual(['/api/v1/media/p0', '/api/v1/media/p1', '/api/v1/media/p2', '/api/v1/media/p3']);
      fireEvent.click(tile);
      expect(fakeSocket.emit).toHaveBeenCalledWith('player:submit', {
        pin: '771122',
        questionIndex: 0,
        answer: 'pic-2',
      });
    });

    it('in the room too: the pictures, in the projection’s order', async () => {
      answering('room');
      const tiles = await screen.findAllByRole('button', { name: /Picture/ });
      expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Picture 0',
        'Picture 1',
        'Picture 2',
        'Picture 3',
      ]);
      expect(document.querySelectorAll('button img')).toHaveLength(4);
    });

    it('several right pictures: ticked, then submitted', async () => {
      answering('remote', true);
      fireEvent.click(await screen.findByRole('button', { name: 'Picture 0' }));
      fireEvent.click(screen.getByRole('button', { name: 'Picture 3' }));
      expect(fakeSocket.emit).not.toHaveBeenCalledWith('player:submit', expect.anything());
      fireEvent.click(screen.getByRole('button', { name: 'Valider ma réponse' }));
      expect(fakeSocket.emit).toHaveBeenCalledWith('player:submit', {
        pin: '771122',
        questionIndex: 0,
        answer: ['pic-0', 'pic-3'],
      });
    });
  });
});
