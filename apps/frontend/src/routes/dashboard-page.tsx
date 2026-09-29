import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CopyPlus,
  Eye,
  LayoutGrid,
  List as ListIcon,
  ListChecks,
  Lock,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { MultiSelect } from '@/components/ui/multi-select';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { TagFilter, tagsOf } from '@/components/tag-filter';
import { fold } from '@/lib/text';
import { useStoredView } from '@/lib/use-stored-view';
import { useRole } from '../auth/use-role';
import { useLaunchSession } from '../game/use-launch-session';
import { addStarter } from './quiz-starter';
import { useCopyQuiz } from './use-copy-quiz';
import { QuizFirstStep } from './quiz-first-step';
import {
  getQuizzesControllerListQueryKey,
  useQuizzesControllerCreate,
  useQuizzesControllerImportQuiz,
  useQuizzesControllerList,
} from '../api/generated/quizzes/quizzes';
import type { QuizDto, QuizImportDto } from '../api/generated/model';
import { ApiError, apiErrorText } from '../api/http';
import { ListSkeleton } from '@/components/ui/loading';
import { mediaUrl } from '@/lib/media-url';

/** Rows per page: enough to scan, short enough to stay on one screen. */
const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'muted'> = {
  draft: 'default',
  ready: 'success',
  archived: 'muted',
};

