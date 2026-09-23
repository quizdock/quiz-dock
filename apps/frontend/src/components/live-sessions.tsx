import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Radio, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  getGameControllerMineQueryKey,
  useGameControllerEnd,
  useGameControllerMine,
} from '../api/generated/games/games';

/** How often the indicator re-checks: a session someone else ended must fade out. */
const POLL_MS = 15_000;

/**
 * The host's running sessions, in the top bar rather than on the dashboard: a
 * session is not a quiz, and forgetting one open while editing something else is
 * exactly what this prevents — it follows the host on every page.
 *
 * Silent when nothing runs, and silent on error: an account without host
 * privileges (the seat is someone else's in local mode) simply sees nothing.
 */
export function LiveSessions() {
  const { t } = useTranslation('dashboard');
  const queryClient = useQueryClient();
  const { data } = useGameControllerMine({
    query: { refetchInterval: POLL_MS, retry: false, staleTime: 0 },
  });
  const endGame = useGameControllerEnd();
  const [open, setOpen] = useState(false);
  const [endPin, setEndPin] = useState<string | null>(null);
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

  const onEnd = (pin: string) => {
    setEndPin(null);
    setOpen(false);
    endGame.mutate(
      { pin },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getGameControllerMineQueryKey() }),
      },
    );
  };

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
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {sessions.some((s) => s.host) ? t('allSessions') : t('activeSessions')}
          </p>
          <ul className="flex flex-col">
            {sessions.map((session) => (
              <li key={session.pin} className="flex flex-col gap-1 rounded-md px-2 py-2">
                <span className="flex items-baseline gap-2">
                  <span className="flex-1 truncate font-medium">{session.title}</span>
                  <span className="font-mono text-sm tracking-widest">{session.pin}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {/* `host` n'est renseigné que dans la vue d'ensemble d'un admin :
                      un hôte qui liste les siennes n'a pas besoin de son propre nom. */}
                  {session.host ? `${t('hostedBy', { name: session.host })} · ` : ''}
                  {t('playerCount', { count: session.playerCount })}
                </span>
                <span className="flex gap-2 pt-1">
                  <Link
                    to="/session/$pin/console"
                    params={{ pin: session.pin }}
                    onClick={() => setOpen(false)}
                  >
                    <Button type="button" size="sm" variant="outline">
                      {t('resume')}
                    </Button>
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={endGame.isPending}
                    onClick={() => setEndPin(session.pin)}
                  >
                    <Square className="size-4" />
                    {t('stop')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={endPin !== null}
        destructive
        title={t('stopConfirmTitle')}
        description={t('stopConfirmDescription')}
        confirmLabel={t('stopConfirmLabel')}
        onCancel={() => setEndPin(null)}
        onConfirm={() => endPin && onEnd(endPin)}
      />
    </div>
  );
}
