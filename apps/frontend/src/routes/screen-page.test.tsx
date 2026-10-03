import { GameState } from '@quiz-dock/contracts';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView } from '../game/use-game-session';
import { renderApp } from '../test/harness';

const { fakeSocket, hookState } = vi.hoisted(() => ({
  fakeSocket: { emit: vi.fn(), once: vi.fn(), off: vi.fn(), on: vi.fn() },
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
  rateable: null,
  ...partial,
});

/** A question drawn on a gradient, as the projection received it. */
const withBackground = {
  questionIndex: 0,
  type: 'single_choice',
  prompt: 'Sur fond ?',
  options: [],
  startedAt: 0,
  endsAt: 0,
  timeLimitS: 20,
  background: { gradient: { angle: 90, colors: ['#ff0000', '#0000ff'] } },
  textTone: 'light',
  textOutline: true,
} as never;

const gradientOnScreen = () =>
  [...document.querySelectorAll<HTMLElement>('[style]')].some((el) =>
    el.style.backgroundImage.includes('linear-gradient'),
  );

describe('ScreenPage (projection)', () => {
  afterEach(() => vi.clearAllMocks());

  it('draws a question on its background while it is played (audit F15)', async () => {
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: withBackground,
    });
    renderApp('/session/482913/projection');
    await screen.findByText('Sur fond ?');
    expect(gradientOnScreen()).toBe(true);
  });

  it('says over the screen that its connection is lost (audit F9)', async () => {
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: withBackground,
      connectionLost: true,
    });
    renderApp('/session/482913/projection');
    expect(await screen.findByRole('status')).toHaveTextContent('Connexion perdue');
  });

  it('never draws the podium on the last question’s background (audit F15)', async () => {
    hookState.value = view({
      state: GameState.Podium,
      questionIndex: 0,
      question: withBackground,
      podium: {
        podium: [{ nickname: 'Ann', score: 900, rank: 1 }],
        feedbackEnabled: true,
      } as never,
    });
    renderApp('/session/482913/projection');
    await screen.findByText('Ann');
    expect(gradientOnScreen()).toBe(false);
  });
});

/**
 * The hooks an instance's override.css targets (https://quizdock.github.io/docs/admin/branding/):
 * they must survive changes to the markup. See also branding-hooks.test.ts.
 */
describe('ScreenPage: the branding hooks (lot 5)', () => {
  afterEach(() => vi.clearAllMocks());

  it('a question: the screen, its state, the clock, the prompt, the answers by colour', async () => {
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      question: {
        ...(withBackground as object),
        options: [
          { id: 'a', text: 'Oui', color: 'red', shape: 'triangle' },
          { id: 'b', text: 'Non', color: 'blue', shape: 'diamond' },
        ],
        startedAt: now - 2_000,
        endsAt: now + 18_000,
      } as never,
    });
    const { container } = renderApp('/session/482913/projection');
    await screen.findByText('Sur fond ?');
    const $ = (sel: string) => container.querySelector(sel);
    expect($('.qd-screen[data-state="ANSWERING"]')).not.toBeNull();
    expect($('.qd-timer[data-tone="ok"]')).not.toBeNull();
    expect($('.qd-prompt')).toHaveTextContent('Sur fond ?');
    expect($('.qd-answers .qd-answer[data-color="red"]')).toHaveTextContent('Oui');
  });

  it('a question’s picture sits where its author placed it, and the count goes up to the top band', async () => {
    const now = Date.now();
    hookState.value = view({
      state: GameState.Answering,
      questionIndex: 0,
      answerCount: { answered: 3, total: 8 },
      question: {
        questionIndex: 0,
        type: 'single_choice',
        prompt: 'Which city is this?',
        media: {
          visual: { kind: 'image', url: '/m/paris.webp', alt: 'Paris' },
          audio: null,
          position: 'left',
        },
        options: [
          { id: 'a', text: 'Lyon', color: 'red', shape: 'triangle' },
          { id: 'b', text: 'Paris', color: 'blue', shape: 'diamond' },
        ],
        startedAt: now - 2_000,
        endsAt: now + 18_000,
      } as never,
    });
    const { container } = renderApp('/session/482913/projection');
    const picture = await screen.findByRole('img', { name: 'Paris' });
    // Left of the text: the picture comes first in the row, the prompt after it.
    expect(
      picture.compareDocumentPosition(
        screen.getByRole('heading', { name: 'Which city is this?' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The count joins the clock in the top band; no band below.
    expect(container.querySelector('.qd-band .qd-answered')).toHaveTextContent('3 / 8');
    expect(container.querySelectorAll('.qd-band')).toHaveLength(1);
  });

  it('has no sound button of its own: the console controls its sound (#150)', async () => {
    hookState.value = view({ state: GameState.Lobby });
    renderApp('/session/482913/projection');
    expect(await screen.findByText('482913')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Couper le son' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rétablir le son' })).toBeNull();
  });

  it('the lobby: how to join, and who is in', async () => {
    hookState.value = view({
      state: GameState.Lobby,
      players: [{ playerId: 'p1', nickname: 'Ada' }],
    });
    const { container } = renderApp('/session/482913/projection');
    await screen.findByText('Ada');
    const $ = (sel: string) => container.querySelector(sel);
    expect($('.qd-screen[data-state="LOBBY"] .qd-lobby .qd-join-pin')).toHaveTextContent('482913');
    expect($('.qd-join-qr svg')).not.toBeNull();
    expect($('.qd-roster')).toHaveTextContent('Ada');
  });

  it('the podium, step by step', async () => {
    hookState.value = view({
      state: GameState.Podium,
      podium: {
        podium: [
          { nickname: 'Ann', score: 900, rank: 1 },
          { nickname: 'Bob', score: 700, rank: 2 },
        ],
        feedbackEnabled: true,
      } as never,
    });
    const { container } = renderApp('/session/482913/projection');
    await screen.findByText('Ann');
    expect(container.querySelector('.qd-podium .qd-podium-step[data-rank="1"]')).toHaveTextContent(
      'Ann',
    );
  });
});
