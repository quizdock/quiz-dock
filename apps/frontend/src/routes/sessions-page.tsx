import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Download, History, Layers, Play, Radio, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { csvFilename, downloadCsv, toCsv } from '@/lib/csv';
import {
  useQuizzesControllerSessionDetail,
  useQuizzesControllerSessionPlayer,
  useQuizzesControllerGet,
  useQuizzesControllerSessions,
} from '../api/generated/quizzes/quizzes';
import { DataTable, type DataColumn, ShareBar } from '@/components/ui/data-table';
import { useLaunchSession } from '../game/use-launch-session';
import type { SessionDetailDtoRoom, SessionListDtoSessionsItem } from '../api/generated/model';
import { sessionDetailRoute, sessionPlayerRoute, sessionsRoute } from '../router';
import { ListSkeleton, LoadFailed, PageLoading } from '@/components/ui/loading';
import { PageTitle } from '@/components/ui/page-title';
import { EmptyState } from '@/components/ui/empty-state';
import { formatPercent } from '@/lib/format';

function statusLabel(t: TFunction, status: string): string {
  return t(`status.${status}`, { defaultValue: status });
}

function statusVariant(status: string): 'success' | 'muted' | 'default' {
  if (status === 'ended') return 'success';
  if (status === 'interrupted') return 'muted';
  return 'default';
}

/** Date + heure courtes, in the interface's language. */
function fmtDate(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Durée d'une session « Xm Ys » à partir des deux bornes ISO. */
function fmtDuration(t: TFunction, startISO: string, endISO: string): string {
  const s = Math.max(
    0,
    Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000),
  );
  const m = Math.floor(s / 60);
  return m > 0
    ? t('duration.minutesSeconds', { minutes: m, seconds: s % 60 })
    : t('duration.seconds', { seconds: s });
}

const pct = (rate: number | null) => (rate === null ? '—' : formatPercent(rate));
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

