import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './use-wake-lock';

describe('useWakeLock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error — the stub is ours to remove
    delete navigator.wakeLock;
  });

  it('keeps the screen on while active, and lets it go after', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ released: false, release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    rerender({ on: false });
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
  });

  it('does nothing where the browser has no wake lock', () => {
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
