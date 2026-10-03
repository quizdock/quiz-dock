import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetItem, storeItem, storedItem } from './storage';

describe('storage, when site data is blocked', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers nothing and keeps nothing, without throwing', () => {
    const blocked = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    expect(storedItem('k')).toBeNull();
    expect(() => storeItem('k', 'v')).not.toThrow();
    expect(() => forgetItem('k')).not.toThrow();
  });
});
