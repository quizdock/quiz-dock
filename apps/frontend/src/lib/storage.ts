/**
 * `localStorage`, for what a device may remember without needing it: blocked
 * (site data refused, a private window) or full, it answers nothing and keeps
 * nothing — never an exception in the middle of a page.
 */
export function storedItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not kept */
  }
}

export function forgetItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to forget */
  }
}
