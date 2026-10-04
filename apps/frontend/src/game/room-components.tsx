import type { RoomStandingsPayload } from '@quiz-dock/contracts';
import { CircleCheck, ListChecks, ListPlus, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TagFilter, tagsOf } from '@/components/tag-filter';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Combobox } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMeControllerMe } from '../api/generated/me/me';
import type { QuizDto } from '../api/generated/model';
import { useQuizzesControllerList } from '../api/generated/quizzes/quizzes';
import { type GameSocket, emitWithAckOrError } from './game-client';
import { LeaderboardList } from './live-components';
import { mediaUrl } from '@/lib/media-url';
import { CheckboxField } from '@/components/ui/checkbox-field';

/** Whole seconds left until `at` (ms epoch), ticking; 0 once it has passed. */
function useSecondsLeft(at: number): number {
  const left = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const id = setInterval(() => setSeconds(left()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `left` reads `at` only
  }, [at]);
  return seconds;
}

/**
 * The next quiz starts on its own (#198): the seconds left, and for the host a stop —
 * the quiz then waits for **Start**.
 */
export function LobbyCountdown({
  startAt,
  onStop,
  className,
}: {
  startAt: number;
  onStop?: () => void;
  className?: string;
}) {
  const { t } = useTranslation('live');
  const seconds = useSecondsLeft(startAt);
  return (
    <span className={cn('inline-flex items-center gap-2', className)} role="timer">
      <span className="tabular-nums">{t('room.startsIn', { count: seconds })}</span>
      {onStop ? (
        <Tooltip label={t('room.stopCountdown')}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('room.stopCountdown')}
            onClick={onStop}
            className="size-8"
          >
            <Square className="size-3.5" />
          </Button>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** The room's name as the screens show it: its own, else "<host>'s room". */
export function roomLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  name: string | null | undefined,
  hostName: string | null | undefined,
): string {
  if (name) return name;
  return hostName ? t('live:room.defaultName', { host: hostName }) : t('live:room.fallbackName');
}

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
      <LeaderboardList
        rows={standings.top}
        highlightRank={standings.you?.rank}
        max={max}
        track="room"
      />
    </div>
  );
}

/**
 * The quiz the room's lobby plays (`host:next-quiz`): picked there — a room goes back to
 * its lobby with none after a quiz — or replacing the one picked, nothing of it played.
 * Only the host's own quizzes that can be played — `ready`, with a question — are
 * offered: the server refuses the rest.
 */
