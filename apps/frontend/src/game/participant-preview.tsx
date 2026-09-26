import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  AnswerExplanation,
  AnswerRules,
  OptionTiles,
  Podium,
  RevealAnswer,
  SlideView,
  TYPE_BASE,
} from './live-components';
import { Surface } from './surface';
import { useGameRemaining } from './use-countdown';
import type { GameView } from './use-game-session';

/**
 * What a participant sees right now, read-only, from the host's own view of the
 * game: a phone-sized column with the same components as the player page,
 * minus the personal parts (no answer, no personal score).
 */
export function ParticipantPreview({ view }: { view: GameView }) {
  const { t } = useTranslation('live');
  const remaining = useGameRemaining(view);
  const q = view.question;
  let body: React.ReactNode;
  if (view.state === 'SLIDE_SHOW' && view.slide) {
    body = (
      <div className="flex min-h-[32em] w-full">
        <SlideView slide={view.slide} />
      </div>
    );
  } else if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && q) {
    body = (
      <div className="flex min-h-[32em] w-full flex-col gap-[0.75em] p-[1em] text-center">
        {remaining !== null ? (
          <span className="text-[2.5em] font-bold tabular-nums">⏱ {remaining}</span>
        ) : null}
        <div className="flex flex-1 flex-col justify-center py-[1em]">
          <Markdown className="text-[1.5em] font-semibold text-balance">{q.prompt}</Markdown>
        </div>
        <AnswerRules question={q} />
        {q.options?.length ? (
          <OptionTiles options={q.options} disabled />
        ) : (
          <Input disabled placeholder={t('player.answerPlaceholder')} className="text-center" />
        )}
      </div>
    );
  } else if ((view.state === 'REVEAL' || view.state === 'LEADERBOARD') && q && view.reveal) {
    body = (
      <div className="flex min-h-[32em] w-full flex-col items-center gap-[1em] p-[1em] text-center">
        <RevealAnswer question={q} reveal={view.reveal} />
        <AnswerExplanation reveal={view.reveal} />
        <p className="text-muted-foreground text-[0.9em]">{t('preview.personalHidden')}</p>
      </div>
    );
  } else if (view.state === 'PODIUM' && view.podium) {
    body = (
      <div className="flex min-h-[32em] w-full flex-col items-center gap-[1em] p-[1em]">
        <h2 className="text-[1.5em] font-bold">{t('player.podium')}</h2>
        <Podium rows={view.podium.podium} />
      </div>
    );
  } else {
    body = (
      <div className="text-muted-foreground flex min-h-[32em] w-full items-center justify-center p-[1em] text-center">
        {view.state === 'ENDED' ? t('screen.thanks') : t('player.waitingHost')}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-muted-foreground text-sm">{t('preview.note')}</p>
      {/* A phone-sized frame with the participant's typographic base. */}
      <div
        className={cn(
          'bg-background w-full max-w-[24em] overflow-hidden rounded-[1.5rem] border-[6px] border-neutral-800 shadow-xl',
          TYPE_BASE.phone,
        )}
      >
        <Surface
          background={q?.background}
          textTone={q?.textTone}
          textOutline={q?.textOutline}
          className={cn('flex w-full', !q?.background && 'bg-transparent')}
        >
          {body}
        </Surface>
      </div>
    </div>
  );
}
