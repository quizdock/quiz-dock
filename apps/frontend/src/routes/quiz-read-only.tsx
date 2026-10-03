import { Link } from '@tanstack/react-router';
import { apiErrorText } from '../api/http';
import { CopyPlus, ExternalLink, Eye, History, LayoutTemplate, ListOrdered } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { QuizStatusBadge } from '@/components/quiz-status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { type QuizItem, quizItems, slideLabel } from '@/lib/quiz-items';
import { cn } from '@/lib/utils';
import type { QuizDetailDto } from '../api/generated/model';
import { useRole } from '../auth/use-role';
import { useCopyQuiz } from './use-copy-quiz';
import { StepStage } from './quiz-stage-preview';
import { QuestionProperties, SlideProperties } from './step-properties';
import { PageTitle } from '@/components/ui/page-title';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * A quiz the caller may read but not change: one another host shares with the
 * instance, or a manager looking at another host's quiz (RG-14, #82). The
 * editor's controls would only fail on save, so this view shows the content and
 * the way to see it played (Preview); a manager also reads its history. A quiz
 * shared with the instance is copied to be made one's own ("Create from this").
 */
/** A slide's display time when it sets none (the engine's default, as the editor says). */
const DEFAULT_SLIDE_SECONDS = 5;

export function QuizReadOnly({ quiz }: { quiz: QuizDetailDto }) {
  const { t } = useTranslation(['editor', 'common']);
  const { isManager, isHost } = useRole();
  const { copy, copying, copyError } = useCopyQuiz();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = quizItems(quiz);
  const selected = items[Math.min(selectedIndex, items.length - 1)] as QuizItem | undefined;

  let questionIndex = 0;
  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageTitle>{quiz.title}</PageTitle>
          <div className="flex flex-wrap items-center gap-1">
            <QuizStatusBadge status={quiz.status} className="mr-2" />
            <a
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              href={`/quizzes/${quiz.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              {t('header.preview')}
            </a>
            {isManager ? (
              <Link
                to="/quizzes/$quizId/history"
                params={{ quizId: quiz.id }}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              >
                <History className="size-4" />
                {t('header.history')}
              </Link>
            ) : null}
            {quiz.shared && isHost ? (
              <Button type="button" size="sm" disabled={copying} onClick={() => copy(quiz.id)}>
                <CopyPlus className="size-4" />
                {t('readOnly.createFrom')}
              </Button>
            ) : null}
            {copyError ? (
              <p className="text-destructive text-sm" role="alert">
                {apiErrorText(copyError)}
              </p>
            ) : null}
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

      {/* The editor's layout: the sequence on the left, the selected step on the right. */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
          <h2 className="text-lg font-semibold">
            {t('questions.title', { count: quiz.questionCount })}
          </h2>
          {/* The list scrolls on its own: a long quiz never pushes the detail away. */}
          <ul className="flex min-h-0 flex-col gap-0.5 lg:overflow-y-auto lg:pr-1">
            {items.map((item, index) => {
              const isSlide = item.kind === 'slide';
              if (!isSlide) questionIndex += 1;
              const active = item.id === selected?.id;
              const meta = isSlide
                ? `${t('slides.kind')} · ${
                    item.slide.displayDelayS === 0
                      ? t('slides.durationManual')
                      : `${item.slide.displayDelayS ?? DEFAULT_SLIDE_SECONDS} s`
                  }`
                : `${t(`questionType.${item.question.type}`, { defaultValue: item.question.type })} · ${item.question.timeLimitS} s`;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full min-w-0 items-start gap-3 rounded-xl border border-transparent px-2 py-3 text-left transition-colors',
                      active ? 'bg-primary/5 border-primary/30' : 'hover:bg-accent/60',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
                        isSlide ? 'text-muted-foreground' : 'bg-muted text-muted-foreground',
                        active && !isSlide && 'bg-primary text-primary-foreground',
                      )}
                      aria-label={isSlide ? t('slides.kind') : undefined}
                    >
                      {isSlide ? <LayoutTemplate className="size-4" /> : questionIndex}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Markdown profile="inline" className="line-clamp-2 block text-sm font-medium">
                        {isSlide ? slideLabel(item.slide) : item.question.prompt}
                      </Markdown>
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {meta}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {items.length === 0 ? (
              <li>
                <EmptyState icon={ListOrdered}>{t('readOnly.empty')}</EmptyState>
              </li>
            ) : null}
          </ul>
        </aside>

        <section className="min-h-[24rem] min-w-0">
          {selected ? (
            <div className="bg-muted/40 flex flex-col gap-4 rounded-2xl p-6">
              {/* As it will show, still: on the projection's stage. */}
              <StepStage item={selected} index={selectedIndex} quiz={quiz} />
              {selected.kind === 'slide' ? (
                <SlideProperties slide={selected.slide} />
              ) : (
                <QuestionProperties question={selected.question} />
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
