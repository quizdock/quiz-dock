import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MonitorPlay, Play, Search, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../api/http';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { FilterField } from '@/components/ui/filter-field';
import { Select } from '@/components/ui/select';
import { fold } from '@/lib/text';
import {
  getGameControllerMineQueryKey,
  useGameControllerEnd,
  useGameControllerMine,
} from '../api/generated/games/games';
import { ListSkeleton, LoadFailed } from '@/components/ui/loading';
import { PageTitle } from '@/components/ui/page-title';

/** Same page size as the quiz bank: enough to scan, short enough to stay on screen. */
const PAGE_SIZE = 20;
const REFRESH_MS = 10_000;

/**
 * Les sessions en cours, en pleine page (#39 bis) : le menu de la barre n'en
 * montre que les premières, et une instance active en compte des dizaines —
 * voire des centaines pour un `admin`, qui voit celles de toute l'instance.
 * Mêmes contrôles que « Mes quiz » : recherche, filtre, tri, pages.
 */
export function LivePage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useGameControllerMine({
    query: { refetchInterval: REFRESH_MS, retry: false },
  });
  const [stopError, setStopError] = useState<string | null>(null);
  const endGame = useGameControllerEnd();
  const [endPin, setEndPin] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'all' | 'lobby' | 'playing'>('all');
  const [sort, setSort] = useState<'players' | 'title' | 'pin'>('players');
  const [page, setPage] = useState(1);

  const sessions = useMemo(() => data?.data ?? [], [data]);

  const shown = useMemo(() => {
    const needle = fold(search);
    const kept = sessions.filter((s) => {
      const inLobby = s.state === 'LOBBY';
      if (state === 'lobby' && !inLobby) return false;
      if (state === 'playing' && inLobby) return false;
      // Le PIN et l'hôte se cherchent autant que le titre : c'est par là qu'on
      // retrouve une session dont on n'a que le code sous les yeux.
      return !needle || fold(`${s.title} ${s.pin} ${s.host ?? ''}`).includes(needle);
    });
    const sorted = [...kept];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'pin') sorted.sort((a, b) => a.pin.localeCompare(b.pin));
    else sorted.sort((a, b) => b.playerCount - a.playerCount);
    return sorted;
  }, [sessions, search, state, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const narrow = (next: () => void) => {
    next();
    setPage(1);
  };

  const onEnd = (pin: string) => {
    setEndPin(null);
    setStopError(null);
    endGame.mutate(
      { pin },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getGameControllerMineQueryKey() }),
        // A room that would not stop says so, rather than staying listed in silence.
        onError: (err) => setStopError(apiErrorText(err)),
      },
    );
  };

  const overview = sessions.some((s) => s.host);

  return (
    <section className="flex flex-col gap-6">
      <PageTitle>{overview ? t('allSessions') : t('activeSessions')}</PageTitle>

      {isPending ? <ListSkeleton rows={2} /> : null}
      {error ? <LoadFailed error={error} onRetry={() => void refetch()} /> : null}
      {stopError ? (
        <p className="text-destructive text-sm" role="alert">
          {stopError}
        </p>
      ) : null}

      {!isPending && !error && sessions.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">
          {t('noLiveSession')}
        </p>
      ) : null}

      {sessions.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative min-w-[12rem] flex-1 basis-full sm:basis-auto">
              <span className="sr-only">{t('searchSessions')}</span>
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => narrow(() => setSearch(e.target.value))}
                placeholder={t('searchSessions')}
                className="pl-8"
              />
            </label>
            <FilterField label={t('filterState')}>
              <Select
                value={state}
                onChange={(e) => narrow(() => setState(e.target.value as typeof state))}
              >
                <option value="all">{t('statusAll')}</option>
                <option value="lobby">{t('stateLobby')}</option>
                <option value="playing">{t('statePlaying')}</option>
              </Select>
            </FilterField>
            <FilterField label={t('sortBy')}>
              <Select
                value={sort}
                onChange={(e) => narrow(() => setSort(e.target.value as typeof sort))}
              >
                <option value="players">{t('sortPlayers')}</option>
                <option value="title">{t('sortTitle')}</option>
                <option value="pin">{t('sortPin')}</option>
              </Select>
            </FilterField>
          </div>
          <p className="text-muted-foreground text-sm" role="status">
            {t('sessionCount', { count: shown.length })}
          </p>
        </>
      ) : null}

      {sessions.length > 0 && shown.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">
          {t('noSessionMatch')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visible.map((session) => (
          <li
            key={session.pin}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:gap-4"
          >
            {/* Where the room stands first: its state and who is in it. */}
            <span className="flex shrink-0 flex-col items-start gap-1 sm:w-32">
              <Badge variant={session.state === 'LOBBY' ? 'default' : 'success'}>
                {session.state === 'LOBBY' ? t('stateLobby') : t('statePlaying')}
              </Badge>
              <span className="text-sm font-semibold tabular-nums">
                {t('playerCount', { count: session.playerCount })}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{session.title}</span>
              <span className="text-muted-foreground text-xs">
                <span className="font-mono tracking-widest">{session.pin}</span>
                {session.host ? ` · ${t('hostedBy', { name: session.host })}` : null}
              </span>
            </span>
            {/* Stop away from Resume, the main action, which comes last (UI system §1.1). */}
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive-outline"
                disabled={endGame.isPending}
                onClick={() => setEndPin(session.pin)}
              >
                <Square className="size-4" />
                {t('stop')}
              </Button>
              <Link
                to="/session/$pin/projection"
                params={{ pin: session.pin }}
                className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
              >
                <MonitorPlay className="size-4" />
                {t('projection')}
              </Link>
              <Link
                to="/session/$pin/console"
                params={{ pin: session.pin }}
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                <Play className="size-4" />
                {t('resume')}
              </Link>
            </span>
          </li>
        ))}
      </ul>

      <Pagination page={current} pages={pageCount} onChange={setPage} />

      <ConfirmDialog
        open={endPin !== null}
        destructive
        title={t('stopConfirmTitle')}
        description={t('stopConfirmDescription')}
        confirmLabel={t('stopConfirmLabel')}
        onCancel={() => setEndPin(null)}
        onConfirm={() => endPin && onEnd(endPin)}
      />
    </section>
  );
}
