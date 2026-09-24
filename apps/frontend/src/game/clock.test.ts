import { afterEach, describe, expect, it } from 'vitest';
import { addClockSample, resetClock, serverNow } from './clock';

describe('server clock', () => {
  afterEach(() => resetClock());

  it('reads the server ahead of this device by the midpoint of the round trip', () => {
    // Sent at 1000, answered at 1100 (local): the server stamped 6050 in between.
    expect(addClockSample(1000, 6050, 1100)).toBe(5000);
    const local = Date.now();
    expect(serverNow() - local).toBeGreaterThanOrEqual(5000);
    expect(serverNow() - local).toBeLessThan(5050);
  });

  it('keeps the sample with the shortest round trip', () => {
    addClockSample(0, 5020, 40); // rtt 40 → +5000
    expect(addClockSample(100, 9000, 900)).toBe(5000); // rtt 800: ignored
    expect(addClockSample(1000, 5510, 1020)).toBe(4500); // rtt 20: better
  });
});
