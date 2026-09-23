import { describe, expect, it } from 'vitest';
import {
  AUDIO_PEAK_COUNT,
  VIDEO_WITH_AUDIO,
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
