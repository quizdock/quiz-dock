import { Link, Outlet, useMatches, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/components/brand-logo';
import { SeatCountdown, SeatMenuRow } from '@/components/seat-status';
import { UserMenu } from '@/components/user-menu';
import { useAuth } from '../auth/auth-context';
import { APP_NAME, getDemo } from '../config';

/** Route id → `titles.*` key in `common`; the document title reads "<page> · <app>". */
const TITLE_KEYS: Record<string, string> = {
  '/login': 'login',
  '/quizzes': 'dashboard',
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
  const shell = routeId.startsWith('/session/$pin/projection')
    ? 'bare'
    : routeId.startsWith('/join')
      ? 'participant'
      : 'app';

  if (shell === 'bare') {
    return (
      <div className="flex min-h-screen flex-col">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        {shell === 'participant' ? (
          <span className="flex items-center gap-2 text-lg font-bold">
            <BrandLogo className="h-7 w-auto rounded-md" />
            <span>{APP_NAME}</span>
          </span>
        ) : (
          <Link to="/" className="flex items-center gap-2 text-lg font-bold">
            <BrandLogo className="h-7 w-auto rounded-md" />
            <span>{APP_NAME}</span>
          </Link>
        )}
        <nav className="flex items-center gap-3 text-sm">
          {shell === 'participant' ? (
            // Filled by the player page (avatar, nickname, Leave) through a portal.
            <div id="participant-topbar" className="flex items-center gap-2" />
          ) : user ? (
            <>
              <Link to="/quizzes" className="whitespace-nowrap hover:underline">
                {t('nav.myQuizzes')}
              </Link>
              {/* A seat countdown stays in plain sight; renewal and log out live in the user menu. */}
              {mode === 'none' ? <SeatCountdown user={user} /> : null}
              <UserMenu
                user={user}
                onLogout={() => {
                  void Promise.resolve(logout()).then(() => navigate({ to: '/login' }));
                }}
              >
                {mode === 'none' ? <SeatMenuRow user={user} /> : null}
              </UserMenu>
            </>
          ) : (
            <Link to="/login" className="hover:underline">
              {t('nav.loginLink')}
            </Link>
          )}
        </nav>
      </header>
      {demo ? (
        <p
          role="note"
          className="border-b bg-amber-500/15 px-6 py-1.5 text-center text-xs text-amber-700 dark:text-amber-400"
        >
          {t('common:demo.banner', { count: demo.seatMinutes })}
        </p>
      ) : null}
      {/* Wide but bounded: ~1440px, the usual ceiling for app layouts; pages narrow themselves when reading matters. */}
      <main
        className={
          shell === 'participant'
            ? 'content-phone flex-1 px-4 py-4'
            : 'content-shell flex-1 px-6 py-6 lg:px-10'
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
