import { useState } from 'react';

/**
 * One of a few choices, as last made in this browser only (a convenience,
 * never required): a private window or blocked storage starts on `fallback`.
 */
export function useStoredChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: () => T,
): [T, (choice: T) => void] {
  const [choice, setChoice] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return choices.includes(stored as T) ? (stored as T) : fallback();
    } catch {
      return fallback();
    }
  });
  const choose = (next: T) => {
    setChoice(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // private window, storage blocked: the choice lasts this visit
    }
  };
  return [choice, choose];
}
