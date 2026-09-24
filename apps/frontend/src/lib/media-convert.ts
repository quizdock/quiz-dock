import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';
import { sniffMedia } from '@quiz-dock/contracts';
import { type MediaKind, MediaCheckError } from './media-prepare';
import {
  AUDIO_BITRATE,
  type DroppedTrack,
  audioBitrate,
  droppedTrackError,
  frameRateTarget,
  gifFrameCount,
  imageTarget,
  looksLikeSvg,
  videoBitrate,
  videoTarget,
} from './media-plan';

/** Largest file the instance accepts, per kind (bytes). */
export type MediaLimits = Record<MediaKind, number>;

/** Something the author should know about the result, as an `editor` translation key. */
export type ConversionNotice = 'media.notice.gifFirstFrame';

export interface ConvertedMedia {
  file: File;
  notices: ConversionNotice[];
}

export interface ConvertOptions {
  limits: MediaLimits;
  /** 0–1, while a sound or a video is being converted. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const WEBP_QUALITY = 0.8;

const renamed = (file: File, ext: string) =>
  `${file.name.replace(/\.[^.]*$/, '') || 'media'}.${ext}`;

/**
 * Turns the file an author picked into the one format kept for its kind —
 * WebP, MP4 H.264/AAC, M4A AAC — in this browser, and leaves it untouched when
 * it is one already (a video within bounds is copied, not re-encoded). What the
 * browser cannot read or encode is refused, with the way out: another browser
 * or a dedicated tool. The heavy libraries load only here, when a file is picked.
 */
export async function convertMedia(
  file: File,
  kind: MediaKind,
  options: ConvertOptions,
): Promise<ConvertedMedia> {
  if (kind === 'image') return convertImage(file, options.limits.image);
  return convertTimed(file, kind, options);
}

// ─── Images ───────────────────────────────────────────────────────────────

async function convertImage(file: File, limit: number): Promise<ConvertedMedia> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeSvg(bytes, file.type)) throw new MediaCheckError('media.unsupported_type');
  let bitmap: ImageBitmap;
  try {
    // A phone photo is stored sideways with a note to turn it: the pixels are turned here.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new MediaCheckError('media.cannot_read');
  }
  const target = imageTarget({ width: bitmap.width, height: bitmap.height });
  const sniffed = sniffMedia(bytes, 'image');
  if (sniffed.ok && sniffed.mime === 'image/webp' && !target.resized && file.size <= limit) {
    bitmap.close();
    return { file, notices: [] };
  }
  const notices: ConversionNotice[] =
    sniffed.ok && sniffed.mime === 'image/gif' && gifFrameCount(bytes) > 1
      ? ['media.notice.gifFirstFrame']
      : [];
  const blob = await encodeWebp(bitmap, target.width, target.height);
  bitmap.close();
  return { file: new File([blob], renamed(file, 'webp'), { type: 'image/webp' }), notices };
}

/** WebP from the browser's own encoder, or from a WASM one where it has none (Safari). */
async function encodeWebp(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) throw new MediaCheckError('media.cannot_read');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  const native =
    canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
        )
      : await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  // A browser without a WebP encoder hands back a PNG instead: the type tells.
  if (native?.type === 'image/webp') return native;
  const { default: encode } = await import('@jsquash/webp/encode');
  const pixels = context.getImageData(0, 0, width, height);
  return new Blob([await encode(pixels, { quality: WEBP_QUALITY * 100 })], { type: 'image/webp' });
}

// ─── Sounds and videos ────────────────────────────────────────────────────

