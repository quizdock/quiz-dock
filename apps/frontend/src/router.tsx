import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { isAuthenticated } from './auth/auth-context';
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
import { SessionDetailPage, SessionsPage } from './routes/sessions-page';
import { RootLayout } from './routes/root-layout';

const requireAuth = () => {
  if (!isAuthenticated()) {
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

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
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

// Historique des parties archivées d'un quiz (§2.7) — propriétaire uniquement.
export const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/sessions',
  beforeLoad: requireAuth,
  component: SessionsPage,
});

export const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/sessions/$sessionId',
  beforeLoad: requireAuth,
  component: SessionDetailPage,
});

// Console d'animation (hôte, §3). Auth requise (propriétaire).
export const controlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/present/$pin/control',
  beforeLoad: requireAuth,
  component: ControlPage,
});

// Écran de jeu projeté (grand écran, §4). Spectateur en lecture seule, aucune auth.
export const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/present/$pin/screen',
  component: ScreenPage,
});

// Ancienne salle d'attente mono-fenêtre → console de contrôle (§4.1 interim).
export const presentRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/present/$pin',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/present/$pin/control', params });
  },
});

// Entrée joueur (publique). `/join` (saisie du PIN) et `/join/$pin` (machine à états).
export const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  component: JoinPage,
});

export const joinWithPinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$pin',
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
  sessionDetailRoute,
  controlRoute,
  screenRoute,
  presentRedirectRoute,
  joinRoute,
  joinWithPinRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
