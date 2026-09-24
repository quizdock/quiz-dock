import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes } from './format';

describe('format', () => {
  it('writes sizes in the unit that reads best', () => {
    expect(formatBytes(512, 'en')).toBe('512B');
    expect(formatBytes(2_400_000, 'en')).toBe('2.4 MB');
    expect(formatBytes(870_000, 'en')).toBe('870 kB');
    // French puts a narrow no-break space before the unit.
    expect(formatBytes(12_400_000, 'fr')).toBe('12\u202fMo');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-09-24T12:00:00Z');
    expect(formatAgo('2026-09-24T11:37:00Z', 'en', now)).toBe('23 minutes ago');
    expect(formatAgo('2026-09-23T12:00:00Z', 'en', now)).toBe('yesterday');
  });
});
