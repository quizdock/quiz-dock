import type { QuizSearchItem } from '@quiz-dock/contracts';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  EllipsisVertical,
  Radio,
  Search,
  Trash2,
  UserRoundCog,
  SearchX,
} from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { QuizStatusBadge } from '@/components/quiz-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterField } from '@/components/ui/filter-field';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { MenuItem, MenuSeparator } from '@/components/ui/menu-item';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { Popover } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { formatAgo } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';
import { saveBase64 } from '../../api/download';
import { useCatalogue, useReadOperation } from './admin-api';
import { useOperationAction } from './use-operation-action';
import { OperationPanel } from './operation-panel';

const PAGE = 25;

type QuizItem = QuizSearchItem;

/**
 * Every quiz of the instance, whoever owns it (§0.1, Quizzes domain): searched
 * and filtered, each with what an administrator does to it — open it, export it,
 * hand it over, archive or restore it, delete it. The import, the samples and
 * the purge of old sessions sit above the list.
 */
export function AdminQuizzesPage() {
  const { t, i18n } = useTranslation('admin');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('');
  const [orphans, setOrphans] = useState(false);
  const [page, setPage] = useState(1);
  const sought = useDebounced(q.trim());
  const params = {
    ...(sought ? { q: sought } : {}),
    ...(owner ? { owner } : {}),
    ...(status ? { status } : {}),
    ...(orphans ? { orphans: true } : {}),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  };
  const search = useReadOperation('quizzes.search', params);
  const data = search.data?.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));
  // The last row of the last page gone (deleted, archived away): back to a page that has rows.
  useEffect(() => {
    if (data && page > pages) setPage(pages);
  }, [data, page, pages]);
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageActions />
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">{t('quizzes.search')}</span>
          <Search
            aria-hidden
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={q}
            placeholder={t('quizzes.search')}
            onChange={(e) => filter(() => setQ(e.target.value))}
            className="pl-8"
          />
        </label>
        <FilterField label={t('quizzes.owner')}>
          <Select value={owner} onChange={(e) => filter(() => setOwner(e.target.value))}>
            <option value="">{t('quizzes.everyone')}</option>
            {(data?.owners ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.quizzes})
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t('quizzes.status')}>
          <Select value={status} onChange={(e) => filter(() => setStatus(e.target.value))}>
            <option value="">{t('quizzes.anyStatus')}</option>
            {(['draft', 'ready', 'archived'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`quizzes.statuses.${s}`)}
              </option>
            ))}
          </Select>
        </FilterField>
        <button
          type="button"
          aria-pressed={orphans}
          onClick={() => filter(() => setOrphans((o) => !o))}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs',
            orphans ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-accent',
          )}
        >
          {t('quizzes.orphans')}
        </button>
      </div>

      {search.isError && data ? <StaleNotice onRetry={() => void search.refetch()} /> : null}
      {search.isError && !data ? (
        <LoadFailed error={search.error} />
      ) : !data ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={SearchX}>{t('quizzes.none')}</EmptyState>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t('quizzes.count', { count: data.total })}
          </p>
          <DataTable
            columns={quizColumns(t, i18n.language)}
            data={data.items}
            rowId={(quiz) => quiz.id}
          />
        </>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} />
    </div>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** The quizzes' columns: a page of a server-side search, so none sorts. */
function quizColumns(t: T, locale: string): DataColumn<QuizItem>[] {
  return [
    {
      id: 'quiz',
      header: t('quizzes.columns.quiz'),
      enableSorting: false,
      cell: ({ row: { original: quiz } }) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className="font-medium hover:underline"
            >
              {quiz.title}
            </Link>
            <QuizStatusBadge status={quiz.status} />
            {quiz.livePin ? (
              <Badge variant="warning" className="gap-1">
                <Radio aria-hidden className="size-3" />
                {t('quizzes.live', { pin: quiz.livePin })}
              </Badge>
            ) : null}
          </div>
          <span className="text-muted-foreground text-xs">
            {t('quizzes.questions', { count: quiz.questionCount })}
          </span>
        </>
      ),
    },
    {
      id: 'owner',
      header: t('quizzes.columns.owner'),
      enableSorting: false,
      cell: ({ row: { original: quiz } }) => (
        <>
          {quiz.owner.name}
          <span className="text-muted-foreground block text-xs">{quiz.owner.subject}</span>
          {!quiz.owner.reachable ? (
            <Badge variant="muted" className="mt-1">
              {t('quizzes.unreachable')}
            </Badge>
          ) : null}
        </>
      ),
    },
    {
      id: 'updated',
      header: t('quizzes.columns.updated'),
      enableSorting: false,
      cell: ({ row: { original: quiz } }) => (
        <span className="whitespace-nowrap" title={quiz.updatedAt}>
          {formatAgo(quiz.updatedAt, locale)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('quizzes.columns.actions')}</span>,
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => <QuizActions quiz={row.original} />,
    },
  ];
}

