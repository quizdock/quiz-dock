import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

const MB = 1024 * 1024;

/**
 * Largest file accepted per kind, in bytes. Only sizes are imposed: quality is
 * the author's call (no resampling, no transcoding).
 * - images: `MEDIA_MAX_BYTES` (bytes, historical name), 10 MB by default;
 * - videos: `MEDIA_MAX_VIDEO_MB`, 50 by default;
 * - audio: `MEDIA_MAX_AUDIO_MB`, 10 by default.
 */
export function mediaLimits(): { image: number; video: number; audio: number } {
  return {
    image: settings.get(SETTINGS.MEDIA_MAX_BYTES),
    video: settings.get(SETTINGS.MEDIA_MAX_VIDEO_MB) * MB,
    audio: settings.get(SETTINGS.MEDIA_MAX_AUDIO_MB) * MB,
  };
}

/** What the upload stream may carry at most: the largest of the three. */
export function uploadCeiling(): number {
  const { image, video, audio } = mediaLimits();
  return Math.max(image, video, audio);
}

/** Where a media is served: the one URL the API, the snapshots and the bundles point at. */
export function mediaUrl(id: string): string {
  return `/api/v1/media/${id}`;
}
