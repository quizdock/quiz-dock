/**
 * What a media file really is, read from its bytes — never from its name or the
 * type the browser declared. The same check runs in the editor (immediate
 * feedback before an upload) and on the server (the one that decides).
 *
 * Nothing is decoded: an MP4 is read as its box tree, an MP3 as its frame
 * headers. The accepted set is what every browser plays, WebKit included:
 * MP4 with H.264 video and AAC or no audio, and MP3.
 */

/** Why a file was turned away; each reason has its own message for the author. */
export type MediaRejection =
  /** Neither an MP4 nor an MP3 (or not the one expected). */
  | 'unsupported_type'
  /** A QuickTime `.mov`, even renamed. */
  | 'quicktime'
  /** A video track in another codec than H.264 — HEVC for an iPhone film. */
  | 'unsupported_video_codec'
  /** An audio track in another codec than AAC. */
  | 'unsupported_audio_codec'
  /** An MP4 with no video track at all. */
  | 'no_video_track'
  /** Looks like an MP3 but its frames do not hold together. */
  | 'unreadable_mp3';

export type SniffResult =
  | { ok: true; kind: 'video'; mime: 'video/mp4'; hasAudio: boolean }
  | { ok: true; kind: 'audio'; mime: 'audio/mpeg' }
  | { ok: true; kind: 'image'; mime: ImageMime }
  | { ok: false; reason: MediaRejection; codec?: string };

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif';

const VIDEO_CODECS = new Set(['avc1', 'avc3']);
const AUDIO_CODECS = new Set(['mp4a']);
/** Containers on the way from `moov` down to a track's sample descriptions. */
const PATH_TO_STSD = ['mdia', 'minf', 'stbl', 'stsd'];

interface Box {
  type: string;
  /** Offset of the payload (after the header). */
  start: number;
  /** Offset just past the box. */
  end: number;
}

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

/** The boxes laid end to end in `[from, to)`; stops at the first one that does not fit. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      // 64-bit size: files under 2^53 bytes are all this reads.
      size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

function child(b: Uint8Array, parent: Box, type: string): Box | undefined {
  return boxes(b, parent.start, parent.end).find((x) => x.type === type);
}

/** `hdlr` handler of a track (`vide`, `soun`, …), or null. */
function handlerOf(b: Uint8Array, trak: Box): string | null {
  const mdia = child(b, trak, 'mdia');
  const hdlr = mdia && child(b, mdia, 'hdlr');
  // full box: version+flags (4), pre_defined (4), handler_type (4)
  return hdlr && hdlr.start + 12 <= hdlr.end ? fourcc(b, hdlr.start + 8) : null;
}

/** Sample entry types of a track (`avc1`, `hvc1`, `mp4a`, …). */
function sampleEntriesOf(b: Uint8Array, trak: Box): string[] {
  let box: Box | undefined = trak;
  for (const type of PATH_TO_STSD) {
    box = box && child(b, box, type);
  }
  if (!box || box.start + 8 > box.end) return [];
  // full box: version+flags (4), entry_count (4), then one box per entry
  return boxes(b, box.start + 8, box.end).map((x) => x.type);
}

/** Reads an MP4 container; `null` when the bytes are not one at all. */
function sniffMp4(b: Uint8Array): SniffResult | null {
  const top = boxes(b, 0, b.length);
  if (top[0]?.type !== 'ftyp' || top[0].end - top[0].start < 4) return null;
  if (fourcc(b, top[0].start) === 'qt  ') return { ok: false, reason: 'quicktime' };
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return { ok: false, reason: 'unsupported_type' };
  let video = false;
  let audio = false;
  for (const trak of boxes(b, moov.start, moov.end).filter((x) => x.type === 'trak')) {
    const handler = handlerOf(b, trak);
    // Timecode, subtitles, metadata (an iPhone adds some): not what a screen plays.
    if (handler !== 'vide' && handler !== 'soun') continue;
    for (const codec of sampleEntriesOf(b, trak)) {
      if (handler === 'vide' && !VIDEO_CODECS.has(codec)) {
        return { ok: false, reason: 'unsupported_video_codec', codec };
      }
      if (handler === 'soun' && !AUDIO_CODECS.has(codec)) {
        return { ok: false, reason: 'unsupported_audio_codec', codec };
      }
    }
    if (handler === 'vide') video = true;
    else audio = true;
  }
  if (!video) return { ok: false, reason: 'no_video_track' };
  return { ok: true, kind: 'video', mime: 'video/mp4', hasAudio: audio };
}

