import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, History, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton, LoadFailed, PageLoading } from '@/components/ui/loading';
import { PageTitle } from '@/components/ui/page-title';
import { cn } from '@/lib/utils';
import {
  useHistoryControllerList,
  useHistoryControllerRoom,
} from '../api/generated/history/history';
import type { HistoryListDtoRoomsItem } from '../api/generated/model';
import { historyRoomRoute } from '../router';
import { fmtDate, fmtDuration, RoomCard } from './sessions-page';

/**
 * The history by gathering: one line per room, the quizzes played in it, the most
 * participants; a quiz played alone is a line of its own. A room opens its page (its
 * quizzes, its standings); a quiz alone opens its report.
 */
export function HistoryPage() {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useHistoryControllerList();
  const rooms = data?.data.rooms;
  const target = (r: HistoryListDtoRoomsItem) =>
    r.roomId
      ? ({ to: '/history/$roomId', params: { roomId: r.roomId } } as const)
      : ({
          to: '/quizzes/$quizId/history/$sessionId',
          params: { quizId: r.sessions[0].quizId, sessionId: r.sessions[0].id },
        } as const);

  const columns: DataColumn<HistoryListDtoRoomsItem>[] = [
    {
      id: 'date',
      accessorFn: (r) => r.startedAt,
      header: t('list.thDate'),
      sortFn: 'datetime',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-0">
            {/* The row leads to the gathering; the link is the keyboard's way there. */}
            <Link
              {...target(r)}
              className="font-medium hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {fmtDate(r.startedAt, i18n.language)}
            </Link>
            <p className="text-muted-foreground text-xs">
              {fmtDuration(t, r.startedAt, r.endedAt)}
            </p>
          </div>
        );
      },
    },
    {
      id: 'room',
      accessorFn: (r) => r.name ?? '',
      header: t('gatherings.thRoom'),
      cell: ({ row }) => {
        const r = row.original;
        return r.roomId ? (
          <span className="flex items-center gap-1.5">
            <Layers className="text-muted-foreground size-4" aria-hidden />
            {r.name || t('detail.room.defaultName', { host: r.hostName })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('gatherings.alone')}</span>
        );
      },
    },
    {
      id: 'quizzes',
      accessorFn: (r) => r.sessions.length,
      header: t('gatherings.thQuizzes'),
      enableSorting: false,
      meta: { className: 'max-w-sm' },
      cell: ({ row }) => (
        <span className="line-clamp-2">
          {row.original.sessions.map((s) => s.quizTitle || t('detail.fallbackTitle')).join(' · ')}
        </span>
      ),
    },
    {
      id: 'players',
      accessorFn: (r) => r.playerCount,
      header: t('list.thPlayers'),
      meta: { align: 'right' },
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <PageTitle>{t('gatherings.title')}</PageTitle>
        <p className="text-muted-foreground text-sm">{t('gatherings.intro')}</p>
      </header>
      {isLoading ? <ListSkeleton rows={4} /> : null}
      {error ? <LoadFailed error={error} onRetry={() => void refetch()} /> : null}
      {rooms && rooms.length === 0 ? (
        <EmptyState icon={History}>{t('gatherings.none')}</EmptyState>
      ) : null}
      {rooms && rooms.length > 0 ? (
        <Card>
          <CardContent className="pt-4">
            <DataTable
              columns={columns}
              data={rooms}
              initialSort={[{ id: 'date', desc: true }]}
              onRowClick={(r) => void navigate(target(r))}
            />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

/** A room of the history: its quizzes, each leading to its report, and its standings. */
export function HistoryRoomPage() {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const { roomId } = historyRoomRoute.useParams();
  const { data, error, refetch } = useHistoryControllerRoom(roomId);
  if (error) return <LoadFailed error={error} onRetry={() => void refetch()} />;
  const room = data?.data;
  if (!room) return <PageLoading />;
  const day = room.sessions[0]?.startedAt;
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <PageTitle>
            {room.name || t('detail.room.defaultName', { host: room.hostName })}
          </PageTitle>
          {day ? (
            <p className="text-muted-foreground text-sm">{fmtDate(day, i18n.language)}</p>
          ) : null}
        </div>
        <Link
          to="/history"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <ArrowLeft className="size-4" />
          {t('gatherings.back')}
        </Link>
      </header>
      <RoomCard room={room} pin={day ? day.slice(0, 10) : roomId.slice(0, 8)} />
    </section>
  );
}
