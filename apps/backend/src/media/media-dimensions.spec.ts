import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mediaDimensions } from './media-dimensions';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const pad = (n: number) => new Array(n).fill(0);

describe('mediaDimensions', () => {
  it('reads PNG, GIF and JPEG headers', () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13),
      ascii('IHDR'),
      u32be(1920),
      u32be(1080),
      pad(8),
    );
    expect(mediaDimensions(png, 'image/png')).toEqual({ width: 1920, height: 1080 });
    const gif = bytes(ascii('GIF89a'), u16le(320), u16le(240), pad(8));
    expect(mediaDimensions(gif, 'image/gif')).toEqual({ width: 320, height: 240 });
    // SOI, an APP0 segment to skip, then SOF2 (progressive): height before width.
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0],
      u16be(6),
      pad(4),
      [0xff, 0xc2],
      u16be(11),
      [8],
      u16be(3024),
      u16be(4032),
      pad(6),
    );
    expect(mediaDimensions(jpeg, 'image/jpeg')).toEqual({ width: 4032, height: 3024 });
  });

  it('reads the three kinds of WebP', () => {
    const riff = (chunk: string, body: number[]) =>
      bytes(ascii('RIFF'), u32be(0), ascii('WEBP'), ascii(chunk), u32be(0), body);
    const lossy = riff('VP8 ', [
      ...pad(3),
      0x9d,
      0x01,
      0x2a,
      ...u16le(1920),
      ...u16le(1440),
      ...pad(4),
    ]);
    expect(mediaDimensions(lossy, 'image/webp')).toEqual({ width: 1920, height: 1440 });
    const w = 800 - 1;
    const h = 600 - 1;
    const bits = w | (h << 14);
    const lossless = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
      ...pad(4),
    ]);
    expect(mediaDimensions(lossless, 'image/webp')).toEqual({ width: 800, height: 600 });
    const extended = riff('VP8X', [...pad(4), ...u24le(1919), ...u24le(1079), ...pad(4)]);
    expect(mediaDimensions(extended, 'image/webp')).toEqual({ width: 1920, height: 1080 });
  });

  it('reads an AVIF spatial extents property', () => {
    const avif = bytes(
      u32be(20),
      ascii('ftypavif'),
      pad(8),
      u32be(20),
      ascii('ispe'),
      pad(4),
      u32be(1280),
      u32be(720),
    );
    expect(mediaDimensions(avif, 'image/avif')).toEqual({ width: 1280, height: 720 });
  });

  it("reads a real MP4's video track, and swaps the sides of a quarter-turned one", () => {
    const film = readFileSync(join(__dirname, '../../test/fixtures/media/h264-aac.mp4'));
    expect(mediaDimensions(film, 'video/mp4')).toEqual({ width: 64, height: 48 });

    const box = (type: string, ...children: number[][]) => {
      const payload = children.flat();
      return [...u32be(8 + payload.length), ...ascii(type), ...payload];
    };
    // tkhd v0: header fields (40 bytes), matrix (36), width, height (16.16).
    const matrix = [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000].flatMap((n) => u32be(n >>> 0));
    const tkhd = box('tkhd', pad(40), matrix, u32be(1920 * 65536), u32be(1080 * 65536));
    const hdlr = box('hdlr', pad(8), ascii('vide'), pad(12));
    const phone = bytes(box('moov', box('trak', tkhd, box('mdia', hdlr))));
    expect(mediaDimensions(phone, 'video/mp4')).toEqual({ width: 1080, height: 1920 });
  });

  it('says nothing of what it cannot read', () => {
    expect(mediaDimensions(bytes(pad(40)), 'image/webp')).toBeNull();
    expect(mediaDimensions(bytes(pad(40)), 'audio/mp4')).toBeNull();
    expect(mediaDimensions(bytes([1, 2]), 'image/png')).toBeNull();
  });
});
