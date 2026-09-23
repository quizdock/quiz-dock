import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { fold } from '@/lib/text';
import type { StoreEntryDto } from '../api/generated/model';
import { useStoreControllerList, useStoreControllerTake } from '../api/generated/store/store';
import { getQuizzesControllerListQueryKey } from '../api/generated/quizzes/quizzes';
import { apiErrorText } from '../api/http';
import { useRole } from '../auth/use-role';

const PAGE_SIZE = 20;

/**
 * Le catalogue des modèles partagés sur cette instance (#39). Une liste dense,
 * comme la banque : chaque ligne dit l'essentiel — quoi, de qui, combien de
 * questions — et mène à l'aperçu, qui est ce sur quoi on décide vraiment.
 */
export function TemplatesPage() {
  const { t, i18n } = useTranslation(['store', 'common']);
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
  const [page, setPage] = useState(1);

  const entries = useMemo(() => list.data?.data ?? [], [list.data]);
  const shown = useMemo(() => {
    const needle = fold(search);
    const kept = entries.filter(
      (e) => !needle || fold(`${e.title} ${e.description ?? ''} ${e.author.name}`).includes(needle),
    );
    const sorted = [...kept];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'questions') sorted.sort((a, b) => b.questionCount - a.questionCount);
    else sorted.sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
    return sorted;
  }, [entries, search, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t('intro')}</p>
      </header>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {list.isPending ? <p className="text-muted-foreground">{t('common:loading')}</p> : null}

      {!list.isPending && entries.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6">{t('empty')}</p>
      ) : null}

      {entries.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative min-w-[12rem] flex-1">
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
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              {t('sortBy')}
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
            </label>
          </div>
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
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((entry) => (
          <li key={entry.id} className="flex flex-col overflow-hidden rounded-lg border">
            <Link
              to="/templates/$templateId"
              params={{ templateId: entry.id }}
              className="hover:bg-accent group flex flex-1 flex-col transition-colors"
            >
              <TemplateThumb entry={entry} />
              <span className="flex flex-1 flex-col gap-2 p-4">
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
              <span className="border-t p-3">
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={take.isPending}
                  onClick={() => void onCreate(entry.id)}
                >
                  <Plus className="size-4" />
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
 * Ce qu'on voit d'un modèle sur sa carte : sa couverture, à défaut l'image de
 * son premier élément, à défaut ce premier élément rendu — la diapositive
 * d'intro avec son dégradé, ou l'énoncé de la première question. Une tuile vide
 * ne dit rien d'un quiz.
 */
function TemplateThumb({ entry }: { entry: StoreEntryDto }) {
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
