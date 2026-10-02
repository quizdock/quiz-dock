import { describe, expect, it } from 'vitest';
import { checkTheme, contrast, parseColor, themeCss } from '../src/admin/theme';

describe('the palette (administration, lot 5)', () => {
  it('reads hex and oklch, refuses anything else', () => {
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseColor('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
    const red = parseColor('oklch(62.8% 0.2577 29.23)')!;
    expect(red.r).toBeCloseTo(1, 3);
    expect(red.g).toBeCloseTo(0, 3);
    for (const bad of [
      'red',
      'rgb(1,2,3)',
      'oklch(2 0 0)',
      'oklch(0.5 0.1 20 / 50%)',
      '#12345',
      'url(x)',
    ]) {
      expect(parseColor(bad)).toBeNull();
    }
  });

  it('measures contrast as WCAG 2 does', () => {
    expect(contrast(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 1);
    expect(contrast(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1);
  });

  it('checks only the pairs a change touches, and says by how much they fail', () => {
    expect(checkTheme({})).toEqual([]);
    expect(checkTheme({ light: { primary: '#1d4ed8' } })).toEqual([]);
    expect(checkTheme({ light: { primary: '#fde68a' } })).toEqual([
      expect.objectContaining({
        mode: 'light',
        kind: 'contrast',
        fg: 'primary-foreground',
        bg: 'primary',
        min: 4.5,
      }),
      expect.objectContaining({
        mode: 'light',
        kind: 'contrast',
        fg: 'primary',
        bg: 'background',
        min: 3,
      }),
    ]);
    expect(checkTheme({ dark: { primary: 'tomato' } })).toEqual([
      { mode: 'dark', token: 'primary', kind: 'unreadable' },
    ]);
    expect(checkTheme({ light: { background: '#000' } as never })).toEqual([
      { mode: 'light', token: 'background', kind: 'unreadable' },
    ]);
  });

  it('writes only what was changed, and nothing it cannot read', () => {
    expect(themeCss({ light: { primary: '#1d4ed8' }, dark: { primary: 'nope' } })).toBe(
      "/* The instance's palette, from its administration. */\n:root {\n  --primary: #1d4ed8;\n}\n",
    );
  });
});
