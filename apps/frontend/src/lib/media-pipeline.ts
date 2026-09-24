import { mediaControllerLimits } from '../api/generated/media/media';
import type { ConversionNotice, MediaLimits } from './media-convert';
import { type MediaKind, type PreparedUpload, prepareMediaUpload } from './media-prepare';

let limits: Promise<MediaLimits> | null = null;

/** The instance's limits per kind, asked once per page (a failure is asked again next time). */
function mediaLimits(): Promise<MediaLimits> {
  limits ??= mediaControllerLimits().then(
    (res) => res.data,
    (err: unknown) => {
      limits = null;
      throw err;
    },
  );
  return limits;
}

export interface ReadyUpload {
  file: File;
  prepared: PreparedUpload;
  notices: ConversionNotice[];
}

/**
 * From the file an author picked to the one that goes up: converted to its
 * kind's format (the converter loads only now), then checked and measured as
 * the server will see it.
 */
export async function readyForUpload(
  picked: File,
  kind: MediaKind,
  options: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {},
): Promise<ReadyUpload> {
  const { convertMedia } = await import('./media-convert');
  const converted = await convertMedia(picked, kind, { ...options, limits: await mediaLimits() });
  const prepared = await prepareMediaUpload(converted.file, kind, picked);
  return { file: converted.file, prepared, notices: converted.notices };
}
