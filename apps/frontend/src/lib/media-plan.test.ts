import { describe, expect, it } from 'vitest';
import {
  audioBitrate,
  droppedTrackError,
  frameRateTarget,
  gifFrameCount,
  imageTarget,
  looksLikeSvg,
  videoBitrate,
  videoTarget,
} from './media-plan';

const MB = 1024 * 1024;

describe('media plan', () => {
  it('shrinks an image to its longest edge, and leaves a small one alone', () => {
    expect(imageTarget({ width: 4032, height: 3024 })).toEqual({
      width: 1920,
      height: 1440,
      resized: true,
    });
    expect(imageTarget({ width: 3024, height: 4032 })).toMatchObject({ width: 1440, height: 1920 });
    expect(imageTarget({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
      resized: false,
    });
  });

  it('caps a video on its short edge, portrait included, with even sides', () => {
    expect(videoTarget({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
    expect(videoTarget({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 });
    expect(videoTarget({ width: 1440, height: 1350 })).toEqual({ width: 1152, height: 1080 });
    // Within bounds: nothing imposed, so the file is copied.
    expect(videoTarget({ width: 1080, height: 1920 })).toBeNull();
    expect(videoTarget({ width: 1920, height: 1080 })).toBeNull();
  });

  it('caps the frame rate only above 30', () => {
    expect(frameRateTarget(59.94)).toBe(30);
    expect(frameRateTarget(30)).toBeNull();
    expect(frameRateTarget(29.97)).toBeNull();
  });

  it('lowers the video bitrate to fit the limit, and refuses what cannot', () => {
    const hd = { width: 1920, height: 1080 };
    // 20 s at the usual 5 Mb/s fits 50 MB.
    expect(videoBitrate(hd, 30, 20, 50 * MB)).toBe(Math.round(1920 * 1080 * 30 * 0.08));
    // 3 minutes do not: the rate drops to fit.
    const rate = videoBitrate(hd, 30, 180, 50 * MB)!;
    expect(rate).toBeLessThan(2_500_000);
    expect(((rate + 128_000) * 180) / 8).toBeLessThan(50 * MB);
    // An hour would need less than the floor.
    expect(videoBitrate(hd, 30, 3600, 50 * MB)).toBeNull();
    // A small picture needs little: below the floor is fine when the limit is not the reason.
    expect(videoBitrate({ width: 64, height: 48 }, 30, 1, 50 * MB)).toBe(7373);
  });

  it('keeps a sound at 128 kb/s when it fits, lower when not, and refuses below 64', () => {
    expect(audioBitrate(180, 10 * MB)).toBe(128_000);
    expect(audioBitrate(900, 10 * MB)).toBeLessThan(128_000);
    expect(audioBitrate(3600, 10 * MB)).toBeNull();
  });

  it('tells an animated GIF from a still one', () => {
    const gce = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0];
    expect(gifFrameCount(Uint8Array.from([...gce]))).toBe(1);
    expect(gifFrameCount(Uint8Array.from([...gce, ...gce, ...gce]))).toBe(3);
  });

  it('spots an SVG by its declared type or its content', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeSvg(text('<svg xmlns="…"/>'), '')).toBe(true);
    expect(looksLikeSvg(text('<?xml version="1.0"?>\n<svg/>'), 'image/png')).toBe(true);
    expect(looksLikeSvg(text('anything'), 'image/svg+xml')).toBe(true);
    expect(looksLikeSvg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBe(false);
  });

  it('refuses a conversion that drops the picture or the sound', () => {
    expect(droppedTrackError([])).toBeNull();
    expect(droppedTrackError([{ type: 'video', reason: 'no_encodable_target_codec' }])).toBe(
      'media.cannot_convert_video',
    );
    expect(droppedTrackError([{ type: 'audio', reason: 'undecodable_source_codec' }])).toBe(
      'media.cannot_convert_audio',
    );
  });
});
