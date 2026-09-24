import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('media pool on a phone', () => {
  beforeEach(() => {
    vi.resetModules(); // a fresh pool: the phone's elements are module state
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reuses the elements the Join click started, question after question', async () => {
    const { claimMediaElements, releaseMedia, takeMedia } = await import('./media-pool');
    claimMediaElements();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2); // audio + video, in the gesture

    const first = takeMedia('audio', '/api/v1/media/a');
    expect(first.src).toContain('/api/v1/media/a');
    // While it plays, another sound needs another element.
    expect(takeMedia('audio', '/api/v1/media/b')).not.toBe(first);
    releaseMedia(first);
    const next = takeMedia('audio', '/api/v1/media/c');
    expect(next).toBe(first);
    expect(next.src).toContain('/api/v1/media/c');
  });

  it('loads the next question into the phone’s own element, which then plays it from its buffer', async () => {
    const { claimMediaElements, preloadMedia, takeMedia } = await import('./media-pool');
    claimMediaElements();
    const load = HTMLMediaElement.prototype.load as unknown as ReturnType<typeof vi.fn>;
    preloadMedia({
      visual: null,
      audio: { url: '/api/v1/media/next', durationMs: 1000, peaks: [], gainDb: 0 },
    });
    const loads = load.mock.calls.length;
    const el = takeMedia('audio', '/api/v1/media/next');
    expect(el.src).toContain('/api/v1/media/next');
    expect(load.mock.calls.length).toBe(loads); // not fetched a second time
  });

  it('says when what it fetched can play through — an image is not waited for', async () => {
    const { preloadMedia, takeMedia, waitedFor } = await import('./media-pool');
    const media = {
      visual: { kind: 'image' as const, url: '/img', alt: null },
      audio: { url: '/api/v1/media/snd', durationMs: 1000, peaks: [], gainDb: 0 },
    };
    expect(waitedFor(media)).toBe(true);
    expect(waitedFor({ ...media, audio: null })).toBe(false);
    let done = false;
    const ready = preloadMedia(media).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    takeMedia('audio', '/api/v1/media/snd').dispatchEvent(new Event('canplaythrough'));
    await ready;
    expect(done).toBe(true);
  });

  it('without the click (a projection), each media gets its own element', async () => {
    const { releaseMedia, takeMedia } = await import('./media-pool');
    const a = takeMedia('video', '/api/v1/media/v');
    releaseMedia(a);
    expect(takeMedia('video', '/api/v1/media/v')).not.toBe(a);
  });
});
