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
 * applied when the sound plays, the way ReplayGain does. A quiz picks one of
 * three levels:
 * - `-14` loud — the streaming level (music platforms, video sites);
 * - `-16` balanced — the default, voice and music alike (AES, mobile listening);
 * - `-23` calm — the broadcast level (EBU R128), plenty of headroom.
 */
export const LOUDNESS_TARGETS = [-14, -16, -23] as const;
export type LoudnessTarget = (typeof LOUDNESS_TARGETS)[number];
export const LOUDNESS_TARGET_LUFS: LoudnessTarget = -16;

/** Room kept under full scale when a quiet sound is raised. */
const HEADROOM_DBFS = -1;

/**
 * Gain that brings a sound to the target (the quiz's, {@link LOUDNESS_TARGET_LUFS}
 * by default), never so much that
 * its peak would clip. 0 when the sound was never measured.
 */
export function playbackGainDb(
  loudnessLufs: number | null,
  peakDbfs: number | null,
  targetLufs: number = LOUDNESS_TARGET_LUFS,
): number {
  if (loudnessLufs === null || !Number.isFinite(loudnessLufs)) return 0;
  const wanted = targetLufs - loudnessLufs;
  const ceiling = peakDbfs === null ? 0 : HEADROOM_DBFS - peakDbfs;
  return Math.round(Math.min(wanted, ceiling) * 10) / 10;
}

/** Bounds of a loudness measure the server keeps (below −70 LUFS is silence for BS.1770). */
export const loudnessSchema = z.number().min(-70).max(0);
/** Bounds of a sample peak, in dBFS (a decoded MP3 may overshoot full scale a little). */
export const peakDbfsSchema = z.number().min(-100).max(6);

// ─── Waveform size ────────────────────────────────────────────────────────

/** How thick a question's waveform is drawn on the screens: S 1em, M 2.5em, L 5em. */
export const WAVEFORM_SIZES = ['S', 'M', 'L'] as const;
export type WaveformSize = (typeof WAVEFORM_SIZES)[number];
export const WAVEFORM_SIZE_DEFAULT: WaveformSize = 'M';

// ─── Audio target ─────────────────────────────────────────────────────────

/**
 * Which devices play a question's sound (its MP3, or its video's track):
 * - `projection` — the big screen only, the phones stay silent (a game in one room);
 * - `projection_remote` — the big screen and the remote players (the default: a
 *   game in one room sounds the same, a remote player hears the question);
 * - `everyone` — every device, room phones included (echo if they share a room).
 *
 * A quiz sets a default, a question may override it, the host may replace the
 * quiz default for one game from the lobby. A device not targeted shows the
 * video muted, or the image.
 */
export const AUDIO_TARGETS = ['projection', 'projection_remote', 'everyone'] as const;
export type AudioTarget = (typeof AUDIO_TARGETS)[number];
export const AUDIO_TARGET_DEFAULT: AudioTarget = 'projection_remote';
export const audioTargetSchema = z.enum(AUDIO_TARGETS);

/** The target a question plays with: its own, else the game's, else the quiz's. */
export function resolveAudioTarget(
  question: AudioTarget | null | undefined,
  session: AudioTarget | null | undefined,
  quiz: AudioTarget | null | undefined,
): AudioTarget {
  return question ?? session ?? quiz ?? AUDIO_TARGET_DEFAULT;
}

/** Whether a device plays the sound: the projection, a remote player, a player in the room. */
export function playsSound(target: AudioTarget, device: 'projection' | 'remote' | 'room'): boolean {
  if (device === 'projection') return true;
  if (device === 'remote') return target !== 'projection';
  return target === 'everyone';
}

// ─── Live payload ─────────────────────────────────────────────────────────

/**
 * The media as the screens receive them: resolved URLs, and the gain each sound
 * plays at. Never an asset id — the screens have nothing to do with the bank.
 */
export type LiveVisual =
  | { kind: 'image'; url: string; alt: string | null }
  | { kind: 'video'; source: 'upload'; url: string; gainDb: number; durationMs?: number }
  | (Omit<EmbeddedVideo, 'kind' | 'source'> & { kind: 'video'; source: 'embed' });

export type LiveAudio = {
  url: string;
  durationMs: number;
  peaks: number[];
  gainDb: number;
  /** How thick the waveform is drawn ({@link WAVEFORM_SIZE_DEFAULT} when absent). */
  size?: WaveformSize;
};

export type LiveQuestionMedia = { visual: LiveVisual | null; audio: LiveAudio | null };

/** Every URL a screen should fetch ahead to play these media at once. */
export function liveMediaUrls(media: LiveQuestionMedia | null | undefined): string[] {
  if (!media) return [];
  const urls: string[] = [];
  if (media.visual && 'url' in media.visual) urls.push(media.visual.url);
  if (media.audio) urls.push(media.audio.url);
  return urls;
}

// ─── Timing ───────────────────────────────────────────────────────────────

/** Default pause kept after a question's media ends, before its time can run out (s). */
export const MEDIA_TAIL_DEFAULT_S = 3;
/** Bounds of that pause, set once per quiz. */
export const MEDIA_TAIL_MAX_S = 30;

/** How long a question's media plays, in ms: its sound, or its video; null when silent. */
export function mediaDurationMs(media: LiveQuestionMedia | null | undefined): number | null {
  if (!media) return null;
  if (media.audio) return media.audio.durationMs;
  const visual = media.visual;
  return visual?.kind === 'video' && 'durationMs' in visual && visual.durationMs
    ? visual.durationMs
    : null;
}

/**
 * The time a question really gets, in seconds: its own, stretched when its
 * media would still be playing — never cut a sound in the middle. The media
 * starts with the question, `readDelayMs` before the answers open, and must
 * end `tailS` seconds before the time runs out.
 */
export function effectiveTimeLimitS(
  timeLimitS: number,
  durationMs: number | null,
  tailS: number,
  readDelayMs: number,
): number {
  if (!durationMs) return timeLimitS;
  const needed = Math.ceil((durationMs + tailS * 1000 - readDelayMs) / 1000);
  return Math.max(timeLimitS, needed);
}
