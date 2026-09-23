import { describe, expect, it } from 'vitest';
import { AUDIO_PEAK_COUNT } from '@quiz-dock/contracts';
import { analyseAudio, computePeaks, measureLoudness, samplePeakDbfs } from './audio-analysis';

const sine = (freq: number, amplitude: number, seconds: number, rate = 48000) =>
  Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / rate),
  );

describe('measureLoudness (ITU-R BS.1770-4)', () => {
  it('reads a full-scale 997 Hz sine on one channel as −3.01 LUFS, the standard’s reference', () => {
    expect(measureLoudness([sine(997, 1, 5)], 48000)).toBeCloseTo(-3.01, 1);
  });

  it('holds at 44.1 kHz too (filters derived per rate)', () => {
    expect(measureLoudness([sine(997, 1, 5, 44100)], 44100)).toBeCloseTo(-3.01, 1);
  });

  it('sums the two channels of a stereo sound', () => {
    const tone = sine(997, 0.1, 5);
    // −20 dBFS per channel: −23.01 mono, +3.01 for the second channel.
    expect(measureLoudness([tone, tone], 48000)).toBeCloseTo(-20, 1);
  });

  it('gates away silence: a tone with long pauses measures as the tone', () => {
    const tone = sine(997, 0.1, 3);
    const withSilence = new Float32Array(tone.length * 3);
    withSilence.set(tone, tone.length);
    expect(measureLoudness([withSilence], 48000)).toBeCloseTo(measureLoudness([tone], 48000)!, 0);
  });

  it('has nothing to say about silence or a sound under one block', () => {
    expect(measureLoudness([new Float32Array(48000)], 48000)).toBeNull();
    expect(measureLoudness([sine(997, 1, 0.2)], 48000)).toBeNull();
  });
});

describe('computePeaks', () => {
  it('draws the loudest slice at 1 and keeps the shape', () => {
    const data = new Float32Array(1000);
    data[10] = 0.25;
    data[990] = -0.5;
    const peaks = computePeaks([data], 10);
    expect(peaks).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('gives the count the contract expects, even for a tiny sound', () => {
    expect(computePeaks([Float32Array.from([0.1, 0.2])])).toHaveLength(AUDIO_PEAK_COUNT);
  });
});

describe('analyseAudio', () => {
  it('measures duration, waveform, loudness and sample peak together', () => {
    const tone = sine(997, 0.5, 2);
    const result = analyseAudio({
      numberOfChannels: 1,
      sampleRate: 48000,
      duration: 2,
      getChannelData: () => tone,
    });
    expect(result.durationMs).toBe(2000);
    expect(result.peaks).toHaveLength(AUDIO_PEAK_COUNT);
    expect(result.loudnessLufs).toBeCloseTo(-9.03, 1);
    expect(result.peakDbfs).toBeCloseTo(-6.02, 1);
    expect(samplePeakDbfs([new Float32Array(4)])).toBeNull();
  });
});
