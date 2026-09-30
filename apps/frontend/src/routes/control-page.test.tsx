import { GameState } from '@quiz-dock/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { mockApi, renderApp } from '../test/harness';

const { fakeSocket, hookState } = vi.hoisted(() => ({
  // `once`/`off`: an emit with an ack also listens for the server's `error`.
  fakeSocket: { emit: vi.fn(), once: vi.fn(), off: vi.fn() },
  // `roles`: every session the page opened, by role.
  hookState: { value: null as unknown, roles: new Set<string>() },
}));

vi.mock('../game/use-game-session', () => ({
  useGameSession: (_pin: string, role: string) => {
    hookState.roles.add(role);
    return { view: hookState.value, socket: fakeSocket, markJoined: vi.fn() };
  },
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
  rateable: null,
  ...partial,
});

const quiz = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  ownerId: 'me',
  title,
  description: null,
  coverMediaId: null,
  status: 'ready',
  language: 'fr',
  feedbackEnabled: true,
  mediaTailS: 0,
  loudnessTargetLufs: -16,
  audioTarget: 'projection_remote',
  questionCount: 3,
  license: null,
  tags: [],
  editable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  ...over,
});

describe('ControlPage: who is ready in the lobby (#104)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows one count of the participants, and each one’s state', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      players: [
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bob' },
        { playerId: 'p3', nickname: 'Cy' },
      ],
      readiness: {
        questionIndex: 0,
        ready: 1,
        total: 3,
        lobby: true,
        screens: { ready: 0, total: 0 },
        players: [
          { playerId: 'p1', ready: true, pressed: true },
          { playerId: 'p2', ready: false, pressed: true },
          { playerId: 'p3', ready: false, pressed: false },
        ],
      },
    });
    renderApp('/session/482913/console');
    expect(await screen.findByTestId('readiness')).toHaveTextContent('Prêts : 1 / 3 participants');
    expect(screen.getByLabelText('Prêt')).toBeInTheDocument(); // Ada
    expect(screen.getByLabelText('Prêt, médias en chargement')).toBeInTheDocument(); // Bob
  });
});

describe('ControlPage: the Projection tab (audit F9)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the screen from the console’s own session, without opening a second one', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.roles.clear();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Capitale ?',
        options: [],
        media: null,
        startedAt: Date.now(),
        endsAt: Date.now() + 20_000,
      } as never,
      answerCount: { answered: 0, total: 3 },
    });
    renderApp('/session/482913/console');
    fireEvent.click(await screen.findByRole('tab', { name: /Projection/ }));
    expect(await screen.findByRole('heading', { name: 'Capitale ?' })).toBeInTheDocument();
    expect([...hookState.roles]).toEqual(['host']);
  });
});

describe('ControlPage: the room’s name (#89)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the default name, then renames the room from its lobby', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({ hostName: 'Billy', quizTitle: 'Capitals' });
    renderApp('/session/482913/console');
    expect(await screen.findByRole('heading', { name: 'Salon de Billy' })).toBeInTheDocument();
    expect(screen.getByText('Capitals')).toBeInTheDocument(); // the quiz, under the room

    fireEvent.click(screen.getByRole('button', { name: 'Renommer le salon' }));
    const input = screen.getByRole('textbox', { name: 'Nom du salon' });
    fireEvent.change(input, { target: { value: 'Soirée quiz' } });
    fireEvent.submit(input.closest('form')!);
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:room-name', {
      pin: '482913',
      name: 'Soirée quiz',
    });
  });
});

