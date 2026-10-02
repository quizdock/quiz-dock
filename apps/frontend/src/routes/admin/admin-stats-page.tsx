import { Link } from '@tanstack/react-router';
import { FileQuestion, History, Image, Radio, UserCog, Users } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { formatAgo, formatBytes } from '@/lib/format';
import { DataTable, type DataColumn, ShareBar } from '@/components/ui/data-table';
import type { HistoryMonth, HistoryRank, LiveGame } from '@quiz-dock/contracts';
import { useReadOperation } from './admin-api';

/** How often the live figures are read again (paused while the tab is hidden). */
export const LIVE_REFRESH_MS = 5_000;

/**
 * The administration's home: what is played right now — every game, its host,
 * its players —, and the instance at a glance. Read again every few seconds.
 */
export function AdminStatsPage() {
  const { t, i18n } = useTranslation('admin');
  const live = useReadOperation('stats.live', {}, true, LIVE_REFRESH_MS);
  const stats = live.data?.data;
  const locale = i18n.language;

  if (live.isError && !stats) return <LoadFailed error={live.error} />;
  if (!stats) return <Spinner label={t('loading')} showLabel className="text-sm" />;
  const { totals, instance } = stats;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="stats-live">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stats-live" className="flex items-center gap-2 text-lg font-semibold">
            <span className="relative flex size-2.5" aria-hidden>
              <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" />
              <span className="bg-success relative inline-flex size-2.5 rounded-full" />
            </span>
            {t('stats.live.title')}
          </h2>
          <p className="text-muted-foreground text-xs" title={stats.at}>
            {live.isError
              ? t('stats.live.stale', { ago: formatAgo(stats.at, locale) })
              : t('stats.live.updated', { time: new Date(stats.at).toLocaleTimeString(locale) })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            icon={Radio}
            label={t('stats.live.games')}
            value={count(totals.games, locale)}
            detail={[
              t('stats.live.lobby', { count: totals.lobby }),
              t('stats.live.playing', { count: totals.playing }),
            ].join(' · ')}
          />
          <Figure
            icon={Users}
            label={t('stats.live.players')}
            value={count(totals.players, locale)}
          />
        </div>

        {stats.games.length === 0 ? (
          <EmptyState icon={Radio}>{t('stats.live.none')}</EmptyState>
        ) : (
          <DataTable
            columns={liveColumns(t, locale)}
            data={stats.games}
            initialSort={[{ id: 'since', desc: false }]}
          />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="stats-instance">
        <h2 id="stats-instance" className="text-lg font-semibold">
          {t('stats.instance.title')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            icon={UserCog}
            label={t('stats.instance.accounts')}
            value={count(instance.accounts.total, locale)}
            detail={[
              t('stats.instance.hosts', { count: instance.accounts.hosts }),
              t('stats.instance.admins', { count: instance.accounts.admins }),
            ].join(' · ')}
            to="/admin/accounts"
          />
          <Figure
            icon={FileQuestion}
            label={t('stats.instance.quizzes')}
            value={count(instance.quizzes.ready, locale)}
            detail={[
              t('stats.instance.drafts', { count: instance.quizzes.draft }),
              t('stats.instance.archived', { count: instance.quizzes.archived }),
            ].join(' · ')}
            to="/admin/quizzes"
          />
          <Figure
            icon={Image}
            label={t('stats.instance.media')}
            value={formatBytes(instance.media.bytes, locale)}
            detail={t('stats.instance.mediaDetail', { count: instance.media.files })}
            to="/admin/media"
          />
          <Figure
            icon={History}
            label={t('stats.instance.history')}
            value={count(instance.history.sessions, locale)}
            detail={
              instance.history.lastEndedAt
                ? t('stats.instance.lastGame', {
                    ago: formatAgo(instance.history.lastEndedAt, locale),
                  })
                : t('stats.instance.noGame')
            }
          />
        </div>
      </section>

      <HistorySection />
    </div>
  );
}

const percent = (rate: number | null, locale: string) =>
  rate === null
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(rate);

/**
 * How the instance was used over the last twelve months, read once: by month,
 * its most played quizzes, its most active hosts. Tables, not charts — twelve
 * rows read as well as a curve.
 */
function HistorySection() {
  const { t, i18n } = useTranslation('admin');
  const locale = i18n.language;
  const read = useReadOperation('stats.history');
  const history = read.data?.data;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="stats-history">
      <h2 id="stats-history" className="text-lg font-semibold">
        {t('stats.history.title')}
      </h2>
      {read.isError && history ? <StaleNotice onRetry={() => void read.refetch()} /> : null}
      {read.isError && !history ? (
        <LoadFailed error={read.error} />
      ) : !history ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : history.totals.games === 0 ? (
        <EmptyState icon={History}>{t('stats.history.none')}</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure
              icon={Radio}
              label={t('stats.history.games')}
              value={count(history.totals.games, locale)}
            />
            <Figure
              icon={Users}
              label={t('stats.history.players')}
              value={count(history.totals.players, locale)}
            />
            <Figure
              icon={FileQuestion}
              label={t('stats.history.success')}
              value={percent(history.totals.successRate, locale)}
            />
            <Figure
              icon={UserCog}
              label={t('stats.history.withAccount')}
              value={percent(
                history.totals.participants.withAccount /
                  Math.max(
                    1,
                    history.totals.participants.withAccount + history.totals.participants.guests,
                  ),
                locale,
              )}
              detail={[
                t('stats.history.accounts', { count: history.totals.participants.withAccount }),
                t('stats.history.guests', { count: history.totals.participants.guests }),
              ].join(' · ')}
            />
          </div>

          <DataTable
            caption={t('stats.history.byMonth')}
            columns={monthColumns(t, locale)}
            data={history.months}
            initialSort={[{ id: 'month', desc: true }]}
          />

          <div className="grid gap-3 md:grid-cols-2">
            {(['quizzes', 'hosts'] as const).map((kind) => (
              <DataTable
                key={kind}
                caption={t(`stats.history.top.${kind}`)}
                columns={rankColumns(t, locale, kind)}
                data={history[kind]}
              />
            ))}
          </div>

          {history.oldest ? (
            <p className="text-muted-foreground text-xs">
              {t('stats.history.oldest', {
                date: new Date(history.oldest).toLocaleDateString(locale),
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

const count = (n: number, locale: string) => n.toLocaleString(locale);

/** The games under way: the oldest first, sortable by any column. */
function liveColumns(t: T, locale: string): DataColumn<LiveGame>[] {
  return [
    {
      id: 'quiz',
      accessorFn: (g) => g.title,
      header: t('stats.columns.quiz'),
      cell: ({ row }) => (
        <>
          <div className="font-medium">{row.original.title}</div>
          <div className="text-muted-foreground text-xs tabular-nums">
            {t('stats.pin', { pin: row.original.pin })}
          </div>
        </>
      ),
    },
    { id: 'host', accessorFn: (g) => g.host, header: t('stats.columns.host') },
    {
      id: 'progress',
      accessorFn: (g) => g.question?.index ?? 0,
      header: t('stats.columns.progress'),
      cell: ({ row }) =>
        row.original.question ? (
          <Badge variant="success">
            {t('stats.phase.question', {
              index: row.original.question.index,
              total: row.original.question.total,
            })}
          </Badge>
        ) : (
          <Badge variant="muted">{t('stats.phase.lobby')}</Badge>
        ),
    },
    {
      id: 'players',
      accessorFn: (g) => g.players,
      header: t('stats.columns.players'),
      meta: { align: 'right' },
      cell: ({ row }) => count(row.original.players, locale),
    },
    {
      id: 'since',
      accessorFn: (g) => g.since,
      header: t('stats.columns.since'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap" title={row.original.since}>
          {formatAgo(row.original.since, locale)}
        </span>
      ),
    },
  ];
}

/** The months of the history: the latest first. */
function monthColumns(t: T, locale: string): DataColumn<HistoryMonth>[] {
  const monthName = (month: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  return [
    {
      id: 'month',
      accessorFn: (m) => m.month,
      header: t('stats.columns.month'),
      cell: ({ row }) => monthName(row.original.month),
    },
    {
      id: 'games',
      accessorFn: (m) => m.games,
      header: t('stats.history.games'),
      meta: { align: 'right' },
      cell: ({ row }) => count(row.original.games, locale),
    },
    {
      id: 'players',
      accessorFn: (m) => m.players,
      header: t('stats.history.players'),
      meta: { align: 'right' },
      cell: ({ row }) => count(row.original.players, locale),
    },
    {
      id: 'success',
      accessorFn: (m) => m.successRate ?? -1,
      header: t('stats.history.success'),
      meta: { align: 'right' },
      cell: ({ row }) => <ShareBar value={row.original.games ? row.original.successRate : null} />,
    },
  ];
}

/** The most played quizzes (with their owner: copies share a title), the most active hosts. */
function rankColumns(t: T, locale: string, kind: 'quizzes' | 'hosts'): DataColumn<HistoryRank>[] {
  return [
    {
      id: 'name',
      accessorFn: (r) => r.name,
      header: t(`stats.columns.${kind === 'quizzes' ? 'quiz' : 'host'}`),
      cell: ({ row }) => (
        <>
          <div>{row.original.name}</div>
          {row.original.owner ? (
            <div className="text-muted-foreground text-xs">{row.original.owner}</div>
          ) : null}
        </>
      ),
    },
    {
      id: 'games',
      accessorFn: (r) => r.games,
      header: t('stats.history.games'),
      meta: { align: 'right' },
      cell: ({ row }) => count(row.original.games, locale),
    },
    {
      id: 'players',
      accessorFn: (r) => r.players,
      header: t('stats.history.players'),
      meta: { align: 'right' },
      cell: ({ row }) => count(row.original.players, locale),
    },
  ];
}
/** One figure: what it counts, how many, and what it is made of. */
function Figure({
  icon: Icon,
  label,
  value,
  detail,
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  detail?: string;
  /** The page that lists what it counts. */
  to?: '/admin/accounts' | '/admin/quizzes' | '/admin/media';
}) {
  const body = (
    <>
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
    </>
  );
  const box = 'flex flex-col gap-1 rounded-lg border p-3';
  return to ? (
    <Link to={to} className={`${box} hover:bg-accent/50`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
