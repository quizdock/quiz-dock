import { describe, expect, it } from 'vitest';
import { sniffMedia } from '../src/media-sniff';

// ─── Tiny MP4 writer: just the boxes the sniffer walks ────────────────────

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function box(type: string, ...children: number[][]): number[] {
  const payload = children.flat();
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
}
const fullBox = (type: string, ...children: number[][]) => box(type, [0, 0, 0, 0], ...children);

const ftyp = (brand = 'isom') => box('ftyp', ascii(brand), u32(0), ascii('isommp41'));
const hdlr = (handler: string) => fullBox('hdlr', u32(0), ascii(handler), new Array(12).fill(0));

function trak(handler: string, ...codecs: string[]): number[] {
  const stsd = fullBox(
    'stsd',
    u32(codecs.length),
    ...codecs.map((c) => box(c, new Array(8).fill(0))),
  );
  return box(
    'trak',
    box('tkhd'),
    box('mdia', box('mdhd'), hdlr(handler), box('minf', box('stbl', stsd, box('stts')))),
  );
}

const mp4 = (...parts: number[][]) => Uint8Array.from(parts.flat());
const movie = (...traks: number[][]) => box('moov', box('mvhd'), ...traks);

// ─── Tiny MP3 writer: MPEG-1 Layer III, 128 kbit/s, 44.1 kHz → 417-byte frames ─

const FRAME = 417;
const frame = () => [0xff, 0xfb, 0x90, 0x00, ...new Array(FRAME - 4).fill(0)];
const id3 = (size: number) => [
  ...ascii('ID3'),
  4,
  0,
  0,
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
  ...new Array(size).fill(0),
];

describe('sniffMedia — MP4', () => {
  it('accepts H.264 with AAC, and H.264 alone', () => {
    const withSound = mp4(ftyp(), movie(trak('vide', 'avc1'), trak('soun', 'mp4a')), box('mdat'));
    expect(sniffMedia(withSound, 'video')).toEqual({
      ok: true,
      kind: 'video',
      mime: 'video/mp4',
      hasAudio: true,
    });
    const silent = mp4(ftyp('mp42'), box('mdat'), movie(trak('vide', 'avc3')));
    expect(sniffMedia(silent)).toMatchObject({ ok: true, kind: 'video', hasAudio: false });
  });

  it('refuses HEVC — the iPhone case — and names the codec', () => {
    const iphone = mp4(ftyp(), movie(trak('vide', 'hvc1'), trak('soun', 'mp4a')));
    expect(sniffMedia(iphone, 'video')).toEqual({
      ok: false,
      reason: 'unsupported_video_codec',
      codec: 'hvc1',
    });
    expect(sniffMedia(mp4(ftyp(), movie(trak('vide', 'av01'))))).toMatchObject({
      reason: 'unsupported_video_codec',
      codec: 'av01',
    });
  });

  it('refuses an audio track that is not AAC', () => {
    const opus = mp4(ftyp(), movie(trak('vide', 'avc1'), trak('soun', 'Opus')));
    expect(sniffMedia(opus)).toMatchObject({ reason: 'unsupported_audio_codec', codec: 'Opus' });
  });

  it('refuses a QuickTime movie, even named .mp4', () => {
    const mov = mp4(ftyp('qt  '), movie(trak('vide', 'avc1')));
    expect(sniffMedia(mov, 'video')).toEqual({ ok: false, reason: 'quicktime' });
  });

  it('ignores tracks nobody plays (metadata, timecode)', () => {
    const file = mp4(
      ftyp(),
      movie(trak('vide', 'avc1'), trak('meta', 'mebx'), trak('tmcd', 'tmcd')),
    );
    expect(sniffMedia(file)).toMatchObject({ ok: true, kind: 'video' });
  });

  it('takes AAC alone as a sound (M4A), and says a video slot got no picture', () => {
    const m4a = mp4(ftyp('M4A '), movie(trak('soun', 'mp4a')));
    expect(sniffMedia(m4a)).toEqual({ ok: true, kind: 'audio', mime: 'audio/mp4' });
    expect(sniffMedia(m4a, 'audio')).toEqual({ ok: true, kind: 'audio', mime: 'audio/mp4' });
    expect(sniffMedia(m4a, 'video')).toEqual({ ok: false, reason: 'no_video_track' });
  });

  it('refuses an MP4 without any track it plays, a sound not in AAC, and a truncated one', () => {
    expect(sniffMedia(mp4(ftyp(), movie()))).toMatchObject({ reason: 'no_video_track' });
    expect(sniffMedia(mp4(ftyp('M4A '), movie(trak('soun', 'Opus'))))).toMatchObject({
      reason: 'unsupported_audio_codec',
      codec: 'Opus',
    });
    expect(sniffMedia(mp4(ftyp()))).toMatchObject({ reason: 'unsupported_type' });
  });

  it('reads 64-bit box sizes', () => {
    const moov = movie(trak('vide', 'avc1'));
    const large = [
      ...u32(1),
      ...ascii('moov'),
      ...u32(0),
      ...u32(moov.length + 8),
      ...moov.slice(8),
    ];
    expect(sniffMedia(mp4(ftyp(), large))).toMatchObject({ ok: true, kind: 'video' });
  });
});

describe('sniffMedia — MP3', () => {
  it('accepts frames alone, or after an ID3 tag', () => {
    expect(sniffMedia(Uint8Array.from([...frame(), ...frame()]), 'audio')).toEqual({
      ok: true,
      kind: 'audio',
      mime: 'audio/mpeg',
    });
    expect(sniffMedia(Uint8Array.from([...id3(300), ...frame(), ...frame()]))).toMatchObject({
      kind: 'audio',
    });
  });

  it('refuses a tag followed by no audio, and a lone sync word', () => {
    expect(
      sniffMedia(Uint8Array.from([...id3(20), ...ascii('fLaC'), ...new Array(900).fill(1)])),
    ).toEqual({ ok: false, reason: 'unreadable_mp3' });
    // A frame header whose next frame is not where it says: not an MP3.
    const lone = [...frame(), ...new Array(500).fill(0x11)];
    expect(sniffMedia(Uint8Array.from(lone))).toEqual({ ok: false, reason: 'unsupported_type' });
  });

  it('refuses AAC in ADTS (layer bits 00), which also starts with a sync word', () => {
    const adts = [0xff, 0xf1, 0x50, 0x80, ...new Array(600).fill(0)];
    expect(sniffMedia(Uint8Array.from(adts))).toEqual({ ok: false, reason: 'unsupported_type' });
  });
});

describe('sniffMedia — images and expectations', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it('recognises raster images by their signature', () => {
    expect(sniffMedia(png)).toEqual({ ok: true, kind: 'image', mime: 'image/png' });
    expect(sniffMedia(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      mime: 'image/jpeg',
    });
  });

  it('refuses SVG and anything else by content', () => {
    const svg = Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(sniffMedia(svg)).toEqual({ ok: false, reason: 'unsupported_type' });
  });

  it('turns away the wrong kind as an unsupported type, without explaining its codec', () => {
    const hevc = mp4(ftyp(), movie(trak('vide', 'hvc1')));
    expect(sniffMedia(hevc, 'audio')).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(sniffMedia(png, 'video')).toEqual({ ok: false, reason: 'unsupported_type' });
  });
});
