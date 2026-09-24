/**
 * The displayed size of an image or a video, read from its bytes — never from
 * what a browser declared. Nothing is decoded: an image is read from its
 * header, an MP4 from the header of its video track (rotation applied, as a
 * phone films sideways and flags it). `null` when the bytes do not say.
 */
export interface Dimensions {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const i32be = (b: Uint8Array, at: number) => u32be(b, at) | 0;
const fourcc = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

const sized = (width: number, height: number): Dimensions | null =>
  width > 0 && height > 0 ? { width, height } : null;

export function mediaDimensions(b: Uint8Array, mime: string): Dimensions | null {
  if (b.length < 16) return null;
  switch (mime) {
    case 'image/png':
      return sized(u32be(b, 16), u32be(b, 20));
    case 'image/gif':
      return sized(u16le(b, 6), u16le(b, 8));
    case 'image/jpeg':
      return jpeg(b);
    case 'image/webp':
      return webp(b);
    case 'image/avif':
      return avif(b);
    case 'video/mp4':
      return mp4(b);
    default:
      return null;
  }
}

/** The first start-of-frame marker (baseline, progressive…) carries the size. */
function jpeg(b: Uint8Array): Dimensions | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return sized(u16be(b, at + 7), u16be(b, at + 5));
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

/** Lossy (`VP8 `), lossless (`VP8L`) or extended (`VP8X`) WebP. */
function webp(b: Uint8Array): Dimensions | null {
  if (fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') return null;
  const chunk = fourcc(b, 12);
  if (b.length < (chunk === 'VP8L' ? 25 : 30)) return null;
  switch (chunk) {
    case 'VP8 ':
      return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    case 'VP8L': {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    case 'VP8X':
      return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
    default:
      return null;
  }
}

/** AVIF: the image spatial extents property (`ispe`) of the primary item. */
function avif(b: Uint8Array): Dimensions | null {
  // A box type, then version+flags, width and height: 16 bytes from the type on.
  const limit = Math.min(b.length - 16, 64 * 1024);
  for (let at = 4; at <= limit; at++) {
    if (b[at] === 0x69 && fourcc(b, at) === 'ispe') {
      // box type, then version+flags (4), width (4), height (4)
      return sized(u32be(b, at + 8), u32be(b, at + 12));
    }
  }
  return null;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32be(b, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = u32be(b, at + 8) * 2 ** 32 + u32be(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type: fourcc(b, at + 4), start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string) =>
  boxes(b, parent.start, parent.end).find((x) => x.type === type);

/** The video track's `tkhd`: its size (16.16 fixed point) and its rotation matrix. */
function mp4(b: Uint8Array): Dimensions | null {
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov');
  if (!moov) return null;
  for (const trak of boxes(b, moov.start, moov.end).filter((x) => x.type === 'trak')) {
    const mdia = child(b, trak, 'mdia');
    const hdlr = mdia && child(b, mdia, 'hdlr');
    if (!hdlr || fourcc(b, hdlr.start + 8) !== 'vide') continue;
    const tkhd = child(b, trak, 'tkhd');
    if (!tkhd) return null;
    // version 1 has 64-bit times: 12 more bytes before the matrix
    const base = tkhd.start + (b[tkhd.start] === 1 ? 12 : 0);
    if (base + 84 > tkhd.end) return null;
    const matrixB = i32be(b, base + 44);
    const width = Math.round(u32be(b, base + 76) / 65536);
    const height = Math.round(u32be(b, base + 80) / 65536);
    // A quarter turn swaps the sides as displayed.
    return Math.abs(matrixB) === 0x10000 ? sized(height, width) : sized(width, height);
  }
  return null;
}
