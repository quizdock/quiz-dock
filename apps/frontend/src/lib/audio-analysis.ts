import { AUDIO_PEAK_COUNT } from '@quiz-dock/contracts';

/**
 * What the editor measures on a sound once, while it holds the decoded samples,
 * so that no screen ever has to decode it again: the waveform the player draws,
 * the duration, the loudness and the peak the playback gain is computed from.
 */
export interface AudioAnalysis {
  durationMs: number;
  /** {@link AUDIO_PEAK_COUNT} values, the loudest slice at 1. */
  peaks: number[];
  /** Integrated loudness (EBU R128 / ITU-R BS.1770-4); null when too short or silent. */
  loudnessLufs: number | null;
  /** Sample peak in dBFS; null for pure silence. */
  peakDbfs: number | null;
}

/**
 * Waveform of a sound: the loudest sample of each of `count` slices, across
 * channels, scaled so the loudest slice reaches 1 (a quiet file still draws a
 * readable shape; its level is the playback gain's business).
 */
export function computePeaks(channels: Float32Array[], count = AUDIO_PEAK_COUNT): number[] {
  const length = channels[0]?.length ?? 0;
  const peaks = new Array<number>(count).fill(0);
  if (length === 0) return peaks;
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * length) / count));
    let max = 0;
    for (const data of channels) {
      for (let j = from; j < to && j < length; j++) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
    }
    peaks[i] = max;
  }
  const top = Math.max(...peaks);
  return top > 0 ? peaks.map((p) => Math.round((p / top) * 1000) / 1000) : peaks;
}

/** Loudest sample across channels, in dBFS. */
export function samplePeakDbfs(channels: Float32Array[]): number | null {
  let max = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
  }
  return max > 0 ? Math.round(20 * Math.log10(max) * 100) / 100 : null;
}

type Biquad = { b: [number, number, number]; a: [number, number, number] };

/**
 * The two stages of the BS.1770 K-weighting (a high shelf modelling the head,
 * then a high-pass), derived for any sample rate the way libebur128 does.
 */
function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [
      (Vh + (Vb * K) / Q + K * K) / a0,
      (2 * (K * K - Vh)) / a0,
      (Vh - (Vb * K) / Q + K * K) / a0,
    ],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = {
    b: [1, -2, 1],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  return [shelf, highPass];
}

/** Squared K-weighted samples summed per 100 ms segment, for one channel. */
function segmentEnergies(data: Float32Array, rate: number, segment: number): Float64Array {
  const [s, h] = kWeighting(rate);
  const out = new Float64Array(Math.floor(data.length / segment));
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0; // shelf state
  let u1 = 0,
    u2 = 0,
    w1 = 0,
    w2 = 0; // high-pass state
  for (let i = 0; i < out.length * segment; i++) {
    const x = data[i];
    const y = s.b[0] * x + s.b[1] * x1 + s.b[2] * x2 - s.a[1] * y1 - s.a[2] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const w = h.b[0] * y + h.b[1] * u1 + h.b[2] * u2 - h.a[1] * w1 - h.a[2] * w2;
    u2 = u1;
    u1 = y;
    w2 = w1;
    w1 = w;
    out[Math.floor(i / segment)] += w * w;
  }
  return out;
}

/** Channel weights of BS.1770 by position: L, R, C at 1, LFE ignored, surrounds at 1.41. */
const CHANNEL_WEIGHT = [1, 1, 1, 0, 1.41, 1.41];

const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);

/**
 * Integrated loudness, ITU-R BS.1770-4: K-weighted mean square over 400 ms
 * blocks overlapping by 75 %, gated at −70 LUFS, then at 10 LU under the level
 * of what passed. Null under one block, or when nothing passes the gates.
 */
export function measureLoudness(channels: Float32Array[], rate: number): number | null {
  const segment = Math.round(rate / 10);
  const energies = channels.map((c) => segmentEnergies(c, rate, segment));
  const segments = energies[0]?.length ?? 0;
  const blocks: number[] = [];
  for (let i = 0; i + 4 <= segments; i++) {
    let power = 0;
    energies.forEach((e, ch) => {
      const weight = CHANNEL_WEIGHT[ch] ?? 1;
      power += (weight * (e[i] + e[i + 1] + e[i + 2] + e[i + 3])) / (4 * segment);
    });
    blocks.push(power);
  }
  const loud = blocks.filter((p) => p > 0 && toLufs(p) > -70);
  if (loud.length === 0) return null;
  const relative = toLufs(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
  const kept = loud.filter((p) => toLufs(p) > relative);
  if (kept.length === 0) return null;
  return Math.round(toLufs(kept.reduce((a, b) => a + b, 0) / kept.length) * 10) / 10;
}

/** Everything the upload carries about a decoded sound. */
export function analyseAudio(buffer: {
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  getChannelData: (channel: number) => Float32Array;
}): AudioAnalysis {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  return {
    durationMs: Math.max(1, Math.round(buffer.duration * 1000)),
    peaks: computePeaks(channels),
    loudnessLufs: measureLoudness(channels, buffer.sampleRate),
    peakDbfs: samplePeakDbfs(channels),
  };
}
