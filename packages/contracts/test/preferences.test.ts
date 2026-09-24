import { describe, expect, it } from 'vitest';
import { readPreferences } from '../src/preferences';

describe('readPreferences', () => {
  it('keeps the known keys that validate', () => {
    expect(readPreferences({ participantAccess: 'open' })).toEqual({ participantAccess: 'open' });
  });

  it('drops unknown keys and values that no longer validate', () => {
    expect(readPreferences({ participantAccess: 'optional', sidebar: 'rail' })).toEqual({});
  });

  it('reads anything that is not an object as no preference', () => {
    for (const raw of [null, undefined, 'open', 42, ['open']]) {
      expect(readPreferences(raw)).toEqual({});
    }
  });
});
