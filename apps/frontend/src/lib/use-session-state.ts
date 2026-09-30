import { useState } from 'react';

/**
 * A value kept for the tab's visit (sessionStorage): back on the page, it is as
 * it was left; a new tab starts on `fallback`. A convenience, never required —
 * blocked storage or an unreadable value just starts on `fallback`.
 */
export function useSessionState<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored === null) return fallback;
      const parsed: unknown = JSON.parse(stored);
      return valid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // storage blocked: the choice lasts while the page is open
    }
  };
  return [value, choose];
}

export const isString = (v: unknown): v is string => typeof v === 'string';
export const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
