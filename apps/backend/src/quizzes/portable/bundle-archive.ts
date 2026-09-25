import { BadRequestException } from '@nestjs/common';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

/** A bundle is a zip of media: sized like a handful of uploads. */
export const IMPORT_MAX_BYTES = Number(process.env.IMPORT_MAX_BYTES ?? 50 * 1024 * 1024);

/**
 * What an archive may unpack to. The bundle can come from anyone (a shared
 * template, the community store, #21), so nothing it declares is trusted: the
 * sizes are counted on the bytes actually inflated, and inflating stops at the
 * first limit crossed.
 */
export interface ArchiveLimits {
  /** Entries in the archive, skipped ones included. */
  maxEntries: number;
  /** One kept entry, once inflated. */
  maxEntryBytes: number;
  /** Every kept entry together, once inflated. */
  maxTotalBytes: number;
}

export function archiveLimits(maxEntryBytes: number): ArchiveLimits {
  return {
    maxEntries: 2000,
    maxEntryBytes,
    // Media are already compressed (WebP, MP4, M4A): a real bundle barely
    // inflates. Twice the upload is room enough, and bounds a zip bomb.
    maxTotalBytes: 2 * IMPORT_MAX_BYTES,
  };
}

/**
 * Inflates the entries of `zip` that `keep` accepts, within `limits`.
 * Throws `import.bundle_too_large` when a limit is crossed and
 * `import.invalid_bundle` when the archive cannot be read.
 */
export function readArchive(
  zip: Uint8Array,
  keep: (name: string) => boolean,
  limits: ArchiveLimits,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let entries = 0;
  let total = 0;
  // Set from the callbacks below: typed wide so the checks after `push` are not narrowed away.
  let failure = null as 'too_large' | 'invalid' | null;

  const unzip = new Unzip((file) => {
    if (failure) return;
    entries += 1;
    if (entries > limits.maxEntries) {
      failure = 'too_large';
      return;
    }
    if (!keep(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = 'invalid';
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) {
        failure = 'too_large';
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) files[file.name] = concat(chunks, size);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  try {
    unzip.push(zip, true);
  } catch {
    failure ??= 'invalid';
  }

  if (failure === 'too_large') throw new BadRequestException('import.bundle_too_large');
  if (failure) throw new BadRequestException('import.invalid_bundle');
  return files;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
