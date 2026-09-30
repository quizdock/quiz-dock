import { describe, expect, it } from 'vitest';
import { GameState, type SlideShowPayload } from '@quiz-dock/contracts';
import { backdropOf, sameBackdrop, stepKeyOf } from './step';

const slide = (over: Partial<SlideShowPayload> = {}) =>
  ({
    slideIndex: 2,
    background: null,
    textTone: 'light',
    video: null,
    ...over,
  }) as SlideShowPayload;

describe('the motion layer’s steps (UI system §1.8)', () => {
  it('a question keeps its step while it loads and is answered; its reveal and the standings are steps of their own', () => {
    const at = (state: GameState) => stepKeyOf({ state, questionIndex: 3, slide: null });
    expect(at(GameState.MediaLoading)).toBe(at(GameState.Answering));
    expect(at(GameState.QuestionShow)).toBe(at(GameState.Answering));
    expect(
      new Set([at(GameState.Answering), at(GameState.Reveal), at(GameState.Leaderboard)]).size,
    ).toBe(3);
    expect(stepKeyOf({ state: GameState.Answering, questionIndex: 4, slide: null })).not.toBe(
      at(GameState.Answering),
    );
  });

  it('each slide is a step', () => {
    const one = stepKeyOf({ state: GameState.SlideShow, questionIndex: 3, slide: slide() });
    const two = stepKeyOf({
      state: GameState.SlideShow,
      questionIndex: 3,
      slide: slide({ slideIndex: 3 }),
    });
    expect(one).not.toBe(two);
  });

  it('a step is drawn on its slide’s background or video, the question’s when it owns the screen, else the page', () => {
    const gradient = { gradient: { angle: 135, colors: ['#1e3a8a', '#0f172a'] } };
    expect(
      backdropOf(
        { state: GameState.SlideShow, slide: slide({ background: gradient }), question: null },
        false,
      ),
    ).toEqual({ background: gradient, textTone: 'light' });
    expect(
      backdropOf(
        {
          state: GameState.SlideShow,
          slide: slide({ video: { url: '/v.mp4' } as never }),
          question: null,
        },
        false,
      ),
    ).toEqual({ video: true, textTone: 'light' });
    const question = { background: { url: '/bg.webp' }, textTone: 'dark' } as never;
    expect(backdropOf({ state: GameState.Answering, slide: null, question }, true)).toEqual({
      background: { url: '/bg.webp' },
      textTone: 'dark',
    });
    expect(backdropOf({ state: GameState.Answering, slide: null, question }, false)).toBeNull();
    expect(sameBackdrop(null, null)).toBe(true);
    expect(sameBackdrop({ background: gradient, textTone: 'light' }, null)).toBe(false);
  });
});