/** Above the list: what concerns no quiz in particular. */
function PageActions() {
  const { t } = useTranslation('admin');
  const catalogue = useCatalogue();
  const [open, setOpen] = useState<string | null>(null);
  const descriptor = catalogue.data?.find((d) => d.id === open);
  return (
    <div className="flex flex-wrap gap-2">
      {(['quizzes.import', 'samples.load', 'sessions.purge'] as const).map((id) => (
        <Button key={id} type="button" size="sm" variant="outline" onClick={() => setOpen(id)}>
          {t(`quizzes.actions.${id.replace('.', '_')}`)}
        </Button>
      ))}
      <Modal
        open={!!descriptor}
        onClose={() => setOpen(null)}
        className="w-full max-w-lg"
        aria-label={open ? t(`quizzes.actions.${open.replace('.', '_')}`) : undefined}
      >
        {descriptor ? (
          <div className="flex flex-col gap-3 p-2">
            <OperationPanel descriptor={descriptor} />
            <Button
              type="button"
              variant="ghost"
              className="self-end"
              onClick={() => setOpen(null)}
            >
              {t('quizzes.close')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** What an administrator does to one quiz, from its row. */
function QuizActions({ quiz }: { quiz: QuizItem }) {
  const { t } = useTranslation('admin');
  const action = useOperationAction();
  const [transfer, setTransfer] = useState(false);
  const playing = !!quiz.livePin;
  const named = { title: quiz.title };

  const exportIt = async () => {
    const result = await action.act('quizzes.export', { quiz: quiz.id });
    const data = result?.data as { base64?: string; filename?: string } | undefined;
    if (data?.base64 && data.filename) saveBase64(data.base64, data.filename);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Popover
        align="end"
        className="w-56 p-1"
        trigger={({ open, toggle }) => (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('quizzes.actionsFor', named)}
            aria-expanded={open}
            onClick={toggle}
          >
            <EllipsisVertical aria-hidden className="size-4" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('quizzes.actions.open')}
            </Link>
            <MenuItem onClick={() => (close(), void exportIt())}>
              <Download aria-hidden className="size-4" />
              {t('quizzes.actions.export')}
            </MenuItem>
            <MenuItem
              disabled={playing}
              onClick={() => (close(), action.clearError(), setTransfer(true))}
            >
              <UserRoundCog aria-hidden className="size-4" />
              {t('quizzes.actions.transfer')}
            </MenuItem>
            {quiz.status === 'archived' ? (
              <MenuItem
                onClick={() => (close(), void action.act('quizzes.restore', { quiz: quiz.id }))}
              >
                <ArchiveRestore aria-hidden className="size-4" />
                {t('quizzes.actions.restore')}
              </MenuItem>
            ) : (
              <MenuItem
                onClick={() => (close(), void action.act('quizzes.archive', { quiz: quiz.id }))}
              >
                <Archive aria-hidden className="size-4" />
                {t('quizzes.actions.archive')}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              destructive
              disabled={playing}
              onClick={() => (
                close(),
                void action.act(
                  'quizzes.delete',
                  { quiz: quiz.id },
                  {
                    title: quiz.title,
                    confirmLabel: t('quizzes.actions.delete'),
                    destructive: true,
                  },
                )
              )}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('quizzes.actions.delete')}
            </MenuItem>
          </>
        )}
      </Popover>
      {action.error && !transfer ? (
        <p role="alert" className="text-destructive max-w-56 text-left text-xs">
          {action.error}
        </p>
      ) : null}
      {transfer ? (
        <TransferDialog
          quiz={quiz}
          busy={action.busy}
          error={action.error}
          onClose={() => setTransfer(false)}
          onTransfer={async (to) => {
            if (await action.act('quizzes.transfer', { quiz: quiz.id, to })) setTransfer(false);
          }}
        />
      ) : null}
      {action.confirmDialog}
    </div>
  );
}

function TransferDialog({
  quiz,
  busy,
  error,
  onClose,
  onTransfer,
}: {
  quiz: QuizItem;
  busy: boolean;
  /** A refusal, said here: the dialog stays open on it. */
  error: string | null;
  onClose: () => void;
  onTransfer: (to: string) => Promise<void>;
}) {
  const { t } = useTranslation('admin');
  const titleId = useId();
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const sought = useDebounced(q.trim());
  const found = useReadOperation<{
    accounts: { name: string; subject: string; email: string | null; roles: string[] }[];
  }>('users.find', { q: sought, limit: 10 });
  const accounts = (found.data?.data?.accounts ?? []).filter(
    (a) => a.subject !== quiz.owner.subject,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (to) void onTransfer(to);
  };
  return (
    <Modal onClose={onClose} className="w-full max-w-md" aria-labelledby={titleId}>
      <form onSubmit={submit} className="flex flex-col gap-3 p-6 text-left">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('quizzes.transfer.title', { title: quiz.title })}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t('quizzes.transfer.help', { owner: quiz.owner.name })}
        </p>
        <Input
          type="search"
          autoFocus
          value={q}
          placeholder={t('quizzes.transfer.search')}
          aria-label={t('quizzes.transfer.search')}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="flex max-h-60 flex-col overflow-y-auto">
          {accounts.map((a) => (
            <li key={a.subject}>
              <button
                type="button"
                aria-pressed={to === a.subject}
                onClick={() => setTo(a.subject)}
                className={cn(
                  'flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm',
                  to === a.subject ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                )}
              >
                {a.name}
                <span className="text-muted-foreground text-xs">
                  {a.email ?? a.subject} ·{' '}
                  {(['admin', 'host'] as const)
                    .filter((r) => a.roles.includes(r))
                    .map((r) => t(`accounts.roles.${r}`))
                    .join(', ') || t('accounts.roles.player')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" disabled={!to || busy}>
            {t('quizzes.actions.transfer')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
