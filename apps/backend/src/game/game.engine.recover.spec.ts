import type { GameService } from './game.service';
import { GameEngine } from './game.engine';
import type { GameMeta } from './game.types';
import type { RedisService } from '../redis/redis.service';
import type { SessionArchiveService } from './session-archive.service';

const meta = (over: Partial<GameMeta>): GameMeta =>
  ({
    id: 'g',
    quizId: 'q',
    hostUserId: 'h',
    state: 'LOBBY',
    currentIndex: 0,
    totalQuestions: 3,
    fullCapture: false,
    title: 'T',
    language: 'en',
    createdAt: 0,
    questionStartedAt: 0,
    questionEndsAt: 0,
    mode: 'manual',
    paused: false,
    clockFrozen: false,
    reviewStep: '',
    ...over,
  }) as GameMeta;

/** Timers are process-local: after a restart the engine re-arms them from Redis. */
describe('GameEngine.recoverTimers (bindServer)', () => {
  const build = (metas: Record<string, GameMeta>) => {
    const redis = { keys: jest.fn(async () => Object.keys(metas).map((p) => `room:${p}`)) };
    const game = { getMeta: jest.fn(async (pin: string) => metas[pin] ?? null) };
    const engine = new GameEngine(
      game as unknown as GameService,
      redis as unknown as RedisService,
      {} as SessionArchiveService,
    );
    const scheduleReveal = jest
      .spyOn(engine as unknown as { scheduleReveal: () => void }, 'scheduleReveal')
      .mockImplementation(() => undefined);
    const scheduleAuto = jest
      .spyOn(
        engine as unknown as { scheduleAutoNextIfNeeded: () => Promise<void> },
        'scheduleAutoNextIfNeeded',
      )
      .mockResolvedValue(undefined);
    return { engine, scheduleReveal, scheduleAuto, redis };
  };

  it('re-arms the reveal of every question in progress, from its server deadline', async () => {
    const endsAt = Date.now() + 5_000;
    const { engine, scheduleReveal, scheduleAuto } = build({
      '111111': meta({ state: 'ANSWERING', currentIndex: 2, questionEndsAt: endsAt }),
      '222222': meta({ state: 'LOBBY' }),
      '333333': meta({ state: 'ANSWERING', currentIndex: 0, clockFrozen: true }), // paused: nothing to arm
    });
    engine.bindServer({ to: () => ({ emit: () => undefined }) } as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleReveal).toHaveBeenCalledTimes(1);
    const [ref, index, delay] = scheduleReveal.mock.calls[0] as unknown as [
      { pin: string },
      number,
      number,
    ];
    expect(ref.pin).toBe('111111');
    expect(index).toBe(2);
    expect(delay).toBeGreaterThan(4_000);
    expect(delay).toBeLessThanOrEqual(5_300);
    expect(scheduleAuto).not.toHaveBeenCalled();
  });

  it('re-arms the auto pace on a reveal or a slide, unless paused, manual or looking back', async () => {
    const { engine, scheduleReveal, scheduleAuto } = build({
      '1': meta({ state: 'REVEAL', mode: 'auto' }),
      '2': meta({ state: 'SLIDE_SHOW', mode: 'auto', slideIndex: 0 }),
      '3': meta({ state: 'REVEAL', mode: 'auto', paused: true }),
      '4': meta({ state: 'REVEAL', mode: 'manual' }),
      '5': meta({ state: 'REVEAL', mode: 'auto', reviewStep: 'q0' }),
    });
    engine.bindServer({ to: () => ({ emit: () => undefined }) } as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleAuto.mock.calls.map((c) => (c as unknown as [{ pin: string }])[0].pin)).toEqual([
      '1',
      '2',
    ]);
    expect(scheduleReveal).not.toHaveBeenCalled();
  });

  it('re-arms the end of a wait for media, from its deadline', async () => {
    const { engine } = build({
      '7': meta({ state: 'MEDIA_LOADING', currentIndex: 1, mediaWaitUntil: Date.now() + 3_000 }),
    });
    const arm = jest
      .spyOn(engine as unknown as { armMediaWait: () => void }, 'armMediaWait')
      .mockImplementation(() => undefined);
    engine.bindServer({ to: () => ({ emit: () => undefined }) } as never);
    await new Promise((r) => setTimeout(r, 10));
    const [ref, index, delay] = arm.mock.calls[0] as unknown as [{ pin: string }, number, number];
    expect([ref.pin, index]).toEqual(['7', 1]);
    expect(delay).toBeGreaterThan(2_500);
  });
});
