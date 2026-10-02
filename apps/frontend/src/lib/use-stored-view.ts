import { useStoredChoice } from './use-stored-choice';

export type ListView = 'list' | 'grid';

const VIEWS = ['list', 'grid'] as const;

/** A page's list or grid, as last chosen in this browser only (see `useStoredChoice`). */
export function useStoredView(
  key: string,
  fallback: ListView = 'list',
): [ListView, (view: ListView) => void] {
  return useStoredChoice(key, VIEWS, () => fallback);
}