export function QuizPickButton({
  pin,
  socket,
  currentQuizId,
  playedQuizIds = [],
}: {
  pin: string;
  socket: GameSocket | null;
  /** The quiz picked already, if any: it is then replaced. */
  currentQuizId: string | null;
  /** The quizzes the room already played to their end. */
  playedQuizIds?: string[];
}) {
  const replacing = Boolean(currentQuizId);
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [quizId, setQuizId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = useMeControllerMe({ query: { staleTime: 60_000, retry: false } }).data?.data;
  const quizzes = useQuizzesControllerList({ query: { enabled: open } }).data?.data ?? [];
  const playable = quizzes.filter(
    (q) =>
      q.ownerId === me?.id && q.status === 'ready' && q.questionCount > 0 && q.id !== currentQuizId,
  );
  const picked = playable.some((q) => q.id === quizId) ? quizId : '';
  const label = t(replacing ? 'control.changeQuiz' : 'control.chooseQuiz');

  const confirm = async () => {
    if (!socket || !picked) return;
    setSending(true);
    setError(null);
    try {
      await emitWithAckOrError(socket, 'host:next-quiz', { pin, quizId: picked });
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
      <Tooltip label={t(replacing ? 'control.changeQuizTooltip' : 'control.chooseQuizTooltip')}>
        <Button
          type="button"
          variant={replacing ? 'outline' : 'main-action'}
          onClick={() => setOpen(true)}
        >
          <ListPlus className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        wide
        title={label}
        description={t(
          replacing ? 'control.changeQuizDescription' : 'control.chooseQuizDescription',
        )}
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
          <QuizPicker
            quizzes={playable}
            value={picked}
            onChange={setQuizId}
            playingId={null}
            playedIds={playedQuizIds}
          />
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}

/**
 * Back to the room's lobby (`host:back-to-lobby`), where the next quiz is picked: from
 * the podium (its results kept or not, as when ending), or stopping the quiz in progress
 * (what was played so far kept or not — archived as interrupted, counted in the room's
 * standings).
 */
export function BackToLobbyButton({
  pin,
  socket,
  mode,
}: {
  pin: string;
  socket: GameSocket | null;
  mode: 'podium' | 'stop';
}) {
  const stop = mode === 'stop';
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t(stop ? 'control.closeQuiz' : 'control.backToLobby');

  const confirm = async () => {
    if (!socket) return;
    setSending(true);
    setError(null);
    try {
      await emitWithAckOrError(socket, 'host:back-to-lobby', { pin, archive });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Tooltip label={t(stop ? 'control.closeQuizTooltip' : 'control.backToLobbyTooltip')}>
        <Button
          type="button"
          variant={stop ? 'outline' : 'main-action'}
          onClick={() => setOpen(true)}
        >
          <ListPlus className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive={stop}
        title={label}
        description={t(stop ? 'control.closeQuizDescription' : 'control.backToLobbyDescription')}
        confirmLabel={sending ? t('common:loading') : label.replace(/…$/, '')}
        cancelLabel={t('common:cancel')}
        confirmDisabled={sending}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      >
        <CheckboxField
          className="rounded-md border p-3"
          checked={archive}
          onChange={setArchive}
          label={t(stop ? 'control.archiveSoFarLabel' : 'control.archiveLabel')}
          hint={t(stop ? 'control.archiveSoFarHint' : 'control.archiveHint')}
        />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}

type PickableQuiz = QuizDto;

/**
 * A light "My quizzes" to pick from: search (title, description, tags), the
 * tags and the language as filters, a sort, and a line per quiz that says what
 * it is — its cover, title, the start of its description, its size, language,
 * tags and last change. Built on the combobox, kept open.
 */
function QuizPicker({
  quizzes,
  value,
  onChange,
  playingId,
  playedIds,
}: {
  quizzes: PickableQuiz[];
  value: string;
  onChange: (id: string) => void;
  /** The quiz the room just played (it may be played again). */
  playingId: string | null;
  /** Every quiz the room played: marked, and a filter keeps them in or out. */
  playedIds: string[];
}) {
  const { t, i18n } = useTranslation(['live', 'dashboard']);
  const [tags, setTags] = useState<string[]>([]);
  const [played, setPlayed] = useState<'' | 'played' | 'fresh'>('');
  const wasPlayed = (q: PickableQuiz) => playedIds.includes(q.id);
  const anyPlayed = quizzes.some(wasPlayed);
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState<'recent' | 'title' | 'questions'>('recent');
  const allTags = tagsOf(quizzes);
  const languages = [...new Set(quizzes.map((q) => q.language))].sort();
  const kept = quizzes
    .filter((q) => tags.every((tag) => q.tags.includes(tag)))
    .filter((q) => !language || q.language === language)
    .filter((q) => !played || wasPlayed(q) === (played === 'played'))
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'questions'
          ? b.questionCount - a.questionCount
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-[1em]">
      <div className="flex flex-wrap items-end gap-2">
        <span className="mr-auto font-medium">{t('control.pickQuiz')}</span>
        {languages.length > 1 ? (
          <Select
            className="h-8 w-auto"
            value={language}
            aria-label={t('control.pickerLanguage')}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">{t('control.pickerAllLanguages')}</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </Select>
        ) : null}
        {anyPlayed ? (
          <Select
            className="h-8 w-auto"
            value={played}
            aria-label={t('control.pickerPlayed')}
            onChange={(e) => setPlayed(e.target.value as typeof played)}
          >
            <option value="">{t('control.pickerPlayedAll')}</option>
            <option value="fresh">{t('control.pickerPlayedFresh')}</option>
            <option value="played">{t('control.pickerPlayedDone')}</option>
          </Select>
        ) : null}
        <Select
          className="h-8 w-auto"
          value={sort}
          aria-label={t('dashboard:sortBy')}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="recent">{t('dashboard:sortRecent')}</option>
          <option value="title">{t('dashboard:sortTitle')}</option>
          <option value="questions">{t('dashboard:sortQuestions')}</option>
        </Select>
      </div>
      <TagFilter
        label={t('control.pickerTags')}
        tags={allTags}
        selected={tags}
        onChange={setTags}
      />
      <Combobox
        inline
        className="min-h-0 flex-1"
        aria-label={t('control.pickQuiz')}
        value={value}
        onChange={onChange}
        placeholder={t('control.pickQuizPlaceholder')}
        emptyText={t('control.noQuizMatch')}
        options={kept.map((q) => ({
          value: q.id,
          label: q.title,
          keywords: `${q.description ?? ''} ${q.tags.join(' ')}`,
          quiz: q,
        }))}
        renderOption={({ quiz: q }) => (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            {q.coverMediaId ? (
              <img
                src={mediaUrl(q.coverMediaId)}
                alt=""
                className="size-12 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md">
                <ListChecks className="size-5" aria-hidden />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{q.title}</span>
                {wasPlayed(q) || q.id === playingId ? (
                  <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                    <CircleCheck className="text-success size-3.5" aria-hidden />
                    {t(
                      q.id === playingId ? 'control.pickerJustPlayed' : 'control.pickerPlayedMark',
                    )}
                  </span>
                ) : null}
              </span>
              {q.description ? (
                <span className="text-muted-foreground truncate text-xs">{q.description}</span>
              ) : null}
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                <span>{t('control.quizQuestions', { count: q.questionCount })}</span>
                <span>· {q.language.toUpperCase()}</span>
                <span>· {t('control.pickerUpdated', { date: date(q.updatedAt) })}</span>
                {q.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="bg-muted rounded px-1">
                    {tag}
                  </span>
                ))}
                {q.tags.length > 3 ? <span>+{q.tags.length - 3}</span> : null}
              </span>
            </span>
          </span>
        )}
        footer={(shown) => (
          <p className="text-muted-foreground text-xs" role="status">
            {t('dashboard:matchCount', { count: shown })}
          </p>
        )}
      />
    </div>
  );
}
