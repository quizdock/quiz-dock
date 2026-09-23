const MB = 1024 * 1024;

const megabytes = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * MB;
};

/**
 * Largest file accepted per kind, in bytes. Only sizes are imposed: quality is
 * the author's call (no resampling, no transcoding).
 * - images: `MEDIA_MAX_BYTES` (bytes, historical name), 10 MB by default;
 * - videos: `MEDIA_MAX_VIDEO_MB`, 50 by default;
 * - audio: `MEDIA_MAX_AUDIO_MB`, 10 by default.
 */
export function mediaLimits(): { image: number; video: number; audio: number } {
  const image = Number(process.env.MEDIA_MAX_BYTES);
  return {
    image: Number.isFinite(image) && image > 0 ? image : 10 * MB,
    video: megabytes(process.env.MEDIA_MAX_VIDEO_MB, 50),
    audio: megabytes(process.env.MEDIA_MAX_AUDIO_MB, 10),
  };
}

/** What the upload stream may carry at most: the largest of the three. */
export function uploadCeiling(): number {
  const { image, video, audio } = mediaLimits();
  return Math.max(image, video, audio);
}
