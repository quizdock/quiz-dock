import type { SlideBackground, SlideBlock } from '@quiz-dock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CopyPlus,
  LayoutGrid,
  LibraryBig,
  List as ListIcon,
  ListChecks,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { FilterField } from '@/components/ui/filter-field';
import { Select } from '@/components/ui/select';
import { TagFilter, tagsOf } from '@/components/tag-filter';
import { fold } from '@/lib/text';
import { useStoredView } from '@/lib/use-stored-view';
import { cn } from '@/lib/utils';
import type { StoreEntryDto } from '../api/generated/model';
import { useStoreControllerList, useStoreControllerTake } from '../api/generated/store/store';
import { getQuizzesControllerListQueryKey } from '../api/generated/quizzes/quizzes';
import { apiErrorText } from '../api/http';
import { useRole } from '../auth/use-role';
import { SlideStage } from '../game/slide-stage';
import { ListSkeleton, LoadFailed } from '@/components/ui/loading';
import { PageTitle } from '@/components/ui/page-title';

const PAGE_SIZE = 20;

/**
 * Le catalogue des modèles partagés sur cette instance (#39). Une liste dense,
 * comme la banque : chaque ligne dit l'essentiel — quoi, de qui, combien de
 * questions — et mène à l'aperçu, qui est ce sur quoi on décide vraiment.
 */
