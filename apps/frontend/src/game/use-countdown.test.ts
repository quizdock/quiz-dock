import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClock } from './clock';
import { useCountdown, useQuestionClock } from './use-countdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetClock();
  });
  afterEach(() => vi.useRealTimers());

  it('counts down to the server deadline, then stops ticking (audit F6)', () => {
    const endsAt = Date.now() + 2_000;
    const { result } = renderHook(() => useCountdown(endsAt));
    const tick = (ms: number) => {
      for (let t = 0; t < ms; t += 250) act(() => void vi.advanceTimersByTime(250));
    };
    expect(result.current).toBe(2);
    tick(1_000);
    expect(result.current).toBe(1);
    tick(1_500);
    // Past the deadline nothing changes on screen: no timer left to re-render the page.
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current).toBe(0);
  });
});

describe('useQuestionClock: one clock for the screen, the phones and the console (audit F5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetClock();
  });
  afterEach(() => vi.useRealTimers());

  const clock = (view: Parameters<typeof useQuestionClock>[0]) =>
    renderHook(() => useQuestionClock(view)).result.current;
  const question = (startIn: number, windowS: number, listenFirst = false) => {
    const startedAt = Date.now() + startIn;
    return {
      startedAt,
      endsAt: startedAt + windowS * 1000,
      mediaStartAt: startedAt - 30_000,
      listenFirst,
    };
  };

  it('none out of a question being answered', () => {
    expect(
      clock({ state: 'REVEAL', paused: false, pausedRemainingMs: null, question: question(0, 20) }),
    ).toBeNull();
    expect(
      clock({ state: 'ANSWERING', paused: false, pausedRemainingMs: null, question: null }),
    ).toBeNull();
  });

  it('the answers’ time, out of their whole window (lengthened by the host too)', () => {
    expect(
      clock({
        state: 'ANSWERING',
        paused: false,
        pausedRemainingMs: null,
        question: question(-15_000, 30),
      }),
    ).toEqual({ listening: false, reading: false, paused: false, remaining: 15, totalS: 30 });
  });

  it('listen first: the listening’s time until the answers open, out of the media’s', () => {
    expect(
      clock({
        state: 'ANSWERING',
        paused: false,
        pausedRemainingMs: null,
        question: question(4_000, 20, true),
      }),
    ).toEqual({ listening: true, reading: false, paused: false, remaining: 4, totalS: 30 });
  });

  it('paused, what the server froze: in the answers, or still in the listening', () => {
    expect(
      clock({
        state: 'ANSWERING',
        paused: true,
        pausedRemainingMs: 7_000,
        question: question(-13_000, 20),
      }),
    ).toEqual({ listening: false, reading: false, paused: true, remaining: 7, totalS: 20 });
    expect(
      clock({
        state: 'ANSWERING',
        paused: true,
        pausedRemainingMs: 24_000,
        question: question(10_000, 20, true),
      }),
    ).toEqual({ listening: true, reading: false, paused: true, remaining: 4, totalS: 30 });
  });

  it('the reading window: the answers’ whole time, standing until they open', () => {
    expect(
      clock({
        state: 'ANSWERING',
        paused: false,
        pausedRemainingMs: null,
        question: question(2_000, 20),
      }),
    ).toEqual({ listening: false, reading: true, paused: false, remaining: 20, totalS: 20 });
    expect(
      clock({
        state: 'ANSWERING',
        paused: true,
        pausedRemainingMs: 22_000,
        question: question(2_000, 20),
      }),
    ).toEqual({ listening: false, reading: true, paused: true, remaining: 20, totalS: 20 });
  });
});
