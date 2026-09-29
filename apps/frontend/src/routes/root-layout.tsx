import { Link, Outlet, useMatches, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppNav } from '@/components/app-nav';
import { BrandLogo } from '@/components/brand-logo';
import { useAuth } from '../auth/auth-context';
import { APP_NAME, getDemo } from '../config';
import { cn } from '@/lib/utils';

/** Route id → `titles.*` key in `common`; the document title reads "<page> · <app>". */
const TITLE_KEYS: Record<string, string> = {
  '/login': 'login',
  '/quizzes': 'dashboard',
  '/live': 'live',
  '/profile': 'profile',
  '/templates': 'templates',
  '/templates/$templateId': 'template',
  '/quizzes/$quizId': 'editor',
  '/quizzes/$quizId/preview': 'preview',
  '/quizzes/$quizId/reviews': 'feedback',
  '/quizzes/$quizId/history': 'sessions',
  '/quizzes/$quizId/history/$sessionId': 'session',
  '/quizzes/$quizId/history/$sessionId/players/$playerResultId': 'player',
  '/session/$pin/console': 'control',
  '/session/$pin/projection': 'screen',
  '/join': 'join',
  '/join/$pin': 'join',
  '/join/$pin/screen': 'screen',
};

export function RootLayout() {
  const { t } = useTranslation(['auth', 'common']);
  const matches = useMatches();
  useEffect(() => {
    const key = [...matches]
      .reverse()
      .map((m) => TITLE_KEYS[m.routeId])
      .find(Boolean);
    document.title = key ? `${t(`common:titles.${key}`)} · ${APP_NAME}` : APP_NAME;
  }, [matches, t]);
  const { user, mode, logout } = useAuth();
  const demo = getDemo();
  const navigate = useNavigate();
  // Three shells: the projected screen has no chrome at all; participants (guests on a
  // phone) get the brand only; hosts and editors get the full app navigation.
  const routeId = matches[matches.length - 1]?.routeId ?? '';
  // A participant's copy of the projection (#104) is a projected screen too.
  const shell =
    routeId.startsWith('/session/$pin/projection') || routeId === '/join/$pin/screen'
      ? 'bare'
      : routeId.startsWith('/join')
        ? 'participant'
        : 'app';

  if (shell === 'bare') {
    return (
      <div className="qd-shell flex min-h-screen flex-col" data-shell="bare">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="qd-shell flex min-h-screen flex-col" data-shell={shell}>
      {/* La barre traverse l'écran — c'est la limite du cadre — mais son contenu
          suit exactement les marges de `main` : la marque s'aligne sur le titre
          de la page. Le nom s'efface sous `sm` pour laisser la place à la
          navigation sur un téléphone, et revient dès qu'il y a de la place. */}
      <header className="qd-header border-b py-3">
        <div
          className={
            shell === 'participant'
              ? 'content-phone flex items-center justify-between gap-3 px-4'
              : 'content-shell flex items-center justify-between gap-3 px-6 lg:px-10'
          }
        >
          {shell === 'participant' ? (
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-lg font-bold">
                <BrandLogo className="h-7 w-auto rounded-md" />
                <span className="hidden sm:inline">{APP_NAME}</span>
              </span>
              {/* Filled by the player page (the answers / big screen switch) through a portal. */}
              <span id="participant-topbar-start" className="flex items-center" />
            </span>
          ) : (
            <Link
              to="/"
              aria-label={APP_NAME}
              className="flex shrink-0 items-center gap-2 text-lg font-bold"
            >
              <BrandLogo className="h-7 w-auto rounded-md" />
              <span className="hidden sm:inline">{APP_NAME}</span>
            </Link>
          )}
          {shell === 'participant' ? (
            // Filled by the player page (avatar, nickname, Leave) through a portal.
            <div id="participant-topbar" className="flex items-center gap-2" />
          ) : user ? (
            <AppNav
              user={user}
              mode={mode}
              onLogout={() => {
                void Promise.resolve(logout()).then(() => navigate({ to: '/login' }));
              }}
            />
          ) : (
            <Link to="/login" className="text-sm hover:underline">
              {t('nav.loginLink')}
            </Link>
          )}
        </div>
      </header>
      {demo ? (
        <p
          role="note"
          className="border-b bg-amber-500/15 px-6 py-1.5 text-center text-xs text-amber-700 dark:text-amber-400"
        >
          {t('common:demo.banner', { user: demo.user })}
        </p>
      ) : null}
      {/* The participant page owns its content width so question backgrounds can span
          the viewport; the app shell stays bounded to ~1440px. */}
      <main
        className={cn(
          'qd-main',
          shell === 'participant'
            ? 'w-full flex-1 px-4 py-4'
            : 'content-shell flex-1 px-6 py-6 lg:px-10',
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
