import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { isAuthenticated } from './auth/auth-context';
import { CallbackPage } from './routes/callback-page';
import { DashboardPage } from './routes/dashboard-page';
import { EditorPage } from './routes/editor-page';
import { JoinPage } from './routes/join-page';
import { LandingPage } from './routes/landing-page';
import { LoginPage } from './routes/login-page';
import { PresentPage } from './routes/present-page';
import { PreviewPage } from './routes/preview-page';
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

// Salle d'attente hôte (PIN + QR). Auth requise (formateur).
export const presentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/present/$pin',
  beforeLoad: requireAuth,
  component: PresentPage,
});

// Entrée joueur (publique). `/join` (saisie manuelle) et `/join/$pin` (via QR).
export const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  component: JoinPage,
});

export const joinWithPinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$pin',
  component: JoinPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  callbackRoute,
  dashboardRoute,
  editorRoute,
  previewRoute,
  presentRoute,
  joinRoute,
  joinWithPinRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
