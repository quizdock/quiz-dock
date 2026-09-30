import { MotionGlobalConfig } from 'motion/react';
import '@testing-library/jest-dom/vitest';
import { loadLanguages } from '../i18n';

// The French texts (and English, the fallback) before any test: t() then returns them at once.
await loadLanguages();

// Node ≥ 25 ships experimental `localStorage`/`sessionStorage` globals (undefined
// unless --localstorage-file is set); vitest's jsdom env keeps existing globals,
// so the page gets none. A minimal in-memory Storage stands in.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (globalThis[name] === undefined) {
    Object.defineProperty(globalThis, name, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

// jsdom n'implémente pas scrollTo ; TanStack Router l'appelle (scroll restoration).
window.scrollTo = () => undefined;

// jsdom has no matchMedia; the editor picks its wide (side-by-side) layout from it.
window.matchMedia ??= (query: string) =>
  ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// The motion layer (UI system §1.8) jumps to its end states: tests read the screens, not their transitions.
MotionGlobalConfig.skipAnimations = true;
