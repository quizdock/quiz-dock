import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getLocalUser } from './auth/auth-context';
import { DashboardPage } from './routes/dashboard-page';
import { LandingPage } from './routes/landing-page';
import { LoginPage } from './routes/login-page';
import { RootLayout } from './routes/root-layout';

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

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  beforeLoad: () => {
    if (!getLocalUser()) {
      throw redirect({ to: '/login' });
    }
  },
  component: DashboardPage,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, dashboardRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