export function TemplatesPage() {
  const { t, i18n } = useTranslation(['store', 'dashboard', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useStoreControllerList();
  const take = useStoreControllerTake();
  const { isHost } = useRole();
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (id: string) => {
    setError(null);
    try {
      const { data: quiz } = await take.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
      await navigate({ to: '/quizzes/$quizId', params: { quizId: quiz.id } });
    } catch (e) {
      setError(apiErrorText(e, t('takeFailed')));
    }
  };
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'title' | 'questions'>('recent');
  const [language, setLanguage] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  // A gallery by default: a template is chosen on what it shows.
  const [view, setView] = useStoredView('quizdock.templates.view', 'grid');

  const entries = useMemo(() => list.data?.data ?? [], [list.data]);
  const languages = useMemo(() => [...new Set(entries.map((e) => e.language))].sort(), [entries]);
  const allTags = useMemo(() => tagsOf(entries), [entries]);
  const shown = useMemo(() => {
    const needle = fold(search);
    const kept = entries.filter(
      (e) =>
        (!language || e.language === language) &&
        tags.every((tag) => e.tags.includes(tag)) &&
        (!needle || fold(`${e.title} ${e.description ?? ''} ${e.author.name}`).includes(needle)),
    );
    const sorted = [...kept];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'questions') sorted.sort((a, b) => b.questionCount - a.questionCount);
    else sorted.sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
    return sorted;
  }, [entries, search, language, tags, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <PageTitle>{t('title')}</PageTitle>
        <p className="text-muted-foreground max-w-prose text-sm">{t('intro')}</p>
      </header>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {list.isPending ? <ListSkeleton variant="grid" rows={6} /> : null}

      {list.isError ? <LoadFailed error={list.error} /> : null}
      {list.isSuccess && entries.length === 0 ? <EmptyCatalogue /> : null}

      {entries.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative min-w-[12rem] flex-1 basis-full sm:basis-auto">
              <span className="sr-only">{t('search')}</span>
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('search')}
                className="pl-8"
              />
            </label>
            {languages.length > 1 ? (
              <FilterField label={t('dashboard:filterLanguage')}>
                <Select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('dashboard:languageAll')}</option>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </FilterField>
            ) : null}
            <FilterField label={t('sortBy')}>
              <Select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as typeof sort);
                  setPage(1);
                }}
              >
                <option value="recent">{t('sortRecent')}</option>
                <option value="title">{t('sortTitle')}</option>
                <option value="questions">{t('sortQuestions')}</option>
              </Select>
            </FilterField>
            <Segmented
              label={t('dashboard:display')}
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: t('dashboard:viewList'), icon: ListIcon },
                { value: 'grid', label: t('dashboard:viewGrid'), icon: LayoutGrid },
              ]}
            />
          </div>
          <TagFilter
            label={t('dashboard:filterTags')}
            tags={allTags}
            selected={tags}
            onChange={(next) => {
              setTags(next);
              setPage(1);
            }}
          />
          <p className="text-muted-foreground text-sm" role="status">
            {t('templateCount', { count: shown.length })}
          </p>
        </>
      ) : null}

      {entries.length > 0 && shown.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">{t('noMatch')}</p>
      ) : null}

      {/* Une galerie : on choisit un modèle sur ce qu'il montre, pas sur une ligne
          de texte. La vignette, à défaut de couverture, reste une surface neutre
          plutôt qu'un trou. */}
      <ul
        className={
          view === 'grid' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-2'
        }
      >
        {visible.map((entry) => (
          <li
            key={entry.id}
            className={cn(
              'flex overflow-hidden rounded-lg border',
              view === 'grid' ? 'flex-col' : 'flex-col sm:flex-row sm:items-center',
            )}
          >
            <Link
              to="/templates/$templateId"
              params={{ templateId: entry.id }}
              className={cn(
                'hover:bg-accent group flex flex-1 transition-colors',
                view === 'grid' ? 'flex-col' : 'min-w-0 items-center gap-3',
              )}
            >
              {view === 'grid' ? (
                <TemplateThumb entry={entry} />
              ) : (
                <span className="hidden w-28 shrink-0 overflow-hidden sm:block">
                  <TemplateThumb entry={entry} />
                </span>
              )}
              <span
                className={cn(
                  'flex min-w-0 flex-1 flex-col',
                  view === 'grid' ? 'gap-2 p-4' : 'gap-1 p-3',
                )}
              >
                <span className="font-semibold">{entry.title}</span>
                {entry.description ? (
                  <span className="text-muted-foreground line-clamp-2 text-sm">
                    {entry.description}
                  </span>
                ) : null}
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  <Badge variant="muted">{entry.language}</Badge>
                  <span className="text-muted-foreground text-sm">
                    {t('questionCount', { count: entry.questionCount })}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('sharedBy', { name: entry.author.name, date: date(entry.sharedAt) })}
                </span>
              </span>
            </Link>
            {/* L'action est sur la carte : on ne devrait pas avoir à ouvrir un
                modèle pour pouvoir s'en servir. */}
            {isHost ? (
              <span className={view === 'grid' ? 'border-t p-3' : 'border-t p-3 sm:border-t-0'}>
                <Button
                  type="button"
                  size="sm"
                  className={view === 'grid' ? 'w-full' : 'w-full sm:w-auto'}
                  disabled={take.isPending}
                  onClick={() => void onCreate(entry.id)}
                >
                  <CopyPlus className="size-4" />
                  {t('createFrom')}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <Pagination page={current} pages={pageCount} onChange={setPage} />
    </section>
  );
}

/**
 * Ce qu'on voit d'un modèle sur sa carte : sa couverture, à défaut sa première
 * diapositive dessinée comme à l'écran, à défaut l'image ou l'énoncé de la
 * première question. Une tuile vide ne dit rien d'un quiz.
 */
function TemplateThumb({ entry }: { entry: StoreEntryDto }) {
  const slide = entry.first?.slide;
  if (!entry.coverUrl && slide) {
    // The stage is a picture here: the whole card is the link.
    return <TemplateSlide slide={slide} />;
  }
  const image = entry.coverUrl ?? entry.first?.media ?? null;
  const gradient = entry.first?.gradient;
  const background = gradient
    ? { backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.colors.join(', ')})` }
    : undefined;
  return (
    <span
      className="bg-muted flex aspect-video items-center justify-center overflow-hidden p-4"
      style={background}
    >
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : entry.first?.text ? (
        <span
          className={`line-clamp-3 text-center text-sm font-medium ${gradient ? 'text-white drop-shadow' : ''}`}
        >
          {entry.first.text}
        </span>
      ) : (
        <span className="text-muted-foreground text-3xl font-semibold">
          {entry.title.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** A slide of the catalogue, as the catalogue serves it. */
export interface ServedSlide {
  blocks: unknown[];
  background: SlideBackground | null;
  textTone: 'light' | 'dark';
  textOutline: boolean;
}

/**
 * A slide of a template drawn as on the big screen — the same miniature as the
 * quiz preview. A picture, not a control: hidden from assistive tech, no clicks.
 */
export function TemplateSlide({ slide, className }: { slide: ServedSlide; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('pointer-events-none block', className)}>
      <SlideStage
        slide={{
          slideIndex: 0,
          questionIndex: 0,
          blocks: slide.blocks as SlideBlock[],
          background: slide.background,
          textTone: slide.textTone,
          textOutline: slide.textOutline,
          displayDelayS: null,
        }}
      />
    </span>
  );
}

/**
 * No template on the instance yet: the same empty state as the editor's — what
 * is missing, how to fill it, and the way to the quizzes a template is shared from.
 */
function EmptyCatalogue() {
  const { t } = useTranslation(['store', 'auth']);
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center">
      <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
        <LibraryBig className="size-8" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{t('emptyTitle')}</p>
        <p className="text-muted-foreground max-w-sm text-sm">{t('empty')}</p>
      </div>
      <Link to="/quizzes" className={buttonVariants({ variant: 'outline' })}>
        <ListChecks className="size-4" />
        {t('auth:nav.myQuizzes')}
      </Link>
    </div>
  );
}
