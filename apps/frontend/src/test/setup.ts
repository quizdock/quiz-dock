import '@testing-library/jest-dom/vitest';
import '../i18n'; // init i18n synchrone — t() renvoie le texte FR réel dans les tests

// jsdom n'implémente pas scrollTo ; TanStack Router l'appelle (scroll restoration).
window.scrollTo = () => undefined;
