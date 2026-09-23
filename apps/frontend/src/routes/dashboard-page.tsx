import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Pencil, Play, Plus, Search, Sparkles, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { fold } from '@/lib/text';
import { useLaunchSession } from '../game/use-launch-session';
import {
  getQuizzesControllerListQueryKey,
  useQuizzesControllerCreate,
  useQuizzesControllerCreateSamples,
  useQuizzesControllerImportQuiz,
  useQuizzesControllerList,
} from '../api/generated/quizzes/quizzes';
import { ApiError, apiErrorText } from '../api/http';

/** Rows per page: enough to scan, short enough to stay on one screen. */
const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'muted'> = {
  draft: 'default',
  ready: 'success',
  archived: 'muted',
};

export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuizzesControllerList();
  const create = useQuizzesControllerCreate();
  const createSamples = useQuizzesControllerCreateSamples();
  const importQuiz = useQuizzesControllerImportQuiz();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const { launch, isLaunching, error: launchError } = useLaunchSession();
  // Stable entre deux rendus : le `?? []` fabriquerait un tableau neuf à chaque fois,
  // et le tri/filtre ci-dessous se recalculerait pour rien.
  const quizzes = useMemo(() => data?.data ?? [], [data]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'ready' | 'archived'>('all');
  const [sort, setSort] = useState<'recent' | 'title' | 'questions'>('recent');
  const [page, setPage] = useState(1);

  // A bank grows past what one screen holds: filter first, then sort, then cut
  // into pages. All three are client-side — the API returns the caller's quizzes,
  // which stays reasonable at this scale.
  const shown = useMemo(() => {
    const needle = fold(search);
    const kept = quizzes.filter(
      (q) =>
        (status === 'all' || q.status === status) && (!needle || fold(q.title).includes(needle)),
    );
    const sorted = [...kept];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'questions') sorted.sort((a, b) => b.questionCount - a.questionCount);
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted;
  }, [quizzes, search, status, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // Filtering can leave the current page behind the end of the list.
  const current = Math.min(page, pageCount);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const narrow = (next: () => void) => {
    next();
    setPage(1);
  };

  // Le backend refuse (403) quand l'identité n'a pas le rôle hôte : en mode local,
  // le siège d'hôte est tenu par quelqu'un d'autre (ou a expiré → repasser par /login).
  const seatTaken = error instanceof ApiError && error.status === 403;
  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });

  const onLoadSamples = () => {
    createSamples.mutate(undefined, { onSuccess: invalidateList });
  };

  // A bundle (zip, or a bare quiz.json) becomes a new draft: straight to its editor.
  const onImportFile = (file: File | undefined) => {
    if (!file) return;
    importQuiz.mutate(
      { data: { file } },
      {
        onSuccess: (res) => {
          invalidateList();
          void navigate({ to: '/quizzes/$quizId', params: { quizId: res.data.id } });
        },
      },
    );
  };

  const onCreate = () => {
    create.mutate(
      { data: { title: t('newQuiz'), language: 'fr' } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getQuizzesControllerListQueryKey(),
          }),
      },
    );
  };

  return (
    <section className="content-lg flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="hidden"
            aria-label={t('import')}
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={importQuiz.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-4" />
            {importQuiz.isPending ? t('importing') : t('import')}
          </Button>
          <Button type="button" onClick={onCreate} disabled={create.isPending}>
            <Plus className="size-4" />
            {t('newQuiz')}
          </Button>
        </div>
      </div>
      {importQuiz.error ? (
        <p className="text-destructive text-sm" role="alert">
          {apiErrorText(importQuiz.error, t('importError'))}
        </p>
      ) : null}

      {isLoading && <p className="text-muted-foreground">{t('common:loading')}</p>}
      {error ? (
        <p className="text-destructive" role="alert">
          {seatTaken ? t('seatTaken') : t('loadError')}{' '}
          {seatTaken ? (
            <Link to="/login" className="underline">
              {t('seatBackToLogin')}
            </Link>
          ) : null}
        </p>
      ) : null}
      {launchError ? <p className="text-destructive">{launchError}</p> : null}

      {!isLoading && !error && quizzes.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-muted-foreground">{t('empty')}</p>
          <Button
            type="button"
            variant="outline"
            disabled={createSamples.isPending}
            onClick={onLoadSamples}
          >
            <Sparkles className="size-4" />
            {t('loadSamples')}
          </Button>
          <small className="text-muted-foreground">{t('loadSamplesHint')}</small>
        </div>
      )}

      {!isLoading && !error && quizzes.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">{t('search')}</span>
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => narrow(() => setSearch(e.target.value))}
                placeholder={t('search')}
                className="pl-8"
              />
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              {t('filterStatus')}
              <Select
                value={status}
                onChange={(e) => narrow(() => setStatus(e.target.value as typeof status))}
              >
                <option value="all">{t('statusAll')}</option>
                <option value="draft">{t('common:quizStatus.draft')}</option>
                <option value="ready">{t('common:quizStatus.ready')}</option>
                <option value="archived">{t('common:quizStatus.archived')}</option>
              </Select>
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              {t('sortBy')}
              <Select
                value={sort}
                onChange={(e) => narrow(() => setSort(e.target.value as typeof sort))}
              >
                <option value="recent">{t('sortRecent')}</option>
                <option value="title">{t('sortTitle')}</option>
                <option value="questions">{t('sortQuestions')}</option>
              </Select>
            </label>
          </div>
          <p className="text-muted-foreground text-sm" role="status">
            {t('matchCount', { count: shown.length })}
          </p>
        </div>
      ) : null}

      {!isLoading && !error && quizzes.length > 0 && shown.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">{t('noMatch')}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visible.map((quiz) => (
          <li
            key={quiz.id}
            className="hover:bg-accent flex flex-col gap-3 rounded-lg border p-4 transition-colors sm:flex-row sm:items-center sm:gap-4"
          >
            {/* Le titre peut être long : il tronque au lieu de pousser les actions hors écran. */}
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className="min-w-0 flex-1 truncate font-semibold"
            >
              {quiz.title}
            </Link>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={STATUS_VARIANT[quiz.status] ?? 'default'}>
                {t(`common:quizStatus.${quiz.status}`, { defaultValue: quiz.status })}
              </Badge>
              <span className="text-muted-foreground text-sm">
                {t('questionCount', { count: quiz.questionCount })}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Link to="/quizzes/$quizId" params={{ quizId: quiz.id }}>
                <Button type="button" size="sm" variant="outline">
                  <Pencil className="size-4" />
                  {t('edit')}
                </Button>
              </Link>
              {quiz.status === 'ready' && (
                <Button
                  type="button"
                  size="sm"
                  variant="main-action"
                  disabled={isLaunching}
                  onClick={() => void launch(quiz.id)}
                >
                  <Play className="size-4" />
                  {t('present')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <Pagination page={current} pages={pageCount} onChange={setPage} />
    </section>
  );
}
