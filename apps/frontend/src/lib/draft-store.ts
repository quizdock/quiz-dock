/**
 * Form drafts in `localStorage`: written on every change, restored when the
 * same form reopens, cleared once the form is saved or explicitly discarded.
 * A reload, a closed tab or a crash no longer loses in-progress work.
 */
const PREFIX = 'draft:';

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full: the draft simply is not kept */
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}

/** Where an editor form keeps its draft: a question's or a slide's, `new` before it exists. */
export const formDraftKey = (quizId: string, kind: 'question' | 'slide', id: string | null) =>
  `quiz:${quizId}:${kind}:${id ?? 'new'}`;
