import {
  ChevronLeft,
  ChevronRight,
  LayoutTemplate,
  Maximize,
  Minimize,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { useMediaUrl } from '@/lib/media-url';
import { type QuizItem, quizItems, slideLabel } from '@/lib/quiz-items';
import { useFullscreen } from '@/lib/use-fullscreen';
import { cn } from '@/lib/utils';
import type { QuizDetailDtoQuestionsItem, QuizDetailDtoSlidesItem } from '../api/generated/model';
import { ParticipantPreview } from '../game/participant-preview';
import { ScaledStage } from '../game/slide-stage';
import type { StepQuiz } from './quiz-stage-preview';
import { ScreenSurface } from './screen-page';
import { stepView } from './step-view';
import type { GameView } from '../game/use-game-session';
import { useHotkeys } from 'react-hotkeys-hook';

/** What the preview walks: a quiz, or a template read as the quiz a copy would make. */
export type PreviewQuiz = StepQuiz & {
  questions: QuizDetailDtoQuestionsItem[];
  slides: QuizDetailDtoSlidesItem[];
};

/**
 * A quiz's steps, one at a time on the projection's 16:9 stage, with the list of
 * steps beside it and ← → to walk them — the quiz preview and a template's page
 * alike (UI system §3). `header` is the page's own; the stage alone goes full screen.
 */
export function QuizStepsPreview({
  quiz,
  header,
  footer,
}: {
  quiz: PreviewQuiz;
  header: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation('editor');
  // The full sequence — questions and slides (#7) — as the live game walks it.
  const items = quizItems(quiz);
  const total = items.length;
  const [index, setIndex] = useState(0);
  // What the room sees: the projection, or a participant's phone; a question with its answer.
  const [device, setDevice] = useState<'projection' | 'phone'>('projection');
  const [answer, setAnswer] = useState(false);
  const url = useMediaUrl();
  const step = (delta: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();

  // ← → walk the steps, unless typing somewhere.
  useHotkeys('left', () => step(-1), [total]);
  useHotkeys('right', () => step(1), [total]);

  const item = items[index];
  // One view per step: the live screens key their media and clocks on it.
  const view = useMemo(
    () => (total > 0 ? stepView(items, index, quiz, url, { reveal: answer }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quiz, index, answer, url],
  );
  return (
    <div className="flex w-full flex-col gap-6">
      {header}
      {total === 0 ? (
        <p className="text-muted-foreground">{t('preview.noQuestions')}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <StepList items={items} current={index} onPick={setIndex} />
          <div
            ref={ref}
            className={cn(
              'flex min-w-0 flex-col gap-3',
              // Full screen: the stage and its buttons only, centred (a projector, a big screen).
              isFullscreen && 'bg-background justify-center overflow-auto p-6 sm:p-12',
            )}
          >
            {/* Above the stage: the buttons stay put whatever the step shows. */}
            <nav className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft className="size-4" />
                {t('preview.previous')}
              </Button>
              <span className="text-muted-foreground text-sm tabular-nums">
                {t('preview.questionPosition', { index: index + 1, total })}
              </span>
              <div className="flex items-center gap-2">
                {supported ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={
                      isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')
                    }
                    title={isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')}
                    onClick={() => void toggle()}
                  >
                    {isFullscreen ? (
                      <Minimize className="size-4" />
                    ) : (
                      <Maximize className="size-4" />
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index >= total - 1}
                  onClick={() => step(1)}
                >
                  {t('preview.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </nav>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                size="sm"
                label={t('preview.device')}
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'projection', label: t('preview.projection'), icon: Monitor },
                  { value: 'phone', label: t('preview.phone'), icon: Smartphone },
                ]}
              />
              {item.kind === 'question' ? (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={answer}
                    onCheckedChange={setAnswer}
                    aria-label={t('preview.showAnswer')}
                  />
                  {t('preview.showAnswer')}
                </label>
              ) : null}
            </div>
            {view === null ? null : (
              // 16:9 like the projection, as wide as the window's height allows: the whole
              // stage stays in view under the buttons.
              <div
                className="mx-auto w-full"
                style={{
                  maxWidth:
                    device === 'projection'
                      ? `calc((100dvh - ${isFullscreen ? 10 : 16}rem) * 16 / 9)`
                      : undefined,
                }}
              >
                <RoomScreen view={view} device={device} />
              </div>
            )}
          </div>
        </div>
      )}
      {footer}
    </div>
  );
}

/** The steps, numbered like the editor's list; the one on stage is marked. */
function StepList({
  items,
  current,
  onPick,
}: {
  items: QuizItem[];
  current: number;
  onPick: (index: number) => void;
}) {
  const { t } = useTranslation('editor');
  let question = 0;
  return (
    <ol
      aria-label={t('preview.steps')}
      className="hidden max-h-[calc(100dvh-12rem)] flex-col gap-0.5 overflow-y-auto lg:flex"
    >
      {items.map((item, i) => {
        const isSlide = item.kind === 'slide';
        if (!isSlide) question += 1;
        const active = i === current;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              onClick={() => onPick(i)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm',
                active ? 'bg-primary/5 border-primary/30' : 'hover:bg-accent/60',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums',
                  isSlide ? 'text-muted-foreground' : 'bg-muted text-muted-foreground',
                  active && !isSlide && 'bg-primary text-primary-foreground',
                )}
              >
                {isSlide ? (
                  <LayoutTemplate className="size-3.5" aria-label={t('slides.kind')} />
                ) : (
                  question
                )}
              </span>
              <Markdown profile="inline" className="line-clamp-2 min-w-0 flex-1">
                {(isSlide ? slideLabel(item.slide) : item.question.prompt) || '—'}
              </Markdown>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A view as the room would see it: the projection on its 16:9 stage, or a
 * participant's phone — the live components themselves.
 */
export function RoomScreen({ view, device }: { view: GameView; device: 'projection' | 'phone' }) {
  return device === 'projection' ? (
    <ScaledStage className="rounded-xl border">
      <ScreenSurface pin="" view={view} socket={null} role="preview" fit="box" />
    </ScaledStage>
  ) : (
    <ParticipantPreview view={view} note={false} />
  );
}
