import { Link } from '@tanstack/react-router';
import { ChevronDown, HardDrive, LogOut, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useRole } from '../auth/use-role';

/**
 * Topbar identity of the host, at the far right: the name opens a small menu
 * (log out). Closes on outside click and Escape.
 */
export function UserMenu({
  user,
  onLogout,
  children,
}: {
  user: string;
  onLogout: () => void;
  /** Extra rows above Log out (the host seat, in local mode). */
  children?: ReactNode;
}) {
  const { t } = useTranslation('auth');
  const { isManager } = useRole();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'hover:bg-accent flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm font-medium transition-colors',
          open && 'bg-accent',
        )}
      >
        <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full">
          <UserRound className="size-4" />
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{user}</span>
        <ChevronDown className="text-muted-foreground size-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="bg-popover text-popover-foreground absolute right-0 z-30 mt-1 min-w-[11rem] rounded-lg border p-1 shadow-md"
        >
          <p className="text-muted-foreground truncate px-2 py-1.5 text-xs sm:hidden">{user}</p>
          {children ? <div className="flex flex-col gap-1 px-2 py-1.5">{children}</div> : null}
          {children ? <div className="bg-border my-1 h-px" /> : null}
          {isManager ? (
            <Link
              to="/admin/media"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <HardDrive className="size-4" />
              {t('nav.instanceMedia')}
            </Link>
          ) : null}
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          >
            <UserRound className="size-4" />
            {t('nav.profile')}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
          >
            <LogOut className="size-4" />
            {t('nav.logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
