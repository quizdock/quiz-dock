import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas scrollTo ; TanStack Router l'appelle (scroll restoration).
window.scrollTo = () => undefined;
