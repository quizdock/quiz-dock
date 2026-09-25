import { Link } from '@tanstack/react-router';
import { ExternalLink, Eye, History, LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { quizItems, slideLabel } from '@/lib/quiz-items';
import { cn } from '@/lib/utils';
import type { QuizDetailDto } from '../api/generated/model';

/**
 * A quiz the caller may read but not change: a manager looking at another
 * host's quiz (RG-14, #82). The editor's controls would only fail on save, so
 * this view shows the content, the way to see it played (Preview) and its
 * history. Taking a copy stays the owner's call: only a quiz they shared as a
 * template can be copied, from the templates, like any host (RG-17).
 */
export function QuizReadOnly({ quiz }: { quiz: QuizDetailDto }) {
  const { t } = useTranslation(['editor', 'common']);
  const items = quizItems(quiz);

  let questionIndex = 0;
  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{quiz.title}</h1>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="muted" className="mr-2">
              {t(`common:quizStatus.${quiz.status}`, { defaultValue: quiz.status })}
            </Badge>
            <a
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              href={`/quizzes/${quiz.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              {t('header.preview')}
            </a>
            <Link
              to="/quizzes/$quizId/history"
              params={{ quizId: quiz.id }}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              <History className="size-4" />
              {t('header.history')}
            </Link>
          </div>
        </div>
        <div
          role="status"
          className="bg-muted/40 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
        >
          <Eye className="text-muted-foreground size-4 shrink-0" aria-hidden />
          {t('readOnly.notice', { owner: quiz.ownerName ?? '?' })}
        </div>
        {quiz.description ? (
          <p className="text-muted-foreground max-w-(--container-content-sm) text-sm whitespace-pre-line">
            {quiz.description}
          </p>
        ) : null}
      </header>

      <section className="flex max-w-(--container-content-sm) flex-col gap-2">
        <h2 className="text-lg font-semibold">
          {t('questions.title', { count: quiz.questionCount })}
        </h2>
        <ol className="flex flex-col gap-1">
          {items.map((item) => {
            const isSlide = item.kind === 'slide';
            if (!isSlide) questionIndex += 1;
            return (
              <li key={item.id} className="flex gap-3 rounded-lg px-2 py-1.5">
                <span
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
                    isSlide ? 'text-muted-foreground' : 'bg-muted text-muted-foreground',
                  )}
                  aria-label={isSlide ? t('slides.kind') : undefined}
                >
                  {isSlide ? <LayoutTemplate className="size-4" /> : questionIndex}
                </span>
                <Markdown profile="inline" className="line-clamp-2 block min-w-0 text-sm">
                  {isSlide ? slideLabel(item.slide) : item.question.prompt}
                </Markdown>
              </li>
            );
          })}
          {items.length === 0 ? (
            <li className="text-muted-foreground text-sm">{t('questions.empty')}</li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}
