/**
 * The decisions of the media converter, apart from the browser APIs that carry
 * them out (see `media-convert.ts`): what size, what rate, copy or re-encode,
 * and whether a result can be kept. Pure, so they are tested without WebCodecs.
 */

/** Longest edge of an image: a projector shows 1080p, a 4K screen still reads it sharply. */
export const IMAGE_MAX_EDGE = 1920;
/** Shortest edge of a video (1080p, whether landscape or portrait). */
export const VIDEO_MAX_SHORT_EDGE = 1080;
export const VIDEO_MAX_FPS = 30;
/** Sound, alone or in a video: AAC-LC, 128 kb/s. */
export const AUDIO_BITRATE = 128_000;
/** Below this, a sound is no longer worth hearing: the file is refused instead. */
export const AUDIO_MIN_BITRATE = 64_000;
/** Bits per pixel per frame for H.264: about 5 Mb/s at 1080p30. */
const VIDEO_BITS_PER_PIXEL = 0.08;
/** Below this, a video turns to mush: the file is refused instead. */
export const VIDEO_MIN_BITRATE = 500_000;
/** What the container and the variations of the encoder take from the byte budget. */
const BUDGET_MARGIN = 0.9;

export interface Size {
  width: number;
  height: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** An image's size once its longest edge fits, and whether it had to shrink. */
export function imageTarget({ width, height }: Size, maxEdge = IMAGE_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: scale < 1,
  };
}

/**
 * A video's displayed size once its short edge fits (portrait included), with
 * even sides as H.264 4:2:0 requires; `null` when it fits already, so a file
 * within bounds is copied rather than re-encoded.
 */
export function videoTarget(
  { width, height }: Size,
  maxShortEdge = VIDEO_MAX_SHORT_EDGE,
): Size | null {
  const short = Math.min(width, height);
  if (short <= maxShortEdge) return null;
  const scale = maxShortEdge / short;
  return { width: even(width * scale), height: even(height * scale) };
}

/** The frame rate to impose, or `null` when the source is within the cap. */
export function frameRateTarget(sourceFps: number, maxFps = VIDEO_MAX_FPS): number | null {
  return sourceFps > maxFps + 0.5 ? maxFps : null;
}

/** Bits per second that fit `limitBytes` over `durationS`, what the container leaves aside. */
function budget(limitBytes: number, durationS: number): number {
  return (limitBytes * 8 * BUDGET_MARGIN) / Math.max(durationS, 0.1);
}

/**
 * The video bitrate for an encode: the usual one for its size, lowered to fit
 * the instance's limit, or `null` when even the floor would not fit.
 */
export function videoBitrate(
  { width, height }: Size,
  fps: number,
  durationS: number,
  limitBytes: number,
  audioBitrate = AUDIO_BITRATE,
): number | null {
  const usual =
    width * height * Math.min(fps || VIDEO_MAX_FPS, VIDEO_MAX_FPS) * VIDEO_BITS_PER_PIXEL;
  const fits = budget(limitBytes, durationS) - audioBitrate;
  // The floor refuses what the limit would crush, not a small picture that needs little.
  if (fits < Math.min(usual, VIDEO_MIN_BITRATE)) return null;
  return Math.round(Math.min(usual, fits));
}

/** The sound bitrate that fits the limit, or `null` when even the floor would not. */
export function audioBitrate(durationS: number, limitBytes: number): number | null {
  const rate = Math.min(AUDIO_BITRATE, budget(limitBytes, durationS));
  return rate >= AUDIO_MIN_BITRATE ? Math.round(rate) : null;
}

/**
 * Frames in a GIF, counted by their graphic control extensions (one per frame
 * of an animation). Enough to tell an animation from a still image.
 */
export function gifFrameCount(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) count++;
  }
  return count;
}

/** An SVG, whatever its name: refused before the browser turns it into pixels. */
export function looksLikeSvg(bytes: Uint8Array, declaredType: string): boolean {
  if (declaredType === 'image/svg+xml') return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

export type DroppedTrack = { type: 'video' | 'audio'; reason: string };

/**
 * A conversion that leaves out a track the author gave is not the file they
 * chose — a video with no picture, or silent: refused, with the reason. The
 * tracks dropped on purpose (a sound's cover art) are not passed here.
 */
export function droppedTrackError(dropped: DroppedTrack[]): string | null {
  const video = dropped.find((t) => t.type === 'video');
  if (video) return 'media.cannot_convert_video';
  if (dropped.some((t) => t.type === 'audio')) return 'media.cannot_convert_audio';
  return null;
}
