import { afterEach, describe, expect, it } from 'vitest';
import { clearPosition, readPosition, resumeAt, writePosition } from './media-position';

describe('media position', () => {
  afterEach(() => sessionStorage.clear());

  it('resumes a second before the point reached', () => {
    writePosition('123456:0:/a', { t: 12.4, ended: false });
    expect(resumeAt(readPosition('123456:0:/a'))).toBeCloseTo(11.4);
  });

  it('starts over when barely started, never played, or cleared by a restart', () => {
    expect(resumeAt({ t: 0.6, ended: false })).toBeNull();
    expect(resumeAt(readPosition('nothing'))).toBeNull();
    writePosition('k', { t: 9, ended: false });
    clearPosition('k');
    expect(resumeAt(readPosition('k'))).toBeNull();
  });

  it('does not replay a media that had ended', () => {
    expect(resumeAt({ t: 30, ended: true })).toBeNull();
  });
});