// ── Liste de l'historique ────────────────────────────────────────────────────
export function SessionsPage() {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const { quizId } = sessionsRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuizzesControllerSessions(quizId);
  const sessions = data?.data.sessions;
  const open = (s: SessionListDtoSessionsItem) =>
    void navigate({
      to: '/quizzes/$quizId/history/$sessionId',
      params: { quizId, sessionId: s.id },
    });

  const columns: DataColumn<SessionListDtoSessionsItem>[] = [
    {
      id: 'date',
      accessorFn: (s) => s.startedAt,
      header: t('list.thDate'),
      sortFn: 'datetime',
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="min-w-0">
            {/* The row leads to the session; the link is the keyboard's way there. */}
            <Link
              to="/quizzes/$quizId/history/$sessionId"
              params={{ quizId, sessionId: s.id }}
              className="font-medium hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {fmtDate(s.startedAt, i18n.language)}
            </Link>
            <p className="text-muted-foreground text-xs">
              {t('list.pin', { pin: s.pin })} · {fmtDuration(t, s.startedAt, s.endedAt)}
            </p>
          </div>
        );
      },
    },
    {
      id: 'status',
      accessorFn: (s) => s.status,
      header: t('list.thStatus'),
      cell: ({ row }) => {
        const s = row.original;
        return (
          <span className="flex flex-wrap gap-1">
            <Badge variant={statusVariant(s.status)}>{statusLabel(t, s.status)}</Badge>
            {s.roomSize ? (
              <Badge variant="default" className="gap-1">
                <Layers className="size-3" />
                {t('list.inRoom', { count: s.roomSize })}
              </Badge>
            ) : null}
            {s.fullCapture ? (
              <Badge variant="default" className="gap-1">
                <Radio className="size-3" />
                {t('list.capture')}
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'players',
      accessorFn: (s) => s.playerCount,
      header: t('list.thPlayers'),
      meta: { align: 'right' },
    },
    {
      id: 'success',
      accessorFn: (s) => s.successRate ?? -1,
      header: t('list.thSuccess'),
      meta: { align: 'right' },
      cell: ({ row }) => <ShareBar value={row.original.successRate} />,
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <PageTitle>{t('list.title')}</PageTitle>
        <Link
          to="/quizzes/$quizId"
          params={{ quizId }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <ArrowLeft className="size-4" />
          {t('list.backToEditor')}
        </Link>
      </header>

      {isLoading ? <ListSkeleton rows={4} /> : null}
      {error ? <LoadFailed error={error} onRetry={() => void refetch()} /> : null}
      {sessions && sessions.length === 0 ? <NoSessionYet quizId={quizId} /> : null}

      {sessions && sessions.length > 0 ? (
        <Card>
          <CardContent className="pt-4">
            <DataTable
              columns={columns}
              data={sessions}
              initialSort={[{ id: 'date', desc: true }]}
              onRowClick={open}
            />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

/** No session yet: the way to one (present it, or publish it to present it). */
function NoSessionYet({ quizId }: { quizId: string }) {
  const { t } = useTranslation(['sessions', 'dashboard']);
  const navigate = useNavigate();
  const { data } = useQuizzesControllerGet(quizId);
  const { launch, isLaunching, error, dialog } = useLaunchSession();
  const status = data?.data.status;
  return (
    <EmptyState
      icon={History}
      action={
        <>
          {status === 'ready' ? (
            <Button
              variant="main-action"
              disabled={isLaunching}
              onClick={() => void launch(quizId)}
            >
              <Play className="size-4" />
              {t('list.presentIt')}
            </Button>
          ) : status === 'draft' ? (
            <Button
              onClick={() =>
                void navigate({
                  to: '/quizzes/$quizId',
                  params: { quizId },
                  search: { publish: true },
                })
              }
            >
              <Send className="size-4" />
              {t('dashboard:publishToPresent')}
            </Button>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {dialog}
        </>
      }
    >
      {t('list.empty')}
    </EmptyState>
  );
}

// ── Détail d'une session ─────────────────────────────────────────────────────
export function SessionDetailPage() {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const { quizId, sessionId } = sessionDetailRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuizzesControllerSessionDetail(quizId, sessionId);
  const s = data?.data;

  if (isLoading) return <PageLoading />;
  if (error || !s) return <LoadFailed error={error} notFound={t('detail.notFound')} />;

  // Export global (tableur animateur) : une ligne par participant.
  const exportGlobal = () => {
    const rows: Array<Array<string | number>> = [
      [
        t('detail.csvGlobal.rank'),
        t('detail.csvGlobal.nickname'),
        t('detail.csvGlobal.score'),
        t('detail.csvGlobal.correct'),
        t('detail.csvGlobal.answered'),
        t('detail.csvGlobal.maxStreak'),
        t('detail.csvGlobal.avgTime'),
      ],
      ...s.players.map((p) => [
        p.finalRank,
        p.nickname,
        p.finalScore,
        p.correctCount,
        p.answeredCount,
        p.maxStreak,
        p.avgResponseMs === null ? '' : (p.avgResponseMs / 1000).toFixed(1),
      ]),
    ];
    downloadCsv(
      csvFilename(s.quizTitle || t('detail.csvGlobal.filenameFallback'), s.pin),
      toCsv(rows),
    );
  };

  // Every answer given, and the right ones: what the overall rate is out of.
  const answersGiven = s.questions.reduce((sum, q) => sum + q.answerCount, 0);
  const answersRight = s.questions.reduce((sum, q) => sum + q.correctCount, 0);
  type QuestionRow = (typeof s.questions)[number];
  type PlayerRow = (typeof s.players)[number];
  const questionColumns: DataColumn<QuestionRow>[] = [
    {
      id: 'number',
      accessorFn: (q) => q.orderIndex + 1,
      header: t('detail.thNumber'),
    },
    {
      id: 'question',
      accessorFn: (q) => q.prompt,
      header: t('detail.thQuestion'),
      enableSorting: false,
      meta: { className: 'max-w-xs truncate' },
      cell: ({ row }) => <Markdown profile="inline">{row.original.prompt}</Markdown>,
    },
    {
      id: 'answers',
      accessorFn: (q) => (q.played ? q.answerCount : -1),
      header: t('detail.thAnswers'),
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.played ? row.original.answerCount : '—'),
    },
    {
      id: 'success',
      accessorFn: (q) => q.successRate ?? -1,
      header: t('detail.thSuccessRate'),
      meta: { align: 'right' },
      // A question the stopped quiz never reached is no 0 %: it says so.
      cell: ({ row }) =>
        row.original.played ? (
          <ShareBar value={row.original.successRate} />
        ) : (
          <span className="text-muted-foreground text-sm">{t('detail.notPlayed')}</span>
        ),
    },
    {
      id: 'time',
      accessorFn: (q) => q.avgResponseMs ?? Number.POSITIVE_INFINITY,
      header: t('detail.thAvgTime'),
      meta: { align: 'right' },
      cell: ({ row }) => seconds(row.original.avgResponseMs),
    },
  ];
  const playerColumns: DataColumn<PlayerRow>[] = [
    { id: 'rank', accessorFn: (p) => p.finalRank, header: t('detail.thRank') },
    {
      id: 'nickname',
      accessorFn: (p) => p.nickname,
      header: t('detail.thNickname'),
      sortFn: 'alphanumeric',
      cell: ({ row }) => (
        <Link
          to="/quizzes/$quizId/history/$sessionId/players/$playerResultId"
          params={{ quizId, sessionId, playerResultId: row.original.id }}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.nickname}
        </Link>
      ),
    },
    {
      id: 'score',
      accessorFn: (p) => p.finalScore,
      header: t('detail.thScore'),
      meta: { align: 'right' },
    },
    {
      id: 'correct',
      accessorFn: (p) => (p.answeredCount ? p.correctCount / p.answeredCount : 0),
      header: t('detail.thCorrect'),
      meta: { align: 'right' },
      cell: ({ row }) => `${row.original.correctCount}/${row.original.answeredCount}`,
    },
    {
      id: 'streak',
      accessorFn: (p) => p.maxStreak,
      header: t('detail.thStreak'),
      meta: { align: 'right' },
    },
    {
      id: 'time',
      accessorFn: (p) => p.avgResponseMs ?? Number.POSITIVE_INFINITY,
      header: t('detail.thAvgTime'),
      meta: { align: 'right' },
      cell: ({ row }) => seconds(row.original.avgResponseMs),
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <PageTitle>{s.quizTitle || t('detail.fallbackTitle')}</PageTitle>
          <p className="text-muted-foreground text-sm">
            {fmtDate(s.startedAt, i18n.language)} · {t('list.pin', { pin: s.pin })} ·{' '}
            {fmtDuration(t, s.startedAt, s.endedAt)}
          </p>
        </div>
        <Badge variant={statusVariant(s.status)}>{statusLabel(t, s.status)}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={s.players.length === 0}
          onClick={exportGlobal}
        >
          <Download className="size-4" />
          {t('detail.exportCsv')}
        </Button>
        <Link
          to="/quizzes/$quizId/history"
          params={{ quizId }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <ArrowLeft className="size-4" />
          {t('detail.history')}
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('detail.statParticipants')} value={String(s.playerCount)} />
        <Stat
          label={t('detail.statSuccessRate')}
          value={pct(s.successRate)}
          // What the rate is out of: the right answers among every answer given.
          note={
            answersGiven > 0
              ? t('detail.statSuccessOf', { count: answersRight, total: answersGiven })
              : undefined
          }
        />
        <Stat
          label={t('detail.statQuestions')}
          value={
            s.playedQuestions < s.totalQuestions
              ? t('detail.statQuestionsPlayed', {
                  count: s.playedQuestions,
                  total: s.totalQuestions,
                })
              : String(s.totalQuestions)
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.questionResultsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={questionColumns} data={s.questions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.participantsTitle')}</CardTitle>
        </CardHeader>
        {/* Suivi individuel coupé (RG-16) : le tableau serait vide sans explication. */}
        {!s.personalTracking ? (
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t('detail.noPersonalTracking')}
          </CardContent>
        ) : (
          <CardContent className="overflow-x-auto">
            <DataTable
              columns={playerColumns}
              data={s.players}
              initialSort={[{ id: 'rank', desc: false }]}
              onRowClick={(p) =>
                void navigate({
                  to: '/quizzes/$quizId/history/$sessionId/players/$playerResultId',
                  params: { quizId, sessionId, playerResultId: p.id },
                })
              }
            />
          </CardContent>
        )}
      </Card>

      {s.room ? <RoomCard room={s.room} pin={s.pin} /> : null}
    </section>
  );
}

/**
 * The room this session was played in (#89): its other archived quizzes, and
 * the standings summed over them — read from those sessions, nothing kept twice.
 */
function RoomCard({ room, pin }: { room: NonNullable<SessionDetailDtoRoom>; pin: string }) {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const standings = room.standings;
  const exportStandings = () => {
    if (!standings) return;
    const rows: Array<Array<string | number>> = [
      [
        t('detail.csvGlobal.rank'),
        t('detail.csvGlobal.nickname'),
        t('detail.csvGlobal.score'),
        t('detail.csvGlobal.correct'),
        t('detail.csvGlobal.answered'),
        t('detail.csvGlobal.maxStreak'),
        t('detail.csvGlobal.avgTime'),
        t('detail.room.thQuizzes'),
      ],
      ...standings.map((p) => [
        p.rank,
        p.nickname,
        p.score,
        p.correctCount,
        p.answeredCount,
        p.maxStreak,
        p.avgResponseMs === null ? '' : (p.avgResponseMs / 1000).toFixed(1),
        p.quizzes,
      ]),
    ];
    downloadCsv(csvFilename(t('detail.room.csvFilename'), pin), toCsv(rows));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-5" />
          {room.name || t('detail.room.defaultName', { host: room.hostName })}
        </CardTitle>
        {standings ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={standings.length === 0}
            onClick={exportStandings}
          >
            <Download className="size-4" />
            {t('detail.room.exportCsv')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          {t('detail.room.intro', { count: room.sessions.length })}
        </p>
        <ol className="flex flex-col gap-1 text-sm">
          {room.sessions.map((r, i) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
              {r.current ? (
                <span className="font-medium">
                  {r.quizTitle || t('detail.fallbackTitle')}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({t('detail.room.thisSession')})
                  </span>
                </span>
              ) : (
                <Link
                  to="/quizzes/$quizId/history/$sessionId"
                  params={{ quizId: r.quizId, sessionId: r.id }}
                  className="font-medium hover:underline"
                >
                  {r.quizTitle || t('detail.fallbackTitle')}
                </Link>
              )}
              <span className="text-muted-foreground text-xs">
                {fmtDate(r.startedAt, i18n.language)}
              </span>
            </li>
          ))}
        </ol>

        {standings ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">{t('detail.room.standingsTitle')}</h3>
            <p className="text-muted-foreground text-xs">{t('detail.room.standingsNote')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="py-2 pr-2 font-medium">{t('detail.thRank')}</th>
                    <th className="py-2 pr-2 font-medium">{t('detail.thNickname')}</th>
                    <th className="py-2 pr-2 text-right font-medium">{t('detail.thScore')}</th>
                    <th className="py-2 pr-2 text-right font-medium">{t('detail.thCorrect')}</th>
                    <th className="py-2 pr-2 text-right font-medium">{t('detail.thStreak')}</th>
                    <th className="py-2 pr-2 text-right font-medium">{t('detail.thAvgTime')}</th>
                    <th className="py-2 text-right font-medium">{t('detail.room.thQuizzes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((p) => (
                    <tr key={p.nickname} className="border-b last:border-0">
                      <td className="py-2 pr-2 tabular-nums">{p.rank}</td>
                      <td className="py-2 pr-2 font-medium">{p.nickname}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{p.score}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {p.correctCount}/{p.answeredCount}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{p.maxStreak}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {seconds(p.avgResponseMs)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{p.quizzes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t('detail.room.noPersonalTracking')}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Détail d'un participant (« le quiz vu par un participant ») ───────────────
export function SessionPlayerPage() {
  const { t } = useTranslation(['sessions', 'common']);
  const { quizId, sessionId, playerResultId } = sessionPlayerRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerSessionPlayer(
    quizId,
    sessionId,
    playerResultId,
  );
  const p = data?.data;

  if (isLoading) return <PageLoading />;
  if (error || !p) return <LoadFailed error={error} notFound={t('player.notFound')} />;

  const hasAnswers = p.fullCapture && p.answers.length > 0;
  const exportPlayer = () => {
    const rows: Array<Array<string | number>> = [
      [
        t('player.csvPlayer.number'),
        t('player.csvPlayer.question'),
        t('player.csvPlayer.answer'),
        t('player.csvPlayer.correct'),
        t('player.csvPlayer.points'),
        t('player.csvPlayer.time'),
      ],
      ...p.answers.map((a) => [
        a.orderIndex + 1,
        a.prompt,
        a.answer,
        a.isCorrect ? t('player.csvPlayer.yes') : t('player.csvPlayer.no'),
        a.pointsAwarded,
        (a.responseMs / 1000).toFixed(1),
      ]),
    ];
    downloadCsv(csvFilename(t('player.csvPlayer.filenameLabel'), p.nickname), toCsv(rows));
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <PageTitle>{p.nickname}</PageTitle>
          <p className="text-muted-foreground text-sm">
            {t('player.summary', {
              rank: p.finalRank,
              score: p.finalScore,
              correct: p.correctCount,
              answered: p.answeredCount,
            })}
          </p>
        </div>
        {hasAnswers ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={exportPlayer}
          >
            <Download className="size-4" />
            {t('player.exportCsv')}
          </Button>
        ) : null}
        <Link
          to="/quizzes/$quizId/history/$sessionId"
          params={{ quizId, sessionId }}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            hasAnswers ? '' : 'ml-auto',
          )}
        >
          <ArrowLeft className="size-4" />
          {t('player.session')}
        </Link>
      </header>

      {!p.fullCapture ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t('player.captureUnavailable')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('player.answersTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-2 font-medium">{t('player.thNumber')}</th>
                  <th className="py-2 pr-2 font-medium">{t('player.thQuestion')}</th>
                  <th className="py-2 pr-2 font-medium">{t('player.thAnswer')}</th>
                  <th className="py-2 pr-2 text-center font-medium">{t('player.thCorrect')}</th>
                  <th className="py-2 pr-2 text-right font-medium">{t('player.thPoints')}</th>
                  <th className="py-2 text-right font-medium">{t('player.thTime')}</th>
                </tr>
              </thead>
              <tbody>
                {p.answers.map((a) => (
                  <tr key={a.orderIndex} className="border-b last:border-0">
                    <td className="py-2 pr-2 tabular-nums">{a.orderIndex + 1}</td>
                    <td className="max-w-[14rem] truncate py-2 pr-2">
                      <Markdown profile="inline">{a.prompt}</Markdown>
                    </td>
                    <td className="max-w-[12rem] truncate py-2 pr-2">{a.answer}</td>
                    <td className="py-2 pr-2 text-center">
                      {a.isCorrect ? (
                        <Check
                          className="text-success mx-auto size-4"
                          aria-label={t('player.correctAria')}
                        />
                      ) : (
                        <X
                          className="text-destructive mx-auto size-4"
                          aria-label={t('player.incorrectAria')}
                        />
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{a.pointsAwarded}</td>
                    <td className="py-2 text-right tabular-nums">{seconds(a.responseMs)}</td>
                  </tr>
                ))}
                {p.answers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground py-4 text-center">
                      {t('player.noAnswers')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
      </CardContent>
    </Card>
  );
}
