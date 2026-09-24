import { sniffMedia } from '@quiz-dock/contracts';
import { analyseAudio } from './audio-analysis';

export type MediaKind = 'image' | 'video' | 'audio';

/** A file refused before it leaves the browser, with the same code the server would send. */
export class MediaCheckError extends Error {
  constructor(
    readonly code: string,
    readonly params?: Record<string, string>,
  ) {
    super(code);
  }
}

/** What goes up with the file: the multipart fields the server stores with it. */
export interface PreparedUpload {
  kind: MediaKind;
  fields: {
    durationMs?: number;
    peaks?: string;
    origin?: 'upload' | 'recording';
    loudnessLufs?: number;
    peakDbfs?: number;
  };
}

/** The bytes of a file (`FileReader` where `Blob.arrayBuffer` is missing, as in jsdom). */
function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

/** Decodes a sound with the browser's own decoder (48 kHz, whatever the file's rate). */
async function decode(bytes: Uint8Array): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, 1, 48000);
  // decodeAudioData takes the buffer over: hand it a copy.
  return context.decodeAudioData(bytes.slice().buffer);
}

/** Duration of a video from its own metadata, without decoding its frames. */
function videoDurationMs(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined);
    video.onerror = () => done(undefined);
    video.src = url;
  });
}

/**
 * Checks a chosen file by its content, as the server will, and measures what
 * the players need: immediate feedback for the author, and a sound decoded
 * once here rather than on every screen. `expect` is the slot being filled.
 */
export async function prepareMediaUpload(
  file: File,
  expect: MediaKind,
  /** The file it was converted from: measured instead when this browser cannot decode the result. */
  source?: File,
): Promise<PreparedUpload> {
  const bytes = await readBytes(file);
  // A browser may encode AAC and yet have no decoder for it (Firefox without the system's codecs):
  // a sound is then measured on its original. Not a video, which may weigh a gigabyte and plays
  // well enough at its own level.
  const decodeSound = () =>
    decode(bytes).catch(async (err: unknown) => {
      if (!source || source === file || expect !== 'audio') throw err;
      return decode(await readBytes(source));
    });
  const sniffed = sniffMedia(bytes, expect);
  if (!sniffed.ok) {
    throw new MediaCheckError(
      `media.${sniffed.reason}`,
      sniffed.codec ? { codec: sniffed.codec } : undefined,
    );
  }
  if (sniffed.kind === 'image') return { kind: 'image', fields: {} };
  if (sniffed.kind === 'audio') {
    let analysis;
    try {
      analysis = analyseAudio(await decodeSound());
    } catch {
      throw new MediaCheckError('media.unreadable_mp3');
    }
    return {
      kind: 'audio',
      fields: {
        durationMs: analysis.durationMs,
        peaks: JSON.stringify(analysis.peaks),
        origin: 'upload',
        ...(analysis.loudnessLufs !== null ? { loudnessLufs: analysis.loudnessLufs } : {}),
        ...(analysis.peakDbfs !== null ? { peakDbfs: analysis.peakDbfs } : {}),
      },
    };
  }
  // A video: its duration, and the loudness of its sound when it has one.
  const fields: PreparedUpload['fields'] = {};
  const durationMs = await videoDurationMs(file);
  if (durationMs) fields.durationMs = durationMs;
  if (sniffed.hasAudio) {
    try {
      const analysis = analyseAudio(await decodeSound());
      fields.durationMs ??= analysis.durationMs;
      if (analysis.loudnessLufs !== null) fields.loudnessLufs = analysis.loudnessLufs;
      if (analysis.peakDbfs !== null) fields.peakDbfs = analysis.peakDbfs;
    } catch {
      // The sound could not be measured here: it will play at its own level.
    }
  }
  return { kind: 'video', fields };
}
