import { Link } from '@tanstack/react-router';
import { FileQuestion, History, Image, Radio, UserCog, Users } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { formatAgo, formatBytes } from '@/lib/format';
import { useReadOperation } from './admin-api';

/** How often the live figures are read again (paused while the tab is hidden). */
export const LIVE_REFRESH_MS = 5_000;

interface LiveGame {
  pin: string;
  title: string;
  host: string;
  phase: 'lobby' | 'playing';
  players: number;
  since: string;
  question: { index: number; total: number } | null;
}

interface LiveStats {
  at: string;
  games: LiveGame[];
  totals: { games: number; lobby: number; playing: number; players: number };
  instance: {
    accounts: { total: number; hosts: number; admins: number };
    quizzes: { draft: number; ready: number; archived: number };
    media: { files: number; bytes: number };
    history: { sessions: number; lastEndedAt: string | null };
  };
}

/**
 * The administration's home: what is played right now — every game, its host,
 * its players —, and the instance at a glance. Read again every few seconds.
 */
export function AdminStatsPage() {
  const { t, i18n } = useTranslation('admin');
  const live = useReadOperation<LiveStats>('stats.live', {}, true, LIVE_REFRESH_MS);
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
            value={totals.games}
            detail={[
              t('stats.live.lobby', { count: totals.lobby }),
              t('stats.live.playing', { count: totals.playing }),
            ].join(' · ')}
          />
          <Figure icon={Users} label={t('stats.live.players')} value={totals.players} />
        </div>

        {stats.games.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            {t('stats.live.none')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('stats.columns.quiz')}</th>
                  <th className="px-3 py-2 font-medium">{t('stats.columns.host')}</th>
                  <th className="px-3 py-2 font-medium">{t('stats.columns.progress')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('stats.columns.players')}</th>
                  <th className="px-3 py-2 font-medium">{t('stats.columns.since')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.games.map((game) => (
                  <tr key={game.pin} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{game.title}</div>
                      <div className="text-muted-foreground text-xs tabular-nums">
                        {t('stats.pin', { pin: game.pin })}
                      </div>
                    </td>
                    <td className="px-3 py-2">{game.host}</td>
                    <td className="px-3 py-2">
                      {game.question ? (
                        <Badge variant="success">
                          {t('stats.phase.question', {
                            index: game.question.index,
                            total: game.question.total,
                          })}
                        </Badge>
                      ) : (
                        <Badge variant="muted">{t('stats.phase.lobby')}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{game.players}</td>
                    <td className="px-3 py-2 whitespace-nowrap" title={game.since}>
                      {formatAgo(game.since, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            value={instance.accounts.total}
            detail={[
              t('stats.instance.hosts', { count: instance.accounts.hosts }),
              t('stats.instance.admins', { count: instance.accounts.admins }),
            ].join(' · ')}
            to="/admin/accounts"
          />
          <Figure
            icon={FileQuestion}
            label={t('stats.instance.quizzes')}
            value={instance.quizzes.ready}
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
            value={instance.history.sessions}
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
    </div>
  );
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