// ─── MP3 ──────────────────────────────────────────────────────────────────

/** kbit/s, by [MPEG-1 ? 0 : 1][bitrate index], Layer III. */
const MP3_BITRATES = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
/** Hz, by version bits (3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5) then rate index. */
const MP3_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Length of the MPEG-1/2/2.5 Layer III frame starting at `at`, or 0 if none starts there. */
function mp3FrameLength(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) return 0;
  if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[at + 1] >> 3) & 0x03;
  const layer = (b[at + 1] >> 1) & 0x03;
  const bitrateIndex = b[at + 2] >> 4;
  const rateIndex = (b[at + 2] >> 2) & 0x03;
  const padding = (b[at + 2] >> 1) & 0x01;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15) return 0;
  if (rateIndex === 3) return 0;
  const bitrate = MP3_BITRATES[version === 3 ? 0 : 1][bitrateIndex] * 1000;
  const rate = MP3_RATES[version][rateIndex];
  const coefficient = version === 3 ? 144 : 72;
  return Math.floor((coefficient * bitrate) / rate) + padding;
}

/** How far into the audio a first frame is looked for (encoder padding, junk). */
const MP3_SCAN_BYTES = 64 * 1024;

/**
 * An MP3: an optional ID3v2 tag, then Layer III frames. A single frame header
 * proves little (two bytes of any file can look like one), so the frame after
 * it must be where the first one says it is.
 */
function sniffMp3(b: Uint8Array): SniffResult | null {
  let at = 0;
  const id3 = b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  if (id3) {
    // Syncsafe size (7 bits a byte), header of 10, footer of 10 when flagged.
    const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
    at = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  const limit = Math.min(b.length, at + MP3_SCAN_BYTES);
  for (let i = at; i < limit; i++) {
    const len = mp3FrameLength(b, i);
    if (len === 0) continue;
    const next = i + len;
    if (next >= b.length || mp3FrameLength(b, next) > 0) {
      return { ok: true, kind: 'audio', mime: 'audio/mpeg' };
    }
  }
  // An ID3 tag promised audio that is not there.
  return id3 ? { ok: false, reason: 'unreadable_mp3' } : null;
}

// ─── Images ───────────────────────────────────────────────────────────────

function startsWith(b: Uint8Array, bytes: number[], at = 0): boolean {
  return bytes.every((x, i) => b[at + i] === x);
}

/** Raster images a browser shows as-is — no SVG, which is a document that can run script. */
function sniffImage(b: Uint8Array): SniffResult | null {
  const image = (mime: ImageMime): SniffResult => ({ ok: true, kind: 'image', mime });
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return image('image/png');
  if (startsWith(b, [0xff, 0xd8, 0xff])) return image('image/jpeg');
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return image('image/gif');
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) {
    return image('image/webp');
  }
  if (b.length >= 12 && fourcc(b, 4) === 'ftyp' && ['avif', 'avis'].includes(fourcc(b, 8))) {
    return image('image/avif');
  }
  return null;
}

/** The kind each rejection speaks of: an MP4 reason is about video, an MP3 one about audio. */
const REJECTION_KIND: Record<MediaRejection, 'video' | 'audio' | null> = {
  unsupported_type: null,
  quicktime: 'video',
  unsupported_video_codec: 'video',
  unsupported_audio_codec: 'video',
  no_video_track: 'video',
  unreadable_mp3: 'audio',
};

/**
 * What the bytes of an uploaded file are. `expect` narrows the answer to one
 * kind: an image picker turns a video away as an unsupported type, and only a
 * video picker explains why a video was refused.
 */
export function sniffMedia(bytes: Uint8Array, expect?: 'image' | 'video' | 'audio'): SniffResult {
  const result = sniffImage(bytes) ?? sniffMp4(bytes) ?? sniffMp3(bytes);
  if (!result) return { ok: false, reason: 'unsupported_type' };
  if (!expect) return result;
  const kind = result.ok ? result.kind : REJECTION_KIND[result.reason];
  return kind === expect ? result : { ok: false, reason: 'unsupported_type' };
}
