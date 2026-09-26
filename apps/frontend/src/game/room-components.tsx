import type { RoomStandingsPayload } from '@quiz-dock/contracts';
import { ListPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMeControllerMe } from '../api/generated/me/me';
import { useQuizzesControllerList } from '../api/generated/quizzes/quizzes';
import { type GameSocket, emitWithAckOrError } from './game-client';
import { LeaderboardList } from './live-components';

/**
 * The room's standings over its quizzes so far (#89): the top of the room, the
 * viewer's own line highlighted when they have one.
 */
export function RoomStandingsPanel({
  standings,
  max = 10,
  className,
}: {
  standings: RoomStandingsPayload;
  max?: number;
  className?: string;
}) {
  const { t } = useTranslation('live');
  return (
    <div className={cn('flex w-full flex-col gap-[0.5em]', className)}>
      <h3 className="text-muted-foreground font-semibold">
        {t('room.standingsTitle')}{' '}
        <span className="font-normal">
          · {t('room.afterQuizzes', { count: standings.quizzesPlayed })}
        </span>
      </h3>
      <LeaderboardList rows={standings.top} highlightRank={standings.you?.rank} max={max} />
    </div>
  );
}

/**
 * The host picks the room's next quiz (`host:next-quiz`): from the podium (the
 * results of the quiz just played kept or not, as when ending), or from the
 * lobby (the quiz picked is replaced). Only the host's own quizzes that can be
 * played — `ready`, with a question — are offered: the server refuses the rest.
 */
export function NextQuizButton({
  pin,
  socket,
  fromPodium,
  currentQuizId,
}: {
  pin: string;
  socket: GameSocket | null;
  fromPodium: boolean;
  currentQuizId: string | null;
}) {
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [quizId, setQuizId] = useState('');
  const [archive, setArchive] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = useMeControllerMe({ query: { staleTime: 60_000, retry: false } }).data?.data;
  const quizzes = useQuizzesControllerList({ query: { enabled: open } }).data?.data ?? [];
  const playable = quizzes.filter(
    (q) =>
      q.ownerId === me?.id &&
      q.status === 'ready' &&
      q.questionCount > 0 &&
      (fromPodium || q.id !== currentQuizId),
  );
  const picked = playable.some((q) => q.id === quizId) ? quizId : '';
  const label = fromPodium ? t('control.nextQuiz') : t('control.changeQuiz');

  const confirm = async () => {
    if (!socket || !picked) return;
    setSending(true);
    setError(null);
    try {
      await emitWithAckOrError(socket, 'host:next-quiz', {
        pin,
        quizId: picked,
        archive: fromPodium && archive,
      });
      setOpen(false);
      setQuizId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Tooltip label={fromPodium ? t('control.nextQuizTooltip') : t('control.changeQuizTooltip')}>
        <Button
          type="button"
          variant={fromPodium ? 'main-action' : 'outline'}
          onClick={() => setOpen(true)}
        >
          <ListPlus className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        title={label}
        description={
          fromPodium ? t('control.nextQuizDescription') : t('control.changeQuizDescription')
        }
        confirmLabel={sending ? t('common:loading') : t('control.openQuiz')}
        cancelLabel={t('common:cancel')}
        confirmDisabled={!picked || sending}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      >
        {playable.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('control.noPlayableQuiz')}</p>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('control.pickQuiz')}</span>
            <Select
              value={picked}
              aria-label={t('control.pickQuiz')}
              onChange={(e) => setQuizId(e.target.value)}
            >
              <option value="" disabled>
                {t('control.pickQuizPlaceholder')}
              </option>
              {playable.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </Select>
          </label>
        )}
        {fromPodium ? (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('control.archiveLabel')}</span>
              <span className="text-muted-foreground block">{t('control.archiveHint')}</span>
            </span>
          </label>
        ) : null}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
