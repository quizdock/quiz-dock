import { Link } from '@tanstack/react-router';
import { Radio } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useGameControllerMine } from '../api/generated/games/games';

/** How often the indicator re-checks: a session someone else ended must fade out. */
const POLL_MS = 15_000;
/** Combien de sessions le menu montre avant de renvoyer vers la page dédiée. */
const PREVIEW = 5;

/**
 * The host's running sessions, in the top bar rather than on the dashboard: a
 * session is not a quiz, and forgetting one open while editing something else is
 * exactly what this prevents — it follows the host on every page.
 *
 * Silent when nothing runs, and silent on error: an account without host
 * privileges (the seat is someone else's in local mode) simply sees nothing.
 */
export function LiveSessions({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation('dashboard');
  const { data } = useGameControllerMine({
    query: { refetchInterval: POLL_MS, retry: false, staleTime: 0 },
  });
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

  const sessions = data?.data ?? [];
  if (sessions.length === 0) return null;

  // Le menu est une porte d'entrée, pas une liste : quelques lignes d'une ligne
  // chacune, puis le renvoi vers la page qui sait filtrer, trier et paginer.
  const rows = (
    <ul className="flex flex-col">
      {sessions.slice(0, PREVIEW).map((session) => (
        <li key={session.pin}>
          <Link
            to="/session/$pin/console"
            params={{ pin: session.pin }}
            onClick={() => setOpen(false)}
            className="hover:bg-accent flex items-baseline gap-2 rounded-md px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{session.title}</span>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {t('playerCount', { count: session.playerCount })}
            </span>
            <span className="font-mono text-xs tracking-widest">{session.pin}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  const heading = sessions.some((s) => s.host) ? t('allSessions') : t('activeSessions');
  // Dans le menu burger, les sessions sont déjà dans un panneau : un second
  // menu déroulant par-dessus serait injouable au pouce.
  if (inline) {
    return (
      <div className="flex flex-col">
        <p className="text-primary flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium">
          <Radio className="size-3.5 animate-pulse" />
          {heading}
        </p>
        {rows}
        <Link
          to="/live"
          className="hover:bg-accent block rounded-md px-2 py-1.5 text-sm font-medium"
        >
          {t('seeAllSessions')} ({sessions.length})
        </Link>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'text-primary hover:bg-accent flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors',
          open && 'bg-accent',
        )}
      >
        <Radio className="size-3.5 animate-pulse" />
        {t('live', { count: sessions.length })}
      </button>
      {open ? (
        <div
          role="menu"
          className="bg-popover text-popover-foreground absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border p-1 shadow-md"
        >
          <p className="text-muted-foreground px-2 py-1.5 text-xs">{heading}</p>
          {rows}
          <div className="bg-border my-1 h-px" />
          <Link
            to="/live"
            onClick={() => setOpen(false)}
            className="hover:bg-accent block rounded-md px-2 py-1.5 text-sm font-medium"
          >
            {t('seeAllSessions')} ({sessions.length})
          </Link>
        </div>
      ) : null}
    </div>
  );
}
