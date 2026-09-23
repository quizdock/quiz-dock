import { z } from 'zod';

/**
 * The media of a question: two independent slots.
 *
 * - **visual**: nothing, an image or a video, shown in one box (same ratio,
 *   `object-fit: contain`);
 * - **audio**: nothing or one MP3 track.
 *
 * A video carries its own sound, so it excludes the audio slot: two sounds at
 * once is a collision, not a feature. The rule lives in the type below and is
 * checked again by the schema, on the client before saving and on the server.
 */

/** Number of waveform values drawn by the player, each the peak of one slice, 0–1. */
export const AUDIO_PEAK_COUNT = 200;

export type EmbedProvider = 'youtube' | 'vimeo';

export type ImageVisual = { kind: 'image'; assetId: string };
export type UploadedVideo = { kind: 'video'; source: 'upload'; assetId: string };
export type EmbeddedVideo = {
  kind: 'video';
  source: 'embed';
  provider: EmbedProvider;
  videoId: string;
  startSec?: number;
  endSec?: number;
};
export type VideoVisual = UploadedVideo | EmbeddedVideo;
export type Visual = ImageVisual | VideoVisual;

export type AudioOrigin = 'upload' | 'recording';

export type Audio = {
  assetId: string;
  origin: AudioOrigin;
  durationMs: number;
  /** About {@link AUDIO_PEAK_COUNT} values between 0 and 1. */
  peaks: number[];
};

export type QuestionMedia =
  | { visual: VideoVisual; audio: null }
  | { visual: ImageVisual | null; audio: Audio | null };

/** Error code of a video paired with an audio track (translated by the clients). */
export const VIDEO_WITH_AUDIO = 'media.video_with_audio';

const assetId = z.string().length(26);

export const imageVisualSchema = z.object({ kind: z.literal('image'), assetId });

export const uploadedVideoSchema = z.object({
  kind: z.literal('video'),
  source: z.literal('upload'),
  assetId,
});

export const embeddedVideoSchema = z
  .object({
    kind: z.literal('video'),
    source: z.literal('embed'),
    provider: z.enum(['youtube', 'vimeo']),
    // What the provider's own URLs carry: letters, digits, `-` and `_`.
    videoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    startSec: z.number().int().min(0).optional(),
    endSec: z.number().int().min(1).optional(),
  })
  .refine((v) => v.startSec === undefined || v.endSec === undefined || v.endSec > v.startSec, {
    message: 'media.embed_bounds',
    path: ['endSec'],
  });

export const visualSchema = z.union([imageVisualSchema, uploadedVideoSchema, embeddedVideoSchema]);

/** Waveform peaks: the length the player draws, each value within 0–1. */
export const audioPeaksSchema = z.array(z.number().min(0).max(1)).length(AUDIO_PEAK_COUNT);

export const audioSchema = z.object({
  assetId,
  origin: z.enum(['upload', 'recording']),
  durationMs: z.number().int().positive(),
  peaks: audioPeaksSchema,
});

/** Validates a {@link QuestionMedia}: both slots, and never a video with an audio track. */
export const questionMediaSchema = z
  .object({ visual: visualSchema.nullable(), audio: audioSchema.nullable() })
  .superRefine((m, ctx) => {
    if (m.visual?.kind === 'video' && m.audio) {
      ctx.addIssue({ code: 'custom', message: VIDEO_WITH_AUDIO, path: ['audio'] });
    }
  }) as unknown as z.ZodType<QuestionMedia>;

/** No media at all — what a question starts with. */
export const NO_QUESTION_MEDIA: QuestionMedia = { visual: null, audio: null };

// ─── Loudness ─────────────────────────────────────────────────────────────

/**
 * Where every sound is brought at playback, in LUFS. Nothing is re-encoded: the
 * loudness is measured once at upload (EBU R128 / ITU-R BS.1770) and a gain is
 * applied when the sound plays, the way ReplayGain does.
 */
export const LOUDNESS_TARGET_LUFS = -16;

/** Room kept under full scale when a quiet sound is raised. */
const HEADROOM_DBFS = -1;

/**
 * Gain that brings a sound to {@link LOUDNESS_TARGET_LUFS}, never so much that
 * its peak would clip. 0 when the sound was never measured.
 */
export function playbackGainDb(loudnessLufs: number | null, peakDbfs: number | null): number {
  if (loudnessLufs === null || !Number.isFinite(loudnessLufs)) return 0;
  const wanted = LOUDNESS_TARGET_LUFS - loudnessLufs;
  const ceiling = peakDbfs === null ? 0 : HEADROOM_DBFS - peakDbfs;
  return Math.round(Math.min(wanted, ceiling) * 10) / 10;
}

/** Bounds of a loudness measure the server keeps (below −70 LUFS is silence for BS.1770). */
export const loudnessSchema = z.number().min(-70).max(0);
/** Bounds of a sample peak, in dBFS (a decoded MP3 may overshoot full scale a little). */
export const peakDbfsSchema = z.number().min(-100).max(6);

// ─── Live payload ─────────────────────────────────────────────────────────

/**
 * The media as the screens receive them: resolved URLs, and the gain each sound
 * plays at. Never an asset id — the screens have nothing to do with the bank.
 */
export type LiveVisual =
  | { kind: 'image'; url: string; alt: string | null }
  | { kind: 'video'; source: 'upload'; url: string; gainDb: number }
  | (Omit<EmbeddedVideo, 'kind' | 'source'> & { kind: 'video'; source: 'embed' });

export type LiveAudio = { url: string; durationMs: number; peaks: number[]; gainDb: number };

export type LiveQuestionMedia = { visual: LiveVisual | null; audio: LiveAudio | null };

/** Every URL a screen should fetch ahead to play these media at once. */
export function liveMediaUrls(media: LiveQuestionMedia | null | undefined): string[] {
  if (!media) return [];
  const urls: string[] = [];
  if (media.visual && 'url' in media.visual) urls.push(media.visual.url);
  if (media.audio) urls.push(media.audio.url);
  return urls;
}
