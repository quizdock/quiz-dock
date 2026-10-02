// Runtime configuration (white-label): the defaults, built into the bundle. The
// backend serves the instance's own at /config.js (directly, through nginx or
// Vite's proxy), which takes this one's place. See apps/frontend/src/config.ts.
window.__APP_CONFIG__ = {
  appName: 'QuizDock',
  lang: 'en',
  // Vide = logo cherché dans `branding/` (tous formats web), sinon celui du build.
  logoUrl: '',
  // Home page's feedback links: '' = the QuizDock repository, a URL = yours, 'none' = hidden.
  feedbackUrl: '',
  // How the answers are drawn beside their colour: shape | letter | number.
  answerGlyph: 'shape',
};
