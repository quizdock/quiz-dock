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

  it('a step fetched ahead that never came is dropped at the next preload (a projection)', async () => {
    const { preloadMedia } = await import('./media-pool');
    const made: HTMLElement[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag);
      made.push(el);
      return el;
    });
    const film = (url: string) => ({
      visual: { kind: 'video' as const, source: 'upload' as const, url, gainDb: 0 },
      audio: null,
    });
    void preloadMedia(film('/api/v1/media/next-film'));
    const [first] = made;
    expect(first.getAttribute('src')).toBe('/api/v1/media/next-film');
    // The host ended the quiz: the next preload names another step.
    void preloadMedia(film('/api/v1/media/other-film'));
    // The first one stops downloading, and leaves the pool.
    expect(first.getAttribute('src')).toBeNull();
  });

  it('without the click (a projection), each media gets its own element', async () => {
    const { releaseMedia, takeMedia } = await import('./media-pool');
    const a = takeMedia('video', '/api/v1/media/v');
    releaseMedia(a);
    expect(takeMedia('video', '/api/v1/media/v')).not.toBe(a);
  });

  it('a slide (#125): its muted video never takes the phone’s own element, left for the sound', async () => {
    const { claimMediaElements, takeMedia } = await import('./media-pool');
    claimMediaElements();
    const muted = takeMedia('video', '/api/v1/media/decor', { muted: true });
    const loud = takeMedia('video', '/api/v1/media/film');
    // The one made in the Join click plays the sound; the muted one is a fresh element.
    expect(loud).not.toBe(muted);
    expect(takeMedia('video', '/api/v1/media/other')).not.toBe(loud);
  });

  it('the next step is not fetched into an element that could not play its sound (iOS)', async () => {
    const { claimMediaElements, preloadMedia, takeMedia } = await import('./media-pool');
    claimMediaElements();
    takeMedia('audio', '/api/v1/media/slide-sound'); // the slide on screen plays in it
    const next = {
      visual: null,
      audio: { url: '/api/v1/media/question-sound', durationMs: 1000, peaks: [], gainDb: 0 },
    };
    // Not loaded: the room's wait for the question asks again once the element is free.
    await expect(preloadMedia(next)).resolves.toBe(false);
  });
});
