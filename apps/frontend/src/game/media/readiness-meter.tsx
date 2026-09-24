import type { MediaReadinessPayload } from '@quiz-dock/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useCountdown } from '../use-countdown';

/**
 * How many of the devices waited for have loaded the coming question's sound
 * or video: a count and a bar, and the seconds left when the room is waiting.
 * A count only — which participant is late stays on the console.
 */
export function ReadinessMeter({
  readiness,
  until = null,
  className,
}: {
  readiness: MediaReadinessPayload | null;
  /** End of the wait (server ms epoch) while the room waits for media. */
  until?: number | null;
  className?: string;
}) {
  const { t } = useTranslation('live');
  const left = useCountdown(until);
  if (!readiness || readiness.total === 0) return null;
  const { ready, total } = readiness;
  return (
    <div className={cn('flex w-[16em] max-w-full flex-col items-center gap-[0.4em]', className)}>
      <span className="text-muted-foreground" data-testid="readiness">
        {t('screen.readiness', { ready, total })}
        {left !== null && left > 0 ? ` · ${t('screen.readinessLeft', { seconds: left })}` : null}
      </span>
      <div
        className="bg-muted h-[0.4em] w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={ready}
      >
        <div
          className="bg-primary h-full transition-[width]"
          style={{ width: `${(100 * ready) / total}%` }}
        />
      </div>
    </div>
  );
}