describe('ControlPage: the room’s next quiz (#89)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('at the podium, opens the host’s next playable quiz, results kept', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    mockApi([
      {
        method: 'GET',
        path: '/me',
        body: {
          id: 'me',
          displayName: 'Animateur',
          email: null,
          roles: ['host'],
          subject: 'local:animateur',
        },
      },
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          quiz('q2', 'Round two', { tags: ['geo'], description: 'Rivers and mountains' }),
          quiz('q6', 'Round three', { tags: ['history'] }),
          quiz('q3', 'A draft', { status: 'draft' }),
          quiz('q4', 'Someone else’s', { ownerId: 'other' }),
          quiz('q5', 'Empty', { questionCount: 0 }),
        ],
      },
    ]);
    hookState.value = view({
      state: GameState.Podium,
      quizId: 'q1',
      podium: { podium: [{ nickname: 'Ada', score: 900, rank: 1 }] },
      standings: { quizzesPlayed: 2, top: [{ nickname: 'Ada', score: 1800, rank: 1 }] },
    });
    renderApp('/session/482913/console');

    // The quiz's podium, then the room's.
    expect(await screen.findByText(/Classement du salon/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Quiz suivant/ }));
    const picker = await screen.findByRole('combobox', { name: 'Quiz' });
    fireEvent.focus(picker);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Round two/ })).toBeInTheDocument(),
    );
    // Only the host's own quizzes that can be played.
    expect(screen.queryByRole('option', { name: /A draft/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Someone else’s/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Empty/ })).toBeNull();
    // A tag narrows the list; the search looks into the description too.
    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    expect(screen.queryByRole('option', { name: /Round two/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'history' }));
    fireEvent.change(picker, { target: { value: 'mountains' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 quiz'); // counted after the search
    fireEvent.click(screen.getByRole('option', { name: /Round two/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir ce quiz/ }));
    expect(fakeSocket.emit).toHaveBeenCalledWith(
      'host:next-quiz',
      { pin: '482913', quizId: 'q2', archive: true },
      expect.any(Function),
    );
  });
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

    const select = await screen.findByLabelText('Qui entend le son dans ce quiz');
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
    expect(screen.queryByText('Qui entend le son dans ce quiz')).not.toBeInTheDocument();
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

  it('the time bar measures the answers’ window, lengthened by the host too (audit F5)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      // A 20 s question the host gave 10 s more: 15 s left of 30.
      question: {
        questionIndex: 0,
        prompt: 'Capitale ?',
        timeLimitS: 20,
        startedAt: now - 15_000,
        endsAt: now + 15_000,
      } as never,
      answerCount: { answered: 0, total: 3 },
    });
    renderApp('/session/482913/console');
    const bar = await screen.findByRole('progressbar', { name: 'Temps restant' });
    expect(Number(bar.getAttribute('aria-valuenow'))).toBe(50);
  });

  it('paused, the chrono stands still with the same sign as the screens (audit F5)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      paused: true,
      pausedRemainingMs: 7_000,
      question: {
        questionIndex: 0,
        prompt: 'Capitale ?',
        timeLimitS: 20,
        startedAt: now - 13_000,
        endsAt: now + 7_000,
      } as never,
      answerCount: { answered: 0, total: 3 },
    });
    const { container } = renderApp('/session/482913/console');
    await screen.findByText('Capitale ?');
    expect(container.querySelector('span[aria-label="Temps restant"]')).toHaveTextContent('⏸ 7');
  });

  it('carries the branding hooks: the console, its state, its chrono (lot 5)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: {
        questionIndex: 0,
        prompt: 'Capitale ?',
        timeLimitS: 20,
        startedAt: now - 5_000,
        endsAt: now + 15_000,
      } as never,
      answerCount: { answered: 0, total: 3 },
    });
    const { container } = renderApp('/session/482913/console');
    await screen.findByText('Capitale ?');
    expect(
      container.querySelector('.qd-console[data-state="ANSWERING"] .qd-chrono'),
    ).toHaveTextContent('15');
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

  it('the space bar pauses the game and resumes it — not while typing, nor in the lobby', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: { prompt: 'Capitale ?' } as never,
    });
    const { unmount } = renderApp('/session/482913/console');
    await screen.findByText('Capitale ?');
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:pause', { pin: '482913', paused: true });
    fakeSocket.emit.mockClear();
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { code: 'Space', key: ' ' });
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('host:pause', expect.anything());
    field.remove();
    unmount();
    hookState.value = view({});
    renderApp('/session/482913/console');
    await screen.findAllByText(/482\s?913/);
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('host:pause', expect.anything());
  });

  it('Tab moves the focus between controls; it cycles the views only from the page (audit F3)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: { prompt: 'Capitale ?' } as never,
    });
    renderApp('/session/482913/console');
    await screen.findByText('Capitale ?');
    // On a control, the browser keeps Tab: the keyboard can reach every button.
    const reveal = screen.getByRole('button', { name: /Révéler/ });
    expect(fireEvent.keyDown(reveal, { key: 'Tab' })).toBe(true);
    // From the page itself, Tab still switches the view.
    const selected = () => screen.getAllByRole('tab').find((t) => t.ariaSelected === 'true');
    const before = selected();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(selected()).not.toBe(before);
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

  it('LOBBY: closes the game to newcomers from the console (#57)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({});
    renderApp('/session/482913/console');

    // One control for it in every phase (UI system §2.1): the second row's toggle button.
    const lock = await screen.findByRole('button', {
      name: 'Fermer le salon aux nouveaux participants',
    });
    act(() => fireEvent.click(lock));
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:lock', { pin: '482913', locked: true });
  });

  it('ANSWERING: the host keeps the screens still, or lets them move, for the whole room (UI system §1.8)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: { prompt: 'Capitale ?' } as never,
      answerCount: { answered: 0, total: 1 },
      motion: true,
    });
    renderApp('/session/482913/console');

    const motion = await screen.findByRole('switch', { name: 'Animations' });
    expect(motion).toHaveAttribute('aria-checked', 'true');
    act(() => motion.click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:motion', { pin: '482913', on: false });
  });

  it('LOBBY: open access greys personal tracking out, and says why (#57)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({ participantAccess: 'open', personalTracking: false });
    renderApp('/session/482913/console');

    expect(await screen.findByRole('switch', { name: 'Suivi individuel' })).toBeDisabled();
    expect(screen.getByText(/Indisponible en accès libre/)).toBeInTheDocument();
  });

  it('ANSWERING: the lock set in the lobby can be lifted during the game (#57)', async () => {
    localStorage.setItem('live.localUser', 'Animateur');
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      totalQuestions: 3,
      question: { prompt: 'Capitale ?' } as never,
      answerCount: { answered: 0, total: 1 },
      joinLocked: true,
    });
    renderApp('/session/482913/console');

    const lock = await screen.findByRole('button', {
      name: 'Fermer le salon aux nouveaux participants',
    });
    expect(lock).toHaveAttribute('aria-pressed', 'true');
    act(() => lock.click());
    expect(fakeSocket.emit).toHaveBeenCalledWith('host:lock', { pin: '482913', locked: false });
  });
});
