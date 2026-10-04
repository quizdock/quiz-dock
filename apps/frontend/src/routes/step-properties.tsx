import { TILE_RATIO } from '@quiz-dock/contracts';
import { appConfig } from '../config';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { COLOR_BG, OPTION_BG_FALLBACK } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import type { QuizDetailDtoQuestionsItem, QuizDetailDtoSlidesItem } from '../api/generated/model';
import { ShapeIcon } from '@/components/shape-icon';
import { mediaUrl } from '@/lib/media-url';

/** One property: its name, then what it is set to. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 border-b py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * How a question is run, read-only: its type and what it means, its answers and
 * the right ones, how it is scored, its time, its media, its explanation — the
 * editor's settings, said in words.
 */
export function QuestionProperties({ question: q }: { question: QuizDetailDtoQuestionsItem }) {
  const { t } = useTranslation(['editor', 'live']);
  const media = q.media;
  // The wrong answers greyed, when the question has right ones (not a poll, not an order).
  const markWrong = q.type !== 'ordering' && q.options.some((o) => o.isCorrect);
  const hasSound = !!media?.audio || media?.visual?.kind === 'video';
  // The types that have a scoring variant name theirs; the others have none to show.
  const scoringLabel = t(`questionForm.scoring.${q.type}.${q.scoring}`, { defaultValue: '' });
  return (
    <dl className="bg-background rounded-xl border px-4">
      <Row label={t('questionForm.typeLabel')}>
        <span className="font-medium">{t(`questionType.${q.type}`, { defaultValue: q.type })}</span>
        <span className="text-muted-foreground block text-xs">
          {t(`questionTypeHelp.${q.type}`, { defaultValue: '' })}
        </span>
      </Row>

      {q.options.length > 0 ? (
        <Row label={t('questionForm.optionsLegend')}>
          <ul className="flex flex-col gap-1">
            {[...q.options]
              .sort((a, b) =>
                q.type === 'ordering'
                  ? (a.correctOrderIndex ?? 0) - (b.correctOrderIndex ?? 0)
                  : a.orderIndex - b.orderIndex,
              )
              .map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded text-[0.7rem] text-white',
                      COLOR_BG[o.color] ?? OPTION_BG_FALLBACK,
                      markWrong && !o.isCorrect && 'opacity-40 grayscale',
                    )}
                    aria-hidden
                  >
                    <ShapeIcon shape={o.shape} />
                  </span>
                  {o.mediaId ? (
                    <img
                      src={mediaUrl(o.mediaId)}
                      alt=""
                      className="h-8 shrink-0 rounded object-cover"
                      style={{ aspectRatio: TILE_RATIO }}
                    />
                  ) : null}
                  {q.type === 'ordering' && o.correctOrderIndex != null ? (
                    <span className="text-muted-foreground tabular-nums">
                      {o.correctOrderIndex + 1}.
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      o.isCorrect && 'font-medium',
                      markWrong && !o.isCorrect && 'text-muted-foreground',
                    )}
                  >
                    {o.text || o.alt || t('preview.optionFallback', { index: o.orderIndex + 1 })}
                  </span>
                  {o.isCorrect ? (
                    <span className="text-success flex items-center gap-1 text-xs">
                      <Check className="size-3.5" aria-hidden />
                      {t('questionForm.correct')}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
          {q.type === 'ordering' ? (
            <span className="text-muted-foreground mt-1 block text-xs">
              {t('readOnly.props.orderShown')}
            </span>
          ) : null}
        </Row>
      ) : null}

      {q.type === 'text_input' ? (
        <Row label={t('questionForm.acceptedAnswersLegend')}>
          {q.acceptedAnswers.map((a) => a.text).join(' · ') || '—'}
        </Row>
      ) : null}

      {q.type === 'numeric' ? (
        <Row label={t('questionForm.numericValueLabel')}>
          {q.numericValue ?? '—'}
          {q.numericTolerance && Number(q.numericTolerance) !== 0
            ? ` (${t('questionForm.numericToleranceLabel')} ${q.numericTolerance})`
            : ''}
        </Row>
      ) : null}

      {q.type !== 'poll' ? (
        <Row label={t('questionForm.pointsLabel')}>
          {t(`questionForm.pointsMode.${q.pointsMode}`, { defaultValue: q.pointsMode })}
          {scoringLabel ? (
            <span className="text-muted-foreground block text-xs">
              {t('questionForm.scoringLabel')} : {scoringLabel}
              {` — ${t(`questionForm.scoringHelp.${q.type}.${q.scoring}`, { defaultValue: '' })}`}
            </span>
          ) : null}
        </Row>
      ) : null}

      <Row label={t('questionForm.timingLegend')}>
        {t('readOnly.props.seconds', { count: q.timeLimitS })}
        {q.timerAfterMedia ? (
          <span className="text-muted-foreground block text-xs">
            {t('questionForm.listenFirstLabel')}
          </span>
        ) : null}
        <span className="text-muted-foreground block text-xs">
          {t('questionForm.revealDelayLabel')} :{' '}
          {q.revealDelayS
            ? `${q.revealDelayS} s`
            : appConfig.autoAdvanceS
              ? t('questionForm.revealDelayAutoValue', { seconds: appConfig.autoAdvanceS })
              : t('questionForm.revealDelayPlaceholder')}
        </span>
      </Row>

      {media?.visual || media?.audio ? (
        <Row label={t('media.slotsLegend')}>
          {[
            media.visual?.kind === 'image' ? t('media.kindImage') : null,
            media.visual?.kind === 'video' ? t('media.kindVideo') : null,
            media.audio
              ? `${t('media.audioLabel')} (${Math.round(media.audio.durationMs / 1000)} s)`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          {hasSound ? (
            <span className="text-muted-foreground block text-xs">
              {t('questionForm.audioTargetLabel')} :{' '}
              {q.audioTarget
                ? t(`settings.audioTarget.${q.audioTarget}`)
                : t('questionForm.audioTargetDefault')}
              {media.audio
                ? ` · ${t('questionForm.waveformSizeLabel')} : ${t(`questionForm.waveformSize.${q.waveformSize}`)}`
                : ''}
            </span>
          ) : null}
        </Row>
      ) : null}

      <Row label={t('background.legend')}>
        {q.backgroundMediaId
          ? t('background.kind.image')
          : q.backgroundGradient
            ? t('background.kind.gradient')
            : t('background.kind.none')}
      </Row>

      <Row label={t('questionForm.answerExplanationLabel')}>
        {q.answerExplanation ? (
          <Markdown className="text-sm">{q.answerExplanation}</Markdown>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Row>
    </dl>
  );
}

/** How a slide is run, read-only: its time, its media, its background. */
export function SlideProperties({ slide: s }: { slide: QuizDetailDtoSlidesItem }) {
  const { t } = useTranslation('editor');
  const hasSound = (!!s.videoMediaId && s.videoSound) || !!s.audioMediaId;
  return (
    <dl className="bg-background rounded-xl border px-4">
      <Row label={t('slideForm.displayLegend')}>
        {s.displayDelayS === 0
          ? t('slideForm.display.manual')
          : s.displayDelayS
            ? t('readOnly.props.seconds', { count: s.displayDelayS })
            : t('slideForm.display.default')}
      </Row>
      <Row label={t('slideForm.mediaLegend')}>
        {s.videoMediaId || s.audioMediaId ? (
          <>
            {[
              s.videoMediaId
                ? `${t('media.kindVideo')} (${[
                    s.videoLoop ? t('slideForm.videoLoop') : null,
                    s.videoSound ? t('slideForm.videoSound') : t('readOnly.props.muted'),
                  ]
                    .filter(Boolean)
                    .join(', ')})`
                : null,
              s.audioMediaId ? t('media.audioLabel') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {hasSound ? (
              <span className="text-muted-foreground block text-xs">
                {t('questionForm.audioTargetLabel')} :{' '}
                {s.audioTarget
                  ? t(`settings.audioTarget.${s.audioTarget}`)
                  : t('questionForm.audioTargetDefault')}
                {s.audioMediaId
                  ? ` · ${t('questionForm.waveformSizeLabel')} : ${t(`questionForm.waveformSize.${s.waveformSize}`)}`
                  : ''}
              </span>
            ) : null}
          </>
        ) : (
          t('media.none')
        )}
      </Row>
      <Row label={t('background.legend')}>
        {s.mediaId
          ? t('background.kind.image')
          : s.gradient
            ? t('background.kind.gradient')
            : t('background.kind.none')}
      </Row>
    </dl>
  );
}
