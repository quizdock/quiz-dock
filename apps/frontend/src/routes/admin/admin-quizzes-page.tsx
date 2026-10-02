import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  MoreHorizontal,
  Radio,
  Search,
  Trash2,
  UserRoundCog,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QuizStatusBadge } from '@/components/quiz-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FilterField } from '@/components/ui/filter-field';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { MenuItem, MenuSeparator } from '@/components/ui/menu-item';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { Popover } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { formatAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../../api/http';
import {
  type Answer,
  useCatalogue,
  useReadOperation,
  useRefreshAdmin,
  useRunOperation,
} from './admin-api';
import { OperationPanel } from './operation-panel';

const PAGE = 25;

interface QuizItem {
  id: string;
  title: string;
  status: 'draft' | 'ready' | 'archived';
  questionCount: number;
  updatedAt: string;
  owner: { id: string; name: string; subject: string; reachable: boolean };
  livePin: string | null;
}

interface SearchData {
  total: number;
  items: QuizItem[];
  owners: { id: string; name: string; subject: string; quizzes: number }[];
}

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
  const params = {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(owner ? { owner } : {}),
    ...(status ? { status } : {}),
    ...(orphans ? { orphans: true } : {}),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  };
  const search = useReadOperation<SearchData>('quizzes.search', params);
  const data = search.data?.data;
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

      {search.isError ? (
        <LoadFailed error={search.error} />
      ) : !data ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : data.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('quizzes.none')}</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t('quizzes.count', { count: data.total })}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('quizzes.columns.quiz')}</th>
                  <th className="px-3 py-2 font-medium">{t('quizzes.columns.owner')}</th>
                  <th className="px-3 py-2 font-medium">{t('quizzes.columns.updated')}</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">{t('quizzes.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((quiz) => (
                  <tr key={quiz.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{quiz.title}</span>
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
                    </td>
                    <td className="px-3 py-2">
                      {quiz.owner.name}
                      <span className="text-muted-foreground block text-xs">
                        {quiz.owner.subject}
                      </span>
                      {!quiz.owner.reachable ? (
                        <Badge variant="muted" className="mt-1">
                          {t('quizzes.unreachable')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" title={quiz.updatedAt}>
                      {formatAgo(quiz.updatedAt, i18n.language)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <QuizActions quiz={quiz} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.ceil(data.total / PAGE)} onChange={setPage} />
        </>
      )}
    </div>
  );
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
      <Modal open={!!descriptor} onClose={() => setOpen(null)} className="w-full max-w-lg">
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
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [confirm, setConfirm] = useState<{
    answer: Extract<Answer, { kind: 'confirm' }>;
    id: string;
  } | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playing = !!quiz.livePin;

  const call = async (id: string, params: Record<string, unknown>, confirmation?: string) => {
    setError(null);
    try {
      const answer = await run(id, params, { confirmation });
      if (answer.kind === 'confirm') {
        setConfirm({ answer, id });
        return;
      }
      const data = answer.result.data as { base64?: string; filename?: string } | undefined;
      if (data?.base64 && data.filename) download(data.base64, data.filename);
      else await refresh();
    } catch (err) {
      setError(apiErrorText(err));
    }
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
            aria-label={t('quizzes.columns.actions')}
            aria-expanded={open}
            onClick={toggle}
          >
            <MoreHorizontal aria-hidden className="size-4" />
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
            <MenuItem onClick={() => (close(), void call('quizzes.export', { quiz: quiz.id }))}>
              <Download aria-hidden className="size-4" />
              {t('quizzes.actions.export')}
            </MenuItem>
            <MenuItem disabled={playing} onClick={() => (close(), setTransfer(true))}>
              <UserRoundCog aria-hidden className="size-4" />
              {t('quizzes.actions.transfer')}
            </MenuItem>
            {quiz.status === 'archived' ? (
              <MenuItem onClick={() => (close(), void call('quizzes.restore', { quiz: quiz.id }))}>
                <ArchiveRestore aria-hidden className="size-4" />
                {t('quizzes.actions.restore')}
              </MenuItem>
            ) : (
              <MenuItem onClick={() => (close(), void call('quizzes.archive', { quiz: quiz.id }))}>
                <Archive aria-hidden className="size-4" />
                {t('quizzes.actions.archive')}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              destructive
              disabled={playing}
              onClick={() => (close(), void call('quizzes.delete', { quiz: quiz.id }))}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('quizzes.actions.delete')}
            </MenuItem>
          </>
        )}
      </Popover>
      {error ? (
        <p role="alert" className="text-destructive max-w-56 text-left text-xs">
          {error}
        </p>
      ) : null}
      {/* Mounted when it asks: one closed dialog per row would weigh on a long list. */}
      {confirm ? (
        <ConfirmDialog
          open
          title={quiz.title}
          description={confirm?.answer.summary}
          destructive
          confirmLabel={t('quizzes.actions.delete')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            if (pending) void call(pending.id, { quiz: quiz.id }, pending.answer.token);
          }}
        />
      ) : null}
      {transfer ? (
        <TransferDialog
          quiz={quiz}
          onClose={() => setTransfer(false)}
          onTransfer={async (to) => {
            await call('quizzes.transfer', { quiz: quiz.id, to });
            setTransfer(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Hands a quiz over to another account, picked by its name, subject or e-mail. */
function TransferDialog({
  quiz,
  onClose,
  onTransfer,
}: {
  quiz: QuizItem;
  onClose: () => void;
  onTransfer: (to: string) => Promise<void>;
}) {
  const { t } = useTranslation('admin');
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const found = useReadOperation<{
    accounts: { name: string; subject: string; email: string | null; roles: string[] }[];
  }>('users.find', { q: q.trim(), limit: 10 });
  const accounts = (found.data?.data?.accounts ?? []).filter(
    (a) => a.subject !== quiz.owner.subject,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (to) void onTransfer(to);
  };
  return (
    <Modal onClose={onClose} className="w-full max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-3 p-6 text-left">
        <h2 className="text-lg font-semibold">
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
                  {a.email ?? a.subject} · {a.roles.join('+') || t('quizzes.transfer.player')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" disabled={!to}>
            {t('quizzes.actions.transfer')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Saves a bundle the API handed over as base64. */
function download(base64: string, filename: string) {
  const link = document.createElement('a');
  link.href = `data:application/zip;base64,${base64}`;
  link.download = filename;
  link.click();
}
