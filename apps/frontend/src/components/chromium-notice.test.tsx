import { describe, expect, it } from 'vitest';
import { isChromium } from './chromium-notice';

const nav = (userAgent: string, brands?: string[]) =>
  ({
    userAgent,
    userAgentData: brands ? { brands: brands.map((brand) => ({ brand })) } : undefined,
  }) as unknown as Navigator;

describe('isChromium', () => {
  it('trusts the brand list when there is one', () => {
    expect(isChromium(nav('whatever', ['Chromium', 'Google Chrome']))).toBe(true);
    expect(isChromium(nav('whatever', ['Not A Brand']))).toBe(false);
  });

  it('reads the user agent otherwise', () => {
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
    const safari = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
    expect(isChromium(nav(chrome))).toBe(true);
    expect(isChromium(nav(firefox))).toBe(false);
    expect(isChromium(nav(safari))).toBe(false);
  });
});