async function convertTimed(
  file: File,
  kind: 'video' | 'audio',
  { limits, onProgress, signal }: ConvertOptions,
): Promise<ConvertedMedia> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const format = await input.getFormat().catch(() => null);
    if (!format) throw new MediaCheckError('media.cannot_read');
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    const durationS = await input.computeDuration();
    const limit = limits[kind];
    const isMp4 = format === mb.MP4;
    // A QuickTime film in H.264/AAC only needs its packets moved into an MP4.
    const isIsobmff = isMp4 || format === mb.QTFF;

    if (kind === 'audio') {
      if (!audioTrack) throw new MediaCheckError('media.unsupported_type');
      // Already an M4A that fits: kept as it is.
      if (isMp4 && !videoTrack && audioTrack.codec === 'aac' && file.size <= limit) {
        return { file, notices: [] };
      }
    } else if (!videoTrack) {
      throw new MediaCheckError('media.no_video_track');
    }

    const plan =
      kind === 'video'
        ? await planVideo(videoTrack!, audioTrack, durationS, limit, file.size, isIsobmff)
        : null;
    const soundRate = audioBitrate(durationS, limit);
    if (kind === 'audio' && soundRate === null) throw tooLong(limit);
    if (audioTrack && !(await mb.canEncodeAudio('aac'))) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      // A sound's cover art is a picture track: not kept.
      video: kind === 'audio' ? { discard: true } : plan!.video,
      // A video copied keeps its AAC as it is; anything else is encoded to fit.
      audio: plan?.copy
        ? { codec: 'aac' }
        : {
            codec: 'aac',
            bitrate: kind === 'video' ? AUDIO_BITRATE : (soundRate ?? undefined),
            numberOfChannels: Math.min(audioTrack?.numberOfChannels ?? 2, 2),
          },
    });
    const dropped: DroppedTrack[] = conversion.discardedTracks
      .filter((d) => d.reason !== 'discarded_by_user')
      .map((d) => ({ type: d.track.type as 'video' | 'audio', reason: d.reason }));
    const refusal = droppedTrackError(dropped);
    if (refusal || !conversion.isValid) {
      throw new MediaCheckError(refusal ?? `media.cannot_convert_${kind}`);
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    const cancel = () => void conversion.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof mb.ConversionCanceledError) throw new MediaCheckError('media.canceled');
      throw new MediaCheckError(`media.cannot_convert_${kind}`);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer) throw new MediaCheckError(`media.cannot_convert_${kind}`);
    const type = kind === 'video' ? 'video/mp4' : 'audio/mp4';
    return {
      file: new File([buffer], renamed(file, kind === 'video' ? 'mp4' : 'm4a'), { type }),
      notices: [],
    };
  } finally {
    input.dispose();
  }
}

const tooLong = (limit: number) =>
  new MediaCheckError('media.too_long', { maxMb: String(Math.floor(limit / (1024 * 1024))) });

/**
 * What a video needs: nothing when it is an MP4 or a QuickTime film in H.264
 * within bounds and within the limit (its packets copied into an MP4 with its
 * index first), else an encode sized to fit. Without an H.264 encoder
 * (Firefox), only the first case.
 */
async function planVideo(
  video: InputVideoTrack,
  audio: InputAudioTrack | null,
  durationS: number,
  limit: number,
  size: number,
  isIsobmff: boolean,
) {
  const mb = await import('mediabunny');
  if (!(await video.canDecode()) && video.codec !== 'avc') {
    throw new MediaCheckError('media.cannot_read');
  }
  const display = { width: video.displayWidth, height: video.displayHeight };
  const fps = (await video.computePacketStats(120)).averagePacketRate;
  const resize = videoTarget(display);
  const frameRate = frameRateTarget(fps);
  const copyable =
    isIsobmff &&
    video.codec === 'avc' &&
    (!audio || audio.codec === 'aac') &&
    !resize &&
    frameRate === null &&
    size <= limit;
  if (copyable) return { copy: true, video: { codec: 'avc' as const } };

  if (!(await mb.canEncodeVideo('avc'))) throw new MediaCheckError('media.cannot_convert_video');
  const out = resize ?? display;
  const bitrate = videoBitrate(out, frameRate ?? fps, durationS, limit);
  if (bitrate === null) throw tooLong(limit);
  return {
    copy: false,
    video: {
      codec: 'avc' as const,
      ...(resize ? { width: resize.width, height: resize.height, fit: 'fill' as const } : {}),
      ...(frameRate ? { frameRate } : {}),
      bitrate,
      forceTranscode: true,
    },
  };
}
