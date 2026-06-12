import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { isAuthenticated } from './auth/auth-context';
import { CallbackPage } from './routes/callback-page';
import { DashboardPage } from './routes/dashboard-page';
import { EditorPage } from './routes/editor-page';
import { LandingPage } from './routes/landing-page';
import { LoginPage } from './routes/login-page';
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

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  callbackRoute,
  dashboardRoute,
  editorRoute,
  previewRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
