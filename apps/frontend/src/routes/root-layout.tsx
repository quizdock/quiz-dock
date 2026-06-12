import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/auth-context';

export function RootLayout() {
  const { localUser, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Roux-Quizz
        </Link>
        <nav>
          {localUser ? (
            <>
              <Link to="/dashboard">Mes quiz</Link>
              <span className="who">{localUser}</span>
              <button
                type="button"
                onClick={() => {
                  logout();
                  void navigate({ to: '/login' });
                }}
              >
                Se déconnecter
              </button>
            </>
          ) : (
            <Link to="/login">Espace formateur</Link>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
