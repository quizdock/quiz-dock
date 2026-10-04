import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The `qd-*` hooks carry no style of their own: they are there for an
 * instance's override.css (https://quizdock.github.io/docs/admin/branding/), which must not have
 * to undo anything. Only the animation classes, older than the hooks, are styled.
 */
describe('branding hooks', () => {
  it('index.css styles no hook, only the animations', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const styled = new Set(css.match(/\.qd-[a-z0-9-]+/g));
    expect([...styled].sort()).toEqual(
      [
        '.qd-breathe',
        '.qd-mark',
        '.qd-mark-ring',
        '.qd-mark-stroke',
        '.qd-mark-stroke-2',
        '.qd-pop',
        '.qd-reading',
      ].sort(),
    );
  });
});
