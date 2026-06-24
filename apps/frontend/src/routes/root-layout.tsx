import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuth } from '../auth/auth-context';

export function RootLayout() {
  const { t } = useTranslation(['auth', 'common']);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <Link to="/" className="text-lg font-bold">
          Roux-Quizz
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link to="/dashboard" className="hover:underline">
                {t('nav.myQuizzes')}
              </Link>
              <span className="text-muted-foreground">{user}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void Promise.resolve(logout()).then(() => navigate({ to: '/login' }));
                }}
              >
                <LogOut className="size-4" />
                {t('nav.logout')}
              </Button>
            </>
          ) : (
            <Link to="/login" className="hover:underline">
              {t('nav.loginLink')}
            </Link>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
