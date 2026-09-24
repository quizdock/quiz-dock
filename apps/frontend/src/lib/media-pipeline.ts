import { mediaControllerFromSource, mediaControllerLimits } from '../api/generated/media/media';
import type { MediaLibraryItemDto } from '../api/generated/model';
import type { ConversionNotice, MediaLimits } from './media-convert';
import {
  type MediaKind,
  type PreparedUpload,
  prepareMediaUpload,
  readBytes,
} from './media-prepare';

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

/** Above this, the original is not hashed (read whole into memory): it is simply converted. */
const SOURCE_HASH_MAX = 512 * 1024 * 1024;

export type ReadyUpload =
  /** The same original was uploaded before (by this author, or among the global media). */
  | { reuse: MediaLibraryItemDto }
  | {
      file: File;
      prepared: PreparedUpload;
      notices: ConversionNotice[];
      /** SHA-256 of the file picked, sent along so it is recognised next time. */
      sourceSha256?: string;
    };

/** SHA-256 of a file, hex; undefined where it cannot be computed (too big, no WebCrypto). */
export async function sha256Of(file: Blob): Promise<string | undefined> {
  if (file.size > SOURCE_HASH_MAX || !globalThis.crypto?.subtle) return undefined;
  try {
    // Read from an ArrayBuffer (never shared memory): no copy of a large film.
    const bytes = (await readBytes(file)) as Uint8Array<ArrayBuffer>;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/** The author's (or the instance's) media made from this original, if any. */
async function knownSource(sha256: string, kind: MediaKind): Promise<MediaLibraryItemDto | null> {
  try {
    return (await mediaControllerFromSource(sha256, { kind })).data;
  } catch {
    return null; // 404: never uploaded — or the lookup failed, and converting is always right
  }
}

/**
 * From the file an author picked to the one that goes up. An original uploaded
 * before is recognised by its SHA-256 and reused as it is — a video re-encoded
 * never gives the same bytes twice, so the converted file could not tell.
 * Otherwise converted to its kind's format (the converter loads only now),
 * then checked and measured as the server will see it.
 */
export async function readyForUpload(
  picked: File,
  kind: MediaKind,
  options: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {},
): Promise<ReadyUpload> {
  const sourceSha256 = await sha256Of(picked);
  const known = sourceSha256 ? await knownSource(sourceSha256, kind) : null;
  if (known) return { reuse: known };
  const { convertMedia } = await import('./media-convert');
  const converted = await convertMedia(picked, kind, { ...options, limits: await mediaLimits() });
  const prepared = await prepareMediaUpload(converted.file, kind, picked);
  return { file: converted.file, prepared, notices: converted.notices, sourceSha256 };
}
