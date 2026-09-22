import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getAuthMode, isAuthenticated, rememberAfterLogin } from './auth/auth-context';
import { CallbackPage } from './routes/callback-page';
import { ControlPage } from './routes/control-page';
import { DashboardPage } from './routes/dashboard-page';
import { EditorPage } from './routes/editor-page';
import { JoinPage } from './routes/join-page';
import { LandingPage } from './routes/landing-page';
import { LoginPage } from './routes/login-page';
import { PlayerPage } from './routes/player-page';
import { PreviewPage } from './routes/preview-page';
import { ScreenPage } from './routes/screen-page';
import { SessionDetailPage, SessionPlayerPage, SessionsPage } from './routes/sessions-page';
import { FeedbackPage } from './routes/feedback-page';
import { RootLayout } from './routes/root-layout';

const requireAuth = () => {
  if (!isAuthenticated()) {
    throw redirect({ to: '/login' });
  }
};

/**
 * Participants authenticate too under `AUTH_MODE=oidc` (RG-15): the account opens
 * the application, the PIN opens one session. In local mode the join pages stay
 * public — there the PIN is the only barrier.
 */
const requireAuthWhenOidc = ({ location }: { location: { href: string } }) => {
  if (getAuthMode() === 'oidc' && !isAuthenticated()) {
    rememberAfterLogin(location.href);
    throw redirect({ to: '/login' });
  }
};

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: CallbackPage,
});

// URLs read like the interface: /quizzes (My quizzes), /quizzes/:id (editor),
// /quizzes/:id/reviews, /quizzes/:id/history, /session/:pin/console|projection,
// /join. The former paths redirect (bookmarks, QR codes, open windows).
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes',
  beforeLoad: requireAuth,
  component: DashboardPage,
});

export const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId',
  beforeLoad: requireAuth,
  component: EditorPage,
});

export const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/preview',
  beforeLoad: requireAuth,
  component: PreviewPage,
});

// Player reviews of a quiz (§2.11), paginated — owner only.
export const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/reviews',
  beforeLoad: requireAuth,
  component: FeedbackPage,
});

// Historique des parties archivées d'un quiz (§2.7) — propriétaire uniquement.
export const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history',
  beforeLoad: requireAuth,
  component: SessionsPage,
});

export const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history/$sessionId',
  beforeLoad: requireAuth,
  component: SessionDetailPage,
});

// « Le quiz vu par un participant » (§2.10) : réponses question par question.
export const sessionPlayerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history/$sessionId/players/$playerResultId',
  beforeLoad: requireAuth,
  component: SessionPlayerPage,
});

// Console d'animation (hôte, §3). Auth requise (propriétaire).
export const controlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$pin/console',
  beforeLoad: requireAuth,
  component: ControlPage,
});

// Écran de jeu projeté (grand écran, §4). Spectateur en lecture seule, aucune auth.
export const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$pin/projection',
  component: ScreenPage,
});

export const sessionRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$pin',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/session/$pin/console', params });
  },
});

// Former paths (before the URLs were aligned with the interface) keep working.
const legacyRedirects = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    beforeLoad: () => {
      throw redirect({ to: '/quizzes' });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/quizzes/$quizId/feedback',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/quizzes/$quizId/reviews', params });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/quizzes/$quizId/sessions',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/quizzes/$quizId/history', params });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/quizzes/$quizId/sessions/$sessionId',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/quizzes/$quizId/history/$sessionId', params });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/present/$pin',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/session/$pin/console', params });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/present/$pin/control',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/session/$pin/console', params });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/present/$pin/screen',
    beforeLoad: ({ params }) => {
      throw redirect({ to: '/session/$pin/projection', params });
    },
  }),
];

// Entrée joueur (publique). `/join` (saisie du PIN) et `/join/$pin` (machine à états).
export const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  beforeLoad: requireAuthWhenOidc,
  component: JoinPage,
});

export const joinWithPinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$pin',
  beforeLoad: requireAuthWhenOidc,
  component: PlayerPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  callbackRoute,
  dashboardRoute,
  editorRoute,
  previewRoute,
  sessionsRoute,
  feedbackRoute,
  sessionDetailRoute,
  sessionPlayerRoute,
  controlRoute,
  screenRoute,
  sessionRedirectRoute,
  joinRoute,
  joinWithPinRoute,
  ...legacyRedirects,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
