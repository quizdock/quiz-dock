import { Link } from '@tanstack/react-router';
import { ShieldCheck, LogOut, Menu, UserRound, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveSessions } from '@/components/live-sessions';
import { SeatCountdown, SeatMenuRow } from '@/components/seat-status';
import { UserMenu } from '@/components/user-menu';
import { cn } from '@/lib/utils';
import type { AuthMode } from '../auth/auth-context';
import { useRole } from '../auth/use-role';

interface NavProps {
  user: string;
  mode: AuthMode;
  onLogout: () => void;
}

/**
 * Navigation de l'application, en deux mises en page pour le même contenu :
 * en ligne sur un écran large, empilée dans le panneau du menu burger sinon.
 * Les libellés ne tiennent pas côté à côte sur un téléphone, et la barre les
 * repoussait hors écran.
 */
export function AppNav({ user, mode, onLogout }: NavProps) {
  const { t } = useTranslation('auth');
  const { isManager } = useRole();
  return (
    <div className="flex items-center gap-2">
      {/* Ce qui signale une échéance ou une partie en cours reste visible à toutes
          les tailles : ça ne doit pas être caché derrière un menu. Le burger a
          libéré la place qui manquait sur un téléphone. */}
      {mode === 'none' ? <SeatCountdown user={user} /> : null}
      <LiveSessions />

      <nav className="hidden items-center gap-3 text-sm md:flex">
        <NavLinks />
        <UserMenu user={user} onLogout={onLogout}>
          {mode === 'none' ? <SeatMenuRow user={user} /> : null}
        </UserMenu>
      </nav>

      <BurgerMenu label={t('nav.menu')}>
        {(close) => (
          // A link closes the menu; adjusting the seat does not (its list, its buttons).
          <div className="flex flex-col gap-1">
            <NavLinks stacked onNavigate={close} />
            {mode === 'none' ? (
              <>
                <Separator />
                {/* Le décompte est dans la barre ; ici, de quoi le prolonger. */}
                <div className="flex flex-col gap-2 px-2 py-1.5">
                  <SeatMenuRow user={user} />
                </div>
              </>
            ) : null}
            <Separator />
            <p className="text-muted-foreground truncate px-2 pt-1.5 text-xs">{user}</p>
            {/* The same entries as the user menu (UI system §4). */}
            {isManager ? (
              <Link
                to="/admin/quizzes"
                onClick={close}
                className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-2 text-sm"
              >
                <ShieldCheck className="size-4" />
                {t('nav.admin')}
              </Link>
            ) : null}
            <Link
              to="/profile"
              onClick={close}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-2 text-sm"
            >
              <UserRound className="size-4" />
              {t('nav.profile')}
            </Link>
            <button
              type="button"
              onClick={() => {
                close();
                onLogout();
              }}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            >
              <LogOut className="size-4" />
              {t('nav.logout')}
            </button>
          </div>
        )}
      </BurgerMenu>
    </div>
  );
}

function NavLinks({ stacked = false, onNavigate }: { stacked?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('auth');
  const className = stacked
    ? 'hover:bg-accent rounded-md px-2 py-2 text-sm'
    : 'whitespace-nowrap hover:underline';
  return (
    <>
      <Link to="/quizzes" className={className} onClick={onNavigate}>
        {t('nav.myQuizzes')}
      </Link>
      <Link to="/templates" className={className} onClick={onNavigate}>
        {t('nav.templates')}
      </Link>
    </>
  );
}

function Separator() {
  return <div className="bg-border my-1 h-px" />;
}

/** Bouton burger + panneau, sous le point de rupture `md`. */
function BurgerMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn('hover:bg-accent rounded-md p-2 transition-colors', open && 'bg-accent')}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <div
          role="menu"
          className="bg-popover text-popover-foreground absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border p-1 shadow-md"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