export function DashboardPage() {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuizzesControllerList();
  const create = useQuizzesControllerCreate();
  const importQuiz = useQuizzesControllerImportQuiz();
  const navigate = useNavigate();
  const [imported, setImported] = useState<QuizImportDto | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { launch, isLaunching, error: launchError, dialog: launchDialog } = useLaunchSession();
  const { copy, copying, copyError } = useCopyQuiz();
  // Un gestionnaire lit l'instance ; s'il n'anime pas, il ne crée, n'importe ni ne
  // présente rien. Un compte qui cumule garde tout (RG-14).
  const { isManager, isHost } = useRole();
  const managerOnly = isManager && !isHost;
  // Stable entre deux rendus : le `?? []` fabriquerait un tableau neuf à chaque fois,
  // et le tri/filtre ci-dessous se recalculerait pour rien.
  const quizzes = useMemo(() => data?.data ?? [], [data]);
  const [search, setSearch] = useState('');
  // The statuses ticked (none = every status): the archived ones out of the way by default.
  const [statuses, setStatuses] = useState<string[]>(['draft', 'ready']);
  const [sort, setSort] = useState<'recent' | 'title' | 'questions'>('recent');
  const [language, setLanguage] = useState('');
  // Whose quizzes: '' all, ME the caller's, else an owner's name (a shared quiz, a manager's view).
  const [owner, setOwner] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [view, setView] = useStoredView('quizdock.quizzes.view');
  const languages = useMemo(() => [...new Set(quizzes.map((q) => q.language))].sort(), [quizzes]);
  const others = useMemo(
    () =>
      [
        ...new Set(
          quizzes.flatMap((q) => (q.editable === false && q.ownerName ? [q.ownerName] : [])),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [quizzes],
  );
  // The caller first, then the others by name; everyone last (the default).
  const ownerOptions = useMemo(
    () => [
      { value: ME, label: t('ownerMe') },
      ...others.map((name) => ({ value: name, label: name })),
      { value: '', label: t('ownerAll') },
    ],
    [others, t],
  );
  const allTags = useMemo(() => tagsOf(quizzes), [quizzes]);

  // A bank grows past what one screen holds: filter first, then sort, then cut
  // into pages. All three are client-side — the API returns the caller's quizzes,
  // which stays reasonable at this scale.
  const shown = useMemo(() => {
    const needle = fold(search);
    const kept = quizzes.filter(
      (q) =>
        (statuses.length === 0 || statuses.includes(q.status)) &&
        (!language || q.language === language) &&
        (!owner || ownerKey(q) === owner) &&
        tags.every((tag) => q.tags.includes(tag)) &&
        (!needle || fold(`${q.title} ${q.description ?? ''}`).includes(needle)),
    );
    const sorted = [...kept];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'questions') sorted.sort((a, b) => b.questionCount - a.questionCount);
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted;
  }, [quizzes, search, statuses, language, owner, tags, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // Filtering can leave the current page behind the end of the list.
  const current = Math.min(page, pageCount);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const narrow = (next: () => void) => {
    next();
    setPage(1);
  };

  // Le backend refuse (403) quand l'identité n'a pas le rôle hôte : en mode local,
  // le siège d'hôte est tenu par quelqu'un d'autre (ou a expiré → repasser par /login).
  const seatTaken = error instanceof ApiError && error.status === 403;
  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });

  // A bundle (zip, or a bare quiz.json) becomes a new draft: straight to its editor.
  const onImportFile = (file: File | undefined) => {
    if (!file) return;
    setImported(null);
    importQuiz.mutate(
      { data: { file } },
      {
        onSuccess: (res) => {
          invalidateList();
          if (res.data.importReport) setImported(res.data);
          else void navigate({ to: '/quizzes/$quizId', params: { quizId: res.data.id } });
        },
      },
    );
  };

  const onCreate = () => {
    create.mutate(
      // No language: the server gives the instance's (#83).
      { data: { title: t('newQuiz') } },
      {
        onSuccess: async (res) => {
          // A draft to start from: an intro slide and a first question (see `addStarter`).
          await addStarter(res.data.id, {
            prompt: t('starter.prompt'),
            answer1: t('starter.answer1'),
            answer2: t('starter.answer2'),
          }).catch(() => undefined);
          await queryClient.invalidateQueries({
            queryKey: getQuizzesControllerListQueryKey(),
          });
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{isManager ? t('allQuizzes') : t('title')}</h1>
        <div className={cn('flex flex-wrap items-center gap-2', managerOnly && 'hidden')}>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,.xlsx,application/zip,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
      {imported?.importReport ? (
        <div className="rounded-lg border p-4 space-y-2" role="status">
          <p>{t('kahootImported', { count: imported.importReport.converted })}</p>
          <p>{t('kahootReview')}</p>
          {imported.importReport.skipped.length > 0 ? (
            <ul className="list-disc pl-5">
              {imported.importReport.skipped.map(({ row, reason }) => (
                <li key={row}>
                  {t('kahootSkipped', { row, reason: t(`kahootReasons.${reason}`) })}
                </li>
              ))}
            </ul>
          ) : null}
          <Link to="/quizzes/$quizId" params={{ quizId: imported.id }} className="underline">
            {t('edit')}
          </Link>
        </div>
      ) : null}
      {importQuiz.error ? (
        <p className="text-destructive text-sm" role="alert">
          {apiErrorText(importQuiz.error, t('importError'))}
        </p>
      ) : null}
      {/* A quiz that could not be created or copied says why (the server's reason, or a generic one). */}
      {[create.error, copyError].map((err, i) =>
        err ? (
          <p key={i} className="text-destructive text-sm" role="alert">
            {apiErrorText(err)}
          </p>
        ) : null,
      )}

      {isLoading && <ListSkeleton variant={view} rows={view === 'grid' ? 6 : 5} />}
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
      {launchDialog}

      {!isLoading && !error && quizzes.length === 0 && !managerOnly && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-muted-foreground">{t('empty')}</p>
          {/* Les deux façons de commencer, côte à côte : partir de rien, ou partir
              d'un modèle — les exemples ne sont plus versés d'office (#39). */}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onCreate} disabled={create.isPending}>
              <Plus className="size-4" />
              {t('newQuiz')}
            </Button>
            <Link to="/templates">
              <Button type="button" variant="outline">
                <Sparkles className="size-4" />
                {t('browseTemplates')}
              </Button>
            </Link>
          </div>
          <small className="text-muted-foreground">{t('browseTemplatesHint')}</small>
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
            {/* Not a <label>: it holds a list of its own labelled boxes. */}
            <div className="text-muted-foreground flex flex-col gap-1 text-xs">
              <span>{t('filterStatus')}</span>
              <MultiSelect
                aria-label={t('filterStatus')}
                className="w-44"
                options={(['draft', 'ready', 'archived'] as const).map((v) => ({
                  value: v,
                  label: t(`common:quizStatus.${v}`),
                }))}
                value={statuses}
                onChange={(v) => narrow(() => setStatuses(v))}
                allLabel={t('statusAll')}
                countLabel={(count) => t('statusCount', { count })}
              />
            </div>
            {others.length > 0 ? (
              <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                {t('filterOwner')}
                {others.length > OWNER_SELECT_MAX ? (
                  // Many hosts share: a list to type into rather than to scroll.
                  <Combobox
                    aria-label={t('filterOwner')}
                    className="w-48"
                    options={ownerOptions}
                    value={owner}
                    onChange={(v) => narrow(() => setOwner(v))}
                    emptyText={t('ownerNone')}
                  />
                ) : (
                  <Select value={owner} onChange={(e) => narrow(() => setOwner(e.target.value))}>
                    {ownerOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </label>
            ) : null}
            {languages.length > 1 ? (
              <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                {t('filterLanguage')}
                <Select
                  value={language}
                  onChange={(e) => narrow(() => setLanguage(e.target.value))}
                >
                  <option value="">{t('languageAll')}</option>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
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
            <Segmented
              label={t('display')}
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: t('viewList'), icon: ListIcon },
                { value: 'grid', label: t('viewGrid'), icon: LayoutGrid },
              ]}
            />
          </div>
          <TagFilter
            label={t('filterTags')}
            tags={allTags}
            selected={tags}
            onChange={(next) => narrow(() => setTags(next))}
          />
          <p className="text-muted-foreground text-sm" role="status">
            {t('matchCount', { count: shown.length })}
          </p>
        </div>
      ) : null}

      {!isLoading && !error && quizzes.length > 0 && shown.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">{t('noMatch')}</p>
      ) : null}

      <ul
        className={
          view === 'grid' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-2'
        }
      >
        {visible.map((quiz) => {
          // Someone else's: shared with the instance (or a manager's overview) — read, copied.
          const readOnly = quiz.editable === false;
          const lock = readOnly ? (
            <Lock className="text-muted-foreground size-3.5 shrink-0" aria-label={t('readOnly')} />
          ) : null;
          const actions = (
            <span className="flex flex-wrap gap-2">
              <Link to="/quizzes/$quizId" params={{ quizId: quiz.id }}>
                <Button type="button" size="sm" variant="outline">
                  {readOnly ? <Eye className="size-4" /> : <Pencil className="size-4" />}
                  {readOnly ? t('view') : t('edit')}
                </Button>
              </Link>
              {readOnly && quiz.shared && !managerOnly ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={copying}
                  onClick={() => copy(quiz.id)}
                >
                  <CopyPlus className="size-4" />
                  {t('createFrom')}
                </Button>
              ) : null}
              {!managerOnly && !readOnly && quiz.status === 'ready' && (
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
          );
          const facts = <QuizFacts quiz={quiz} date={date} />;
          return view === 'grid' ? (
            <li key={quiz.id} className="flex flex-col overflow-hidden rounded-lg border">
              <Link
                to="/quizzes/$quizId"
                params={{ quizId: quiz.id }}
                className="hover:bg-accent flex flex-1 flex-col transition-colors"
              >
                <QuizFirstStep
                  quizId={quiz.id}
                  hasCover={!!quiz.coverMediaId}
                  fallback={<QuizCover quiz={quiz} className="aspect-video w-full" />}
                />
                <span className="flex flex-1 flex-col gap-2 p-4">
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {lock}
                      {quiz.title}
                    </span>
                    <StatusBadge status={quiz.status} />
                  </span>
                  {quiz.description ? (
                    <span className="text-muted-foreground line-clamp-2 text-sm">
                      {quiz.description}
                    </span>
                  ) : null}
                  <span className="mt-auto pt-1">{facts}</span>
                </span>
              </Link>
              <span className="border-t p-3">{actions}</span>
            </li>
          ) : (
            <li
              key={quiz.id}
              className="hover:bg-accent flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:gap-4"
            >
              <QuizCover quiz={quiz} className="hidden size-14 shrink-0 rounded-md sm:flex" />
              {/* Le titre peut être long : il tronque au lieu de pousser les actions hors écran. */}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  {lock}
                  <Link
                    to="/quizzes/$quizId"
                    params={{ quizId: quiz.id }}
                    className="min-w-0 truncate font-semibold"
                  >
                    {quiz.title}
                  </Link>
                  <StatusBadge status={quiz.status} />
                </span>
                {facts}
              </span>
              {actions}
            </li>
          );
        })}
      </ul>

      <Pagination page={current} pages={pageCount} onChange={setPage} />
    </section>
  );
}

/** Past this many other owners, the filter becomes a list to type into. */
const OWNER_SELECT_MAX = 8;

/** The owner filter's value for the caller's own quizzes (never a name). */
const ME = '\u0000me';

/** Whose a quiz is, as the owner filter reads it. */
const ownerKey = (q: QuizDto) => (q.editable === false ? (q.ownerName ?? '') : ME);

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('common');
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'default'} className="shrink-0">
      {t(`quizStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

/** The quiz's cover, or a neutral tile: a list of pictures reads faster than titles alone. */
function QuizCover({ quiz, className }: { quiz: QuizDto; className?: string }) {
  return quiz.coverMediaId ? (
    <img
      src={mediaUrl(quiz.coverMediaId)}
      alt=""
      loading="lazy"
      className={cn('object-cover', className)}
    />
  ) : (
    <span
      className={cn('bg-muted text-muted-foreground flex items-center justify-center', className)}
    >
      <ListChecks className="size-6" aria-hidden />
    </span>
  );
}

/** What tells one quiz from another at a glance: size, language, when, whose, tags, licence. */
function QuizFacts({ quiz, date }: { quiz: QuizDto; date: (iso: string) => string }) {
  const { t } = useTranslation('dashboard');
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span>{t('questionCount', { count: quiz.questionCount })}</span>
      <span>· {quiz.language.toUpperCase()}</span>
      <span>· {t('updatedOn', { date: date(quiz.updatedAt) })}</span>
      {quiz.ownerName ? <span>· {t('ownedBy', { name: quiz.ownerName })}</span> : null}
      {quiz.license ? <span>· {quiz.license}</span> : null}
      {quiz.tags.slice(0, 3).map((tag) => (
        <span key={tag} className="bg-muted rounded px-1">
          {tag}
        </span>
      ))}
      {quiz.tags.length > 3 ? <span>+{quiz.tags.length - 3}</span> : null}
    </span>
  );
}
