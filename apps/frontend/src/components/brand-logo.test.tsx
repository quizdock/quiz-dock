import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The component memoises the first candidate still worth trying at module level, and
// `@/config` reads `window.__APP_CONFIG__` once at import time — so each case loads a
// fresh copy of both rather than inheriting the previous one's cursor.
async function load(config?: Partial<Window['__APP_CONFIG__']>) {
  vi.resetModules();
  window.__APP_CONFIG__ = config;
  const { BrandLogo } = await import('./brand-logo');
  const { LOGO_CANDIDATES } = await import('@/config');
  return { BrandLogo, LOGO_CANDIDATES };
}

// jsdom never fetches images, so `error` is fired by hand: the cascade is what's under
// test, not the network.
const src = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? null;
const fail = (c: HTMLElement) => fireEvent.error(c.querySelector('img')!);

afterEach(() => {
  delete window.__APP_CONFIG__;
});

describe('BrandLogo', () => {
  it('walks the branding folder best format first', async () => {
    const { BrandLogo } = await load();
    const { container } = render(<BrandLogo className="h-7" />);
    expect(container.querySelector('img')).toHaveClass('h-7');
    for (const expected of ['svg', 'avif', 'webp', 'png', 'jpg', 'jpeg', 'gif']) {
      expect(src(container)).toBe(`/branding/logo.${expected}`);
      fail(container);
    }
  });

  it('falls back to the bundled logo once the branding folder has nothing', async () => {
    const { BrandLogo, LOGO_CANDIDATES } = await load();
    const { container } = render(<BrandLogo />);
    for (let i = 1; i < LOGO_CANDIDATES.length; i++) fail(container);
    expect(src(container)).toBe(LOGO_CANDIDATES.at(-1));
    expect(src(container)).not.toContain('/branding/');
    fail(container); // even the bundled one unreachable → no broken-image icon
    expect(container.querySelector('img')).toBeNull();
  });

  it('skips the candidates that already failed when mounted again', async () => {
    const { BrandLogo } = await load();
    const first = render(<BrandLogo />);
    fail(first.container);
    expect(src(render(<BrandLogo />).container)).toBe('/branding/logo.avif');
  });

  it('short-circuits the lookup when APP_LOGO_URL is set', async () => {
    const { BrandLogo } = await load({ logoUrl: 'https://cdn.example/brand.png' });
    const { container } = render(<BrandLogo />);
    expect(src(container)).toBe('https://cdn.example/brand.png');
    fail(container);
    expect(src(container)).not.toContain('/branding/'); // straight to the bundled default
  });
});
