import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { QuizFeedbackSummaryDto } from '../api/generated/model';
import { useQuizzesControllerFeedback } from '../api/generated/quizzes/quizzes';
import { feedbackRoute } from '../router';

const PAGE_SIZE = 20;

/** Filled/empty stars for a rating out of 5. */
export function StarRow({ value, size = 'size-4' }: { value: number; size?: string }) {
  const { t } = useTranslation('editor');
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={t('feedback.starsAriaLabel', { value })}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={cn(
            size,
            i < value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Whole-quiz summary: average, count, and one bar per star. Clicking a bar
 * filters the list (when `onPick` is given); the summary itself never changes.
 */
export function FeedbackSummary({
  summary,
  picked,
  onPick,
}: {
  summary: Pick<QuizFeedbackSummaryDto, 'count' | 'average' | 'distribution'>;
  picked?: number;
  onPick?: (rating: number | undefined) => void;
}) {
  const { t } = useTranslation('editor');
  const max = Math.max(1, ...summary.distribution);
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums">
          {summary.count ? summary.average.toFixed(1) : '–'}
        </span>
        <StarRow value={Math.round(summary.average)} size="size-5" />
        <span className="text-muted-foreground text-sm">
          {t('feedback.count', { count: summary.count })}
        </span>
      </div>
      <ul className="flex w-full max-w-sm flex-col gap-1">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = summary.distribution[star - 1] ?? 0;
          const row = (
            <>
              <span className="text-muted-foreground w-3 text-right text-xs tabular-nums">
                {star}
              </span>
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                <span
                  className="bg-amber-400 block h-full rounded-full"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">{n}</span>
            </>
          );
          return (
            <li key={star}>
              {onPick ? (
                <button
                  type="button"
                  aria-pressed={picked === star}
                  className={cn(
                    'hover:bg-accent/60 flex w-full items-center gap-2 rounded px-1 py-0.5',
                    picked === star && 'bg-accent',
                  )}
                  onClick={() => onPick(picked === star ? undefined : star)}
                >
                  {row}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5">{row}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** All reviews of a quiz (§2.11): summary, star filter, paginated list. Owner only. */
export function FeedbackPage() {
  const { t } = useTranslation(['editor', 'common']);
  const { quizId } = feedbackRoute.useParams();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState<number | undefined>(undefined);
  const { data, isLoading, error } = useQuizzesControllerFeedback(quizId, {
    page,
    pageSize: PAGE_SIZE,
    ...(rating ? { rating } : {}),
  });
  const summary = data?.data;
  const pages = summary ? Math.max(1, Math.ceil(summary.total / summary.pageSize)) : 1;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('feedback.title')}</h1>
        <Link
          to="/quizzes/$quizId"
          params={{ quizId }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <ArrowLeft className="size-4" />
          {t('feedback.backToEditor')}
        </Link>
      </header>

      {isLoading ? <p className="text-muted-foreground">{t('common:loading')}</p> : null}
      {error ? <p className="text-destructive">{t('feedback.loadError')}</p> : null}

      {summary ? (
        <>
          <FeedbackSummary
            summary={summary}
            picked={rating}
            onPick={(r) => {
              setRating(r);
              setPage(1);
            }}
          />
          {summary.count === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
              {t('feedback.empty')}
            </p>
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {summary.items.map((f) => (
                <li key={f.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StarRow value={f.rating} size="size-3.5" />
                    <span className="font-medium">{f.nickname}</span>
                    <time className="text-muted-foreground ml-auto text-xs" dateTime={f.createdAt}>
                      {new Date(f.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                  {f.comment ? <p className="text-sm">{f.comment}</p> : null}
                </li>
              ))}
              {summary.items.length === 0 ? (
                <li className="text-muted-foreground py-6 text-center text-sm">
                  {t('feedback.noneForFilter')}
                </li>
              ) : null}
            </ul>
          )}
          {pages > 1 ? (
            <nav className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                {t('feedback.previous')}
              </Button>
              <span className="text-muted-foreground text-sm">
                {t('feedback.pagePosition', { page, pages })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('feedback.next')}
                <ChevronRight className="size-4" />
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
