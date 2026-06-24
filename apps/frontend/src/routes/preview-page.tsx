import { ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { COLOR_BG, OPTION_BG_FALLBACK, SHAPE_GLYPH } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { useFullscreen } from '@/lib/use-fullscreen';
import type { QuizDetailDto, QuizDetailDtoQuestionsItem } from '../api/generated/model';
import { useQuizzesControllerGet } from '../api/generated/quizzes/quizzes';
import { previewRoute } from '../router';

export function PreviewPage() {
  const { t } = useTranslation(['editor', 'common']);
  const { quizId } = previewRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerGet(quizId);

  if (isLoading) return <p className="text-muted-foreground">{t('common:loading')}</p>;
  if (error || !data) return <p className="text-destructive">{t('notFound')}</p>;
  return <QuizPreview quiz={data.data} />;
}

function QuizPreview({ quiz }: { quiz: QuizDetailDto }) {
  const { t } = useTranslation('editor');
  const [index, setIndex] = useState(0);
  const total = quiz.questions.length;
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-4',
        // En plein écran : occupe tout l'écran (projeté / grand écran), contenu centré.
        isFullscreen && 'max-w-none justify-center overflow-auto bg-background p-6 sm:p-12',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b pb-2 text-muted-foreground">
        <span>{t('preview.view')}</span>
        <div className="flex items-center gap-3">
          <strong className="text-foreground">{quiz.title}</strong>
          {supported && (
            <Button type="button" variant="outline" size="sm" onClick={() => void toggle()}>
              {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              {isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')}
            </Button>
          )}
        </div>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground">{t('preview.noQuestions')}</p>
      ) : (
        <>
          <QuestionPreview question={quiz.questions[index]} large={isFullscreen} />
          <nav className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              <ChevronLeft className="size-4" />
              {t('preview.previous')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('preview.questionPosition', { index: index + 1, total })}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={index >= total - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              {t('preview.next')}
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}

function QuestionPreview({
  question,
  large = false,
}: {
  question: QuizDetailDtoQuestionsItem;
  large?: boolean;
}) {
  const { t } = useTranslation('editor');
  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-xl border p-4 sm:p-6',
        large && 'mx-auto w-full max-w-5xl gap-6',
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {t(`questionType.${question.type}`, { defaultValue: question.type })}
      </div>
      {question.mediaId && (
        <img
          className={cn('self-center object-contain', large ? 'max-h-[40vh]' : 'max-h-56')}
          src={`/api/v1/media/${question.mediaId}`}
          alt=""
        />
      )}
      <h2 className={cn('font-semibold', large ? 'text-3xl md:text-5xl' : 'text-xl sm:text-2xl')}>
        {question.prompt}
      </h2>
      <div className={cn('text-muted-foreground', large && 'text-2xl')}>
        ⏱ {question.timeLimitS} s
      </div>

      {question.options.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {question.options.map((opt) => (
            <li
              key={opt.id}
              className={cn(
                'flex items-center gap-3 rounded-lg font-semibold text-white',
                large ? 'px-6 py-6 text-xl md:text-2xl' : 'px-4 py-3',
                COLOR_BG[opt.color] ?? OPTION_BG_FALLBACK,
                opt.isCorrect && 'outline outline-2 outline-offset-2 outline-success',
              )}
            >
              <span className={cn(large ? 'text-3xl' : 'text-lg')} aria-hidden="true">
                {SHAPE_GLYPH[opt.shape] ?? '◆'}
              </span>
              <span className="flex-1">
                {opt.text ?? t('preview.optionFallback', { index: opt.orderIndex + 1 })}
              </span>
              {question.type === 'ordering' && opt.correctOrderIndex != null && (
                <span className="rounded-full bg-black/25 px-2">#{opt.correctOrderIndex + 1}</span>
              )}
              {opt.isCorrect && <span aria-label={t('preview.correctAnswer')}>✓</span>}
            </li>
          ))}
        </ul>
      )}

      {question.acceptedAnswers.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {t('preview.acceptedAnswers', {
            answers: question.acceptedAnswers.map((a) => a.text).join(', '),
          })}
        </div>
      )}

      {question.type === 'numeric' && question.numericValue != null && (
        <div className="text-sm text-muted-foreground">
          {t('preview.numericTarget', {
            value: question.numericValue,
            tolerance: question.numericTolerance ?? 0,
          })}
        </div>
      )}
    </article>
  );
}
