import { describe, expect, it } from 'vitest';
import {
  AUDIO_PEAK_COUNT,
  VIDEO_WITH_AUDIO,
  effectiveTimeLimitS,
  mediaDurationMs,
  playbackGainDb,
  questionMediaSchema,
} from '../src/question-media';

const id = (c: string) => c.repeat(26);
const image = { kind: 'image', assetId: id('I') } as const;
const video = { kind: 'video', source: 'upload', assetId: id('V') } as const;
const audio = {
  assetId: id('A'),
  origin: 'upload',
  durationMs: 12_000,
  peaks: new Array(AUDIO_PEAK_COUNT).fill(0.5),
} as const;

describe('questionMediaSchema', () => {
  it('accepts every allowed combination', () => {
    for (const media of [
      { visual: null, audio: null },
      { visual: image, audio: null },
      { visual: null, audio },
      { visual: image, audio },
      { visual: video, audio: null },
    ]) {
      expect(questionMediaSchema.safeParse(media).success).toBe(true);
    }
  });

  it('refuses a video with an audio track, with its own code', () => {
    const res = questionMediaSchema.safeParse({ visual: video, audio });
    expect(res.success).toBe(false);
    expect(res.error?.issues.map((i) => i.message)).toContain(VIDEO_WITH_AUDIO);
  });

  it('refuses an embedded video with an audio track too', () => {
    const embed = { kind: 'video', source: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ' };
    expect(questionMediaSchema.safeParse({ visual: embed, audio: null }).success).toBe(true);
    expect(questionMediaSchema.safeParse({ visual: embed, audio }).success).toBe(false);
  });

  it('checks the waveform: its length and its bounds', () => {
    const short = { ...audio, peaks: [0.1, 0.2] };
    const loud = { ...audio, peaks: [...audio.peaks.slice(1), 1.5] };
    expect(questionMediaSchema.safeParse({ visual: null, audio: short }).success).toBe(false);
    expect(questionMediaSchema.safeParse({ visual: null, audio: loud }).success).toBe(false);
  });

  it('refuses an embed whose end comes before its start, and an id that is not one', () => {
    const embed = { kind: 'video', source: 'embed', provider: 'vimeo', videoId: '76979871' };
    const bounds = { ...embed, startSec: 30, endSec: 10 };
    const injected = { ...embed, videoId: '"><script>' };
    expect(questionMediaSchema.safeParse({ visual: bounds, audio: null }).success).toBe(false);
    expect(questionMediaSchema.safeParse({ visual: injected, audio: null }).success).toBe(false);
  });
});

describe('playbackGainDb', () => {
  it('brings a sound to the target, never past its clipping point', () => {
    expect(playbackGainDb(-23, -10)).toBe(7);
    expect(playbackGainDb(-8, -0.1)).toBe(-8);
    // A quiet sound with a loud peak is raised only up to the headroom.
    expect(playbackGainDb(-30, -4)).toBe(3);
  });

  it('leaves an unmeasured sound alone', () => {
    expect(playbackGainDb(null, null)).toBe(0);
  });
});

describe('effectiveTimeLimitS', () => {
  it('keeps the question’s time when the media ends in it, with its pause', () => {
    // 10 s sound, starts 3 s before the answers: ends 7 s in, +3 s pause → 10 s ≤ 20 s.
    expect(effectiveTimeLimitS(20, 10_000, 3, 3000)).toBe(20);
  });

  it('stretches it to the end of a longer media plus the pause', () => {
    // 42 s sound → ends 39 s after the answers open, +3 s → 42 s.
    expect(effectiveTimeLimitS(20, 42_000, 3, 3000)).toBe(42);
    expect(effectiveTimeLimitS(20, 42_500, 0, 3000)).toBe(40);
  });

  it('leaves a silent question alone', () => {
    expect(effectiveTimeLimitS(20, null, 3, 3000)).toBe(20);
  });

  it('reads the duration of the sound, or of the video', () => {
    const peaks = new Array(200).fill(0);
    expect(
      mediaDurationMs({ visual: null, audio: { url: 'a', durationMs: 5, peaks, gainDb: 0 } }),
    ).toBe(5);
    expect(
      mediaDurationMs({
        visual: { kind: 'video', source: 'upload', url: 'v', gainDb: 0, durationMs: 9 },
        audio: null,
      }),
    ).toBe(9);
    expect(mediaDurationMs({ visual: null, audio: null })).toBeNull();
  });
});
