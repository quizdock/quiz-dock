import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { getAuthMode, isAuthenticated, rememberAfterLogin } from './auth/auth-context';
import { allowsAnonymousParticipants, hasCommunityStore } from './config';
import { CallbackPage } from './routes/callback-page';
import { ControlPage } from './routes/control-page';
import { DashboardPage } from './routes/dashboard-page';
import { JoinPage } from './routes/join-page';
import { LandingPage } from './routes/landing-page';
import { LoginPage } from './routes/login-page';
import { PlayerPage } from './routes/player-page';
import { FollowScreenPage, ScreenPage } from './routes/screen-page';
import { LivePage } from './routes/live-page';
import { RootLayout } from './routes/root-layout';
import { ErrorPage, NotFoundPage } from './routes/fallback-pages';
import type { QuizImportDtoImportReport } from './api/generated/model';

// Loaded when first opened: the editor, the history, the catalogue and the
// administration stay out of what a participant's phone downloads to join.

const requireAuth = () => {
  if (!isAuthenticated()) {
    throw redirect({ to: '/login' });
  }
};

/**
 * Participants authenticate too under `AUTH_MODE=oidc` (RG-15): the account opens
 * the application, the PIN opens one session. In local mode the join pages stay
 * public — there the PIN is the only barrier. So do they when hosts may open a
 * game to all (#57): the game then says whether it needs an account, and the
 * player page sends to the sign-in only when it does.
 */
const requireAuthWhenOidc = ({ location }: { location: { href: string } }) => {
  if (getAuthMode() === 'oidc' && !allowsAnonymousParticipants() && !isAuthenticated()) {
    rememberAfterLogin(location.href);
    throw redirect({ to: '/login' });
  }
};

// No dead end (UI system §1.3): an unknown address and a crashed page each get a way on.
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

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

/** Le compte de la personne connectée : identité, rôle, siège (mode local). */
export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/profile-page'), 'ProfilePage'),
});

/** Les sessions en cours, en pleine page : le menu de la barre n'en montre que les premières. */
export const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  beforeLoad: requireAuth,
  component: LivePage,
});

/** Un modèle du catalogue : son aperçu, et ce qu'on peut en faire. */
export const templateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/$templateId',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/template-page'), 'TemplatePage'),
});

/** The catalogue of templates shared on this instance (#39). */
export const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/templates-page'), 'TemplatesPage'),
});

export const communityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/community',
  beforeLoad: () => {
    requireAuth();
    if (!hasCommunityStore()) throw redirect({ to: '/templates' });
  },
  component: lazyRouteComponent(() => import('./routes/community-page'), 'CommunityPage'),
});

export const communityPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/community/$key',
  beforeLoad: () => {
    requireAuth();
    if (!hasCommunityStore()) throw redirect({ to: '/templates' });
  },
  component: lazyRouteComponent(
    () => import('./routes/community-preview-page'),
    'CommunityPreviewPage',
  ),
});

export const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId',
  beforeLoad: requireAuth,
  // `publish`: arrived from « Publish to present » — publish, or list what is missing.
  validateSearch: (search: Record<string, unknown>): { publish?: boolean } =>
    search.publish === true || search.publish === 'true' ? { publish: true } : {},
  component: lazyRouteComponent(() => import('./routes/editor-page'), 'EditorPage'),
});

export const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/preview',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/preview-page'), 'PreviewPage'),
});

// Player reviews of a quiz (§2.11), paginated — owner only.
export const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/reviews',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/feedback-page'), 'FeedbackPage'),
});

// Historique des parties archivées d'un quiz (§2.7) — propriétaire uniquement.
export const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/sessions-page'), 'SessionsPage'),
});

export const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history/$sessionId',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/sessions-page'), 'SessionDetailPage'),
});

// « Le quiz vu par un participant » (§2.10) : réponses question par question.
export const sessionPlayerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quizzes/$quizId/history/$sessionId/players/$playerResultId',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/sessions-page'), 'SessionPlayerPage'),
});

// Console d'animation (hôte, §3). Auth requise (propriétaire).
export const controlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$pin/console',
  beforeLoad: requireAuth,
  component: ControlPage,
  // Another PIN is another room: its page starts afresh.
  remountDeps: ({ params }) => params.pin,
});

// Écran de jeu projeté (grand écran, §4). Spectateur en lecture seule, aucune auth.
export const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$pin/projection',
  component: ScreenPage,
  // Another PIN is another room: its page starts afresh.
  remountDeps: ({ params }) => params.pin,
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
  // Another PIN is another room: its page starts afresh.
  remountDeps: ({ params }) => params.pin,
});

/**
 * A participant's copy of the projection on a device of their own (#104): the
 * same access rules as joining; `?sound=1` when it plays the sound.
 */
export const joinScreenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$pin/screen',
  beforeLoad: requireAuthWhenOidc,
  component: FollowScreenPage,
});

/** The setup wizard of a fresh instance (SPECIFICATIONS-ADMIN §3.8): public, behind its token. */
export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: lazyRouteComponent(() => import('./routes/setup/setup-page'), 'SetupPage'),
});

/** The administration (SPECIFICATIONS-ADMIN): its sections by domain, for administrators. */
export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: requireAuth,
  component: lazyRouteComponent(() => import('./routes/admin/admin-layout'), 'AdminLayout'),
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/statistics' });
  },
});

/** The administration's home: what is played right now, the instance at a glance. */
export const adminStatsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'statistics',
  component: lazyRouteComponent(() => import('./routes/admin/admin-stats-page'), 'AdminStatsPage'),
});
export const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings',
  component: lazyRouteComponent(
    () => import('./routes/admin/admin-settings-page'),
    'AdminSettingsPage',
  ),
});
export const adminHealthRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'health',
  component: lazyRouteComponent(() => import('./routes/admin/admin-health-page'), 'HealthPage'),
});
export const adminAccountsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'accounts',
  component: lazyRouteComponent(() => import('./routes/admin/admin-accounts-page'), 'AccountsPage'),
});
export const adminAuditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'audit',
  component: lazyRouteComponent(() => import('./routes/admin/admin-audit-page'), 'AuditPage'),
});
export const adminQuizzesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'quizzes',
  component: lazyRouteComponent(
    () => import('./routes/admin/admin-quizzes-page'),
    'AdminQuizzesPage',
  ),
});
/** The instance's media (#54). */
export const adminMediaRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'media',
  component: lazyRouteComponent(() => import('./routes/admin-media-page'), 'AdminMediaPage'),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  callbackRoute,
  dashboardRoute,
  templatesRoute,
  communityRoute,
  communityPreviewRoute,
  templateRoute,
  liveRoute,
  profileRoute,
  setupRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminStatsRoute,
    adminSettingsRoute,
    adminHealthRoute,
    adminAccountsRoute,
    adminAuditRoute,
    adminQuizzesRoute,
    adminMediaRoute,
  ]),
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
  joinScreenRoute,
  ...legacyRedirects,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface HistoryState {
    /** A Kahoot sheet just imported: what became of its rows, shown once by the editor. */
    importReport?: QuizImportDtoImportReport;
  }
}
