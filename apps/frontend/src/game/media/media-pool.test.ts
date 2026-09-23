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

  it('without the click (a projection), each media gets its own element', async () => {
    const { releaseMedia, takeMedia } = await import('./media-pool');
    const a = takeMedia('video', '/api/v1/media/v');
    releaseMedia(a);
    expect(takeMedia('video', '/api/v1/media/v')).not.toBe(a);
  });
});
