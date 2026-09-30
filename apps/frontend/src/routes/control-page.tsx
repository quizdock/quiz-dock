import { RoomSoundsButton } from '../game/game-sounds-panel';
import { appConfig } from '../config';
import { ImageChoiceGrid, optionLabel } from '../game/image-choice';
import { NextQuizButton, RoomStandingsPanel, roomLabel } from '../game/room-components';
import {
  AUDIO_TARGETS,
  type AudioTarget,
  type GameMode,
  type GameStep,
  type MediaReadinessPayload,
  type OutlineQuestion,
  type OutlineSlide,
  slideSoundMedia,
} from '@quiz-dock/contracts';
import { Link, useParams } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  LayoutTemplate,
  Loader2,
  Lock,
  LockOpen,
  Eye,
  ExternalLink,
  MonitorPlay,
  Pause,
  Pencil,
  Power,
  Play,
  Radio,
  Share2,
  SkipForward,
  Smartphone,
  UserCheck,
  VolumeX,
  Users,
  Wifi,
  Trash2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { PageTitle, SectionTitle } from '@/components/ui/page-title';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ReadinessMeter } from '../game/media/readiness-meter';
import { ConsoleTransport } from '../game/media/console-transport';
import { SlidePlaybackContext } from '../game/media/slide-media';
import { RoomVariables } from '../game/slide-variables';
import { anchorOf, followed } from '../game/media/followed';
import { serverNow } from '../game/clock';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getAuthMode } from '../auth/auth-context';
import { APP_NAME } from '../config';
import { Avatar } from '../game/avatar';
import {
  ConnectionLost,
  AnswerExplanation,
  LeaderboardList,
  OptionGrid,
  Podium,
  RevealAnswer,
  SlideView,
  timeTone,
} from '../game/live-components';
import { type QuestionClock, useQuestionClock } from '../game/use-countdown';
import { ChromiumNotice } from '@/components/chromium-notice';
import { QuestionMediaStage } from '../game/media/question-media-stage';
import { ParticipantPreview } from '../game/participant-preview';
import { joinBase, joinHostLabel, joinUrlFor } from '../game/join-url';
import { JoinAddressPicker } from '../game/join-address-picker';
import { type GameView, type RosterPlayer, useGameSession } from '../game/use-game-session';
import { ScreenSurface } from './screen-page';
import { PageLoading } from '@/components/ui/loading';
import { CheckboxField } from '@/components/ui/checkbox-field';

/** Boutons d'ajustement du chrono (§8) : retire/ajoute des secondes en direct. */
const CHRONO_STEPS = [-5, -1, 1, 5] as const;

/**
 * Console d'animation (hôte, §3). Tableau de bord de **contrôle** privé : récap du
 * quiz, déroulé des questions, rythme (manuel/auto), pause et ajustement du chrono.
 * Volontairement distinct du grand écran à vidéoprojeter (`/session/$pin/projection`) —
 * le QR d'invitation y reste discret (simple info), pour ne pas confondre les deux.
 */
/**
 * A console screen fills the viewport under the header (4rem) and the main
 * padding (2 × 1.5rem): its action bar (`mt-auto`, sticky) then sits at the
 * bottom of the screen whatever the height of the slide or question on screen.
 */
const CONSOLE_SECTION = 'flex min-h-[calc(100dvh-7rem)] flex-col py-6';

export function ControlPage() {
  const { pin } = useParams({ from: '/session/$pin/console' });
  const session = useGameSession(pin, 'host');
  return (
    <>
      <ConnectionLost lost={session.view.connectionLost} />
      {/* A hook for override.css, with the game's state (no box: the layout is the page's). */}
      <div className="qd-console contents" data-state={session.view.state ?? 'none'}>
        <HostConsole pin={pin} session={session} />
      </div>
    </>
  );
}

/** The console of the session the page follows, in each state of the game. */
function HostConsole({
  pin,
  session,
}: {
  pin: string;
  session: ReturnType<typeof useGameSession>;
}) {
  const { t } = useTranslation(['live', 'common']);
  // Same explanation as in the editor before switching full capture on (GDPR, archive size).
  const [confirmCapture, setConfirmCapture] = useState(false);
  const { view, socket } = session;
  const [shareNote, setShareNote] = useState<string | null>(null);

  const joinUrl = joinUrlFor(view, pin);
  const screenUrl = `${window.location.origin}/session/${pin}/projection`;
  const emit = (event: 'host:start' | 'host:reveal' | 'host:next') => socket?.emit(event, { pin });
  const [tab, setTab] = useState<HostTab>('control');
  // The right column's tab; null = the phase's default (players in the lobby, the outline after).
  const [side, setSide] = useState<SideTab | null>(null);
  // The step the game is live on, kept while the host looks back at another one.
  const liveStep = useRef<number | null>(null);
  // The Tab key cycles the three views (Shift+Tab backwards) from the page itself;
  // on a control, Tab keeps moving the focus, so the keyboard reaches every button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest(INTERACTIVE)) return;
      e.preventDefault();
      setTab((current) => {
        const i = HOST_TABS.indexOf(current);
        return HOST_TABS[(i + (e.shiftKey ? -1 : 1) + HOST_TABS.length) % HOST_TABS.length];
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Looking back over played steps (no replay): the server tells what is reachable.
  const review = (step: GameStep) => socket?.emit('host:review', { pin, ...step });
  const endGame = (archive: boolean) => socket?.emit('host:end', { pin, archive });
  const setMode = (mode: GameMode) => socket?.emit('host:mode', { pin, mode });
  const setCapture = (fullCapture: boolean) => socket?.emit('host:capture', { pin, fullCapture });
  const setJoinLocked = (locked: boolean) => socket?.emit('host:lock', { pin, locked });
  // Open access (#57): guests only — nothing personal to track, no account name.
  const openAccess = view.participantAccess === 'open';
  const setOptions = (opts: {
    personalTracking?: boolean;
    pickOwnName?: boolean;
    audioTarget?: AudioTarget;
  }) => socket?.emit('host:options', { pin, ...opts });
  // Le nom affiché ne peut venir d'un compte qu'en mode OIDC (RG-15).
  const authMode = getAuthMode();
  const banPlayer = (playerId: string, minutes: number) =>
    socket?.emit('host:ban', { pin, playerId, minutes });
  const setPaused = (paused: boolean) => socket?.emit('host:pause', { pin, paused });
  // The space bar pauses the game or resumes it, as its button does — once the quiz
  // runs, and never while the host types, holds a control or reads a dialog.
  const pauseToggle = useRef<(() => void) | null>(null);
  pauseToggle.current =
    view.state && !['LOBBY', 'PODIUM', 'ENDED'].includes(view.state)
      ? () => setPaused(!view.paused)
      : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest(INTERACTIVE)) return;
      if (!pauseToggle.current) return;
      e.preventDefault();
      pauseToggle.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The question's sound or video, steered from here while it runs.
  const steerable =
    view.state === 'ANSWERING' &&
    !!(
      view.question?.media?.audio ||
      (view.question?.media?.visual?.kind === 'video' &&
        view.question.media.visual.source === 'upload')
    );
  // The screens' clock: a listen-first question before its answers open (the point
  // cannot move), or the answers' time, stood still when paused.
  const clock = useQuestionClock(view);
  const listening = clock?.listening ?? false;
  const adjustTime = (deltaS: number) => socket?.emit('host:adjust-time', { pin, deltaS });

  const openScreen = () => window.open(screenUrl, '_blank', 'noopener,noreferrer');
  const screenButton = (
    <Tooltip label={t('control.screenButtonTooltip')}>
      <Button type="button" variant="outline" size="sm" onClick={openScreen}>
        <Eye className="size-4" />
        {t('control.screenButton')}
        {/* It opens in a new tab: said before the click. */}
        <ExternalLink className="text-muted-foreground size-3.5" aria-hidden />
      </Button>
    </Tooltip>
  );

  // The link itself, not a picture of the QR code: it opens in one tap wherever it lands.
  const onShare = async () => {
    const invitation = [
      t('control.shareText', { appName: APP_NAME }),
      t('control.sharePin', { pin }),
    ];
    const text = [...invitation, t('control.shareLink', { url: joinUrl })].join('\n');
    try {
      if (navigator.share) {
        // The share sheet appends the URL itself: the text does not repeat it.
        await navigator.share({
          title: t('control.shareTitle', { appName: APP_NAME }),
          text: invitation.join('\n'),
          url: joinUrl,
        });
      } else {
        await navigator.clipboard.writeText(text);
        setShareNote(t('control.shareCopied'));
      }
    } catch {
      /* partage annulé / non supporté */
    }
  };

  if (view.status === 'connecting') {
    return <PageLoading label={t('control.connecting')} />;
  }
  if (view.status === 'error') {
    return <SessionOver message={view.error ?? t('control.sessionUnavailable')} muted />;
  }
  if (view.state === 'HOST_DISCONNECTED') {
    return (
      <p className="text-muted-foreground py-16 text-center">{t('control.hostDisconnected')}</p>
    );
  }
  if (view.state === 'ENDED') {
    return <SessionOver message={t('control.sessionEnded')} />;
  }

  // ── The frame (UI system §2.1): the same in every phase ─────────────────────
  const state = view.state;
  const inLobby = state === 'LOBBY' || state === null;
  const reviewing = !!view.nav?.review;
  const steps = outlineSteps(view.outline, view.outlineSlides);
  const here = stepPosition(steps, view);
  // Where the game really is: while looking back, the view shows the step looked at.
  if (!reviewing && here !== null) liveStep.current = here;
  const live = reviewing ? liveStep.current : here;
  const phase: PhaseKey = reviewing
    ? 'review'
    : inLobby
      ? 'lobby'
      : state === 'MEDIA_LOADING'
        ? 'media'
        : state === 'SLIDE_SHOW'
          ? 'slide'
          : state === 'REVEAL'
            ? 'reveal'
            : state === 'LEADERBOARD'
              ? 'leaderboard'
              : state === 'PODIUM'
                ? 'podium'
                : 'question';
  const sideTab: SideTab = side ?? (phase === 'lobby' || phase === 'media' ? 'players' : 'outline');
  // Looking back is offered between questions only (the server refuses it otherwise).
  const canLookBack = ['slide', 'reveal', 'leaderboard', 'podium', 'review'].includes(phase);
  const pausable =
    (view.mode === 'auto' || state === 'ANSWERING') &&
    !['lobby', 'media', 'podium', 'review'].includes(phase);

  const invite = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Tooltip label={t('control.shareScreenTooltip')} side="bottom">
          <div className="rounded-md border bg-white p-2">
            <QRCodeSVG
              value={joinUrl}
              size={inLobby ? 132 : 96}
              aria-label={t('control.qrLabel')}
            />
          </div>
        </Tooltip>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t('control.invite')}</span>
          <span className="font-semibold">{joinHostLabel(view)}</span>
          <span
            className="font-mono text-3xl font-bold tracking-[0.2em]"
            aria-label={t('control.pinLabel')}
          >
            {pin}
          </span>
          <Tooltip label={t('control.shareTooltip')}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void onShare()}
            >
              <Share2 className="size-4" />
              {t('control.share')}
            </Button>
          </Tooltip>
        </div>
      </div>
      {shareNote ? <p className="text-muted-foreground text-sm">{shareNote}</p> : null}
      {/* Where the QR and the link point: a console opened on localhost must not invite to localhost. */}
      <JoinAddressPicker
        current={joinBase(view)}
        onChange={(baseUrl) => socket?.emit('host:join-url', { pin, baseUrl })}
      />
    </div>
  );

  // Row 1 — where I am, in what state, what I look at.
  const rowOne = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <RecapHeader
        view={view}
        onRename={inLobby ? (name) => socket?.emit('host:room-name', { pin, name }) : undefined}
      />
      <Popover
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t('control.invite')}
            className="bg-muted hover:bg-accent flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm"
          >
            <span className="font-mono font-semibold tracking-widest">{pin}</span>
            <ChevronDown className="size-3.5" />
          </button>
        )}
        className="w-80"
      >
        {invite}
      </Popover>
      <button
        type="button"
        onClick={() => setSide('players')}
        className="bg-muted hover:bg-accent flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm"
        aria-label={t('control.participantsTooltip')}
      >
        <Users className="size-4" />
        <span data-testid="player-count">{view.players.length}</span>
      </button>
      <span
        className={cn(
          'rounded-full px-2.5 py-1 text-xs font-semibold',
          reviewing ? 'bg-warning/25 text-warning-text' : 'bg-primary text-primary-foreground',
        )}
      >
        {t(`control.phase.${phase}`)}
      </span>
      <ViewSwitch tab={tab} onTab={setTab} />
    </div>
  );

  // Row 2 — what I set and how I stop.
  const rowTwo = (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip label={t('control.modeAutoTooltip')}>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={view.mode === 'auto'}
            onCheckedChange={(auto) => setMode(auto ? 'auto' : 'manual')}
            aria-label={t('control.modeAuto')}
          />
          {t('control.modeAuto')}
        </label>
      </Tooltip>
      <PauseButton paused={view.paused} disabled={!pausable} onToggle={setPaused} />
      <span aria-hidden className="bg-border mx-1 h-6 w-px" />
      <LockButton locked={view.joinLocked} onToggle={setJoinLocked} />
      <RoomSoundsButton
        sounds={view.sounds}
        onChange={(patch) => socket?.emit('host:sounds', { pin, ...patch })}
      />
      <MotionSwitch
        on={view.motion ?? appConfig.liveMotion !== false}
        onToggle={(on) => socket?.emit('host:motion', { pin, on })}
      />
      {screenButton}
      <span className="flex-1" />
      <span aria-hidden className="bg-border mx-1 h-6 w-px" />
      {inLobby ? (
        <NextQuizButton
          pin={pin}
          socket={socket}
          mode="lobby"
          currentQuizId={view.quizId}
          playedQuizIds={view.standings?.playedQuizIds}
        />
      ) : phase === 'podium' ? null : (
        <NextQuizButton
          pin={pin}
          socket={socket}
          mode="close"
          currentQuizId={view.quizId}
          playedQuizIds={view.standings?.playedQuizIds}
        />
      )}
      <EndGameButton
        label={inLobby ? t('control.stopSession') : t('control.endSession')}
        offerArchive={!inLobby}
        onConfirm={endGame}
      />
    </div>
  );

  // The right column: the whole quiz, or the players.
  const sideColumn = (
    <aside className="bg-card flex min-h-0 flex-col gap-2 rounded-xl border p-3 lg:max-h-[calc(100dvh-16rem)]">
      <div className="flex items-center gap-2">
        <div role="tablist" className="bg-muted flex rounded-md p-0.5 text-sm">
          {(['outline', 'players'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sideTab === id}
              onClick={() => setSide(id)}
              className={cn(
                'rounded px-2.5 py-1 font-medium',
                sideTab === id ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`control.sideTabs.${id}`)}
              <span className="text-muted-foreground ml-1 tabular-nums">
                {id === 'players' ? view.players.length : steps.length}
              </span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {sideTab === 'outline' && view.nav && canLookBack ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!view.nav.prev}
              aria-label={t('control.lookBackPrev')}
              title={t('control.lookBackPrev')}
              onClick={() => view.nav?.prev && review(view.nav.prev)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!view.nav.next}
              aria-label={t('control.lookBackNext')}
              title={t('control.lookBackNext')}
              onClick={() => view.nav?.next && review(view.nav.next)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {sideTab === 'outline' ? (
          <OutlineList
            steps={steps}
            live={live}
            looked={reviewing ? here : null}
            onPick={canLookBack ? (step) => review(step) : undefined}
          />
        ) : (
          <ParticipantsList
            layout="rows"
            players={view.players}
            readiness={view.readiness}
            onBan={banPlayer}
          />
        )}
      </div>
      {sideTab === 'outline' && canLookBack ? (
        <p className="text-muted-foreground text-xs">{t('control.playedHint')}</p>
      ) : null}
    </aside>
  );

  const next = steps[(live ?? -1) + 1];
  const nextLabel = !next
    ? t('control.showPodium')
    : next.kind === 'slide'
      ? t('control.showSlide')
      : t('control.showQuestion', { n: next.question.index + 1 });
  const autoStatus =
    view.mode === 'auto' && view.paused ? (
      <span className="text-muted-foreground text-sm">{t('control.autoPaused')}</span>
    ) : view.mode === 'auto' && view.autoNextAt ? (
      <AutoAdvanceCountdown deadline={view.autoNextAt} totalMs={view.autoNextMs ?? 0} />
    ) : null;
  const backToLive = (
    <Button type="button" size="lg" onClick={() => emit('host:next')}>
      <SkipForward className="size-4" />
      {t('control.backToLive')}
    </Button>
  );

  // ── The centre and the bottom bar, phase by phase ───────────────────────────
  let centre: React.ReactNode;
  let status: React.ReactNode;
  let primary: React.ReactNode;

  if (phase === 'lobby') {
    centre = (
      <>
        {invite}
        {view.standings ? <RoomStandingsPanel standings={view.standings} max={5} /> : null}
        <section className="flex flex-col gap-3">
          <div>
            <SectionTitle>{t('control.beforeStarting')}</SectionTitle>
            <p className="text-muted-foreground text-sm">{t('control.beforeStartingHint')}</p>
          </div>
          <ConfirmDialog
            open={confirmCapture}
            title={t('common:captureConfirm.title')}
            description={t('common:captureConfirm.description')}
            confirmLabel={t('common:captureConfirm.confirmLabel')}
            onCancel={() => setConfirmCapture(false)}
            onConfirm={() => {
              setConfirmCapture(false);
              setCapture(true);
            }}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <SettingSwitch
              checked={view.fullCapture}
              onChange={(checked) => (checked ? setConfirmCapture(true) : setCapture(false))}
              label={t('control.captureLabel')}
              hint={t('control.captureHint')}
            />
            <SettingSwitch
              checked={view.personalTracking}
              disabled={openAccess}
              onChange={(personalTracking) => setOptions({ personalTracking })}
              label={t('control.trackingLabel')}
              hint={openAccess ? t('control.trackingOpenAccessHint') : t('control.trackingHint')}
            />
            {/* Nom affiché (RG-15) : n'a de sens que si les participants ont un compte. */}
            {authMode === 'oidc' && !openAccess ? (
              <SettingSwitch
                checked={view.pickOwnName}
                onChange={(pickOwnName) => setOptions({ pickOwnName })}
                label={t('control.ownNameLabel')}
                hint={t('control.ownNameHint')}
              />
            ) : null}
            {/* Who hears the sound, for this game — only when the quiz has something to hear. */}
            {view.quizHasSound && view.gameAudioTarget ? (
              <label className="flex flex-col gap-2 rounded-lg border p-3 text-[1em]">
                <span className="font-medium">{t('control.audioTargetLabel')}</span>
                <Select
                  className="h-8 w-auto"
                  value={view.gameAudioTarget}
                  aria-label={t('control.audioTargetLabel')}
                  onChange={(e) => setOptions({ audioTarget: e.target.value as AudioTarget })}
                >
                  {AUDIO_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`control.audioTarget.${target}`)}
                    </option>
                  ))}
                </Select>
                <span className="text-muted-foreground">{t('control.audioTargetHint')}</span>
              </label>
            ) : null}
          </div>
          {/* How participants get in (#57), and the media sent ahead (media brief §5.3). */}
          {authMode === 'oidc' ? (
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              {openAccess ? (
                <LockOpen className="mt-0.5 size-4 shrink-0" />
              ) : (
                <UserCheck className="mt-0.5 size-4 shrink-0" />
              )}
              {openAccess ? t('control.accessOpen') : t('control.accessAccount')}
            </p>
          ) : null}
          {view.quizHasMedia ? (
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" />
              {t('control.preloadNotice')}
            </p>
          ) : null}
        </section>
      </>
    );
    status = <ReadinessLine readiness={view.readiness} fallbackCount={view.players.length} />;
    primary = (
      <Tooltip label={t('control.startTooltip')}>
        <Button
          type="button"
          variant="main-action"
          size="lg"
          disabled={view.players.length === 0}
          onClick={() => emit('host:start')}
        >
          <Play className="size-4" />
          {t('control.start')}
        </Button>
      </Tooltip>
    );
  } else if (phase === 'media') {
    const late = view.players.filter((p) =>
      view.readiness?.players.some((r) => r.playerId === p.playerId && !r.ready),
    );
    centre = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
        <p className="text-xl font-semibold">{t('control.mediaLoadingTitle')}</p>
        <ReadinessMeter readiness={view.readiness} until={view.mediaWait?.until ?? null} />
        {late.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('control.mediaLate', { names: late.map((p) => p.nickname).join(', ') })}
          </p>
        ) : null}
      </div>
    );
    status = <ReadinessLine readiness={view.readiness} />;
    primary = (
      <Button type="button" variant="main-action" size="lg" onClick={() => emit('host:next')}>
        <Play className="size-4" />
        {t('control.startAnyway')}
      </Button>
    );
  } else if (state === 'SLIDE_SHOW' && view.slide) {
    const slide = view.slide;
    const step = { questionIndex: slide.questionIndex, slideIndex: slide.slideIndex };
    // The slide's one sound (#125): the host steers it as a question's; a muted
    // video alone has nothing to steer, only its mute to say.
    const soundMedia = reviewing ? null : slideSoundMedia(slide);
    const mutedVideo = !!slide.video && !slide.video.sound;
    centre = (
      <>
        {reviewing ? <ReviewBanner step={t('control.stepSlide')} /> : null}
        {/* Reduced base: the slide is a preview in a card, not the projection. */}
        <div className="flex rounded-xl border p-5 text-[0.8rem] sm:p-6">
          <SlidePlaybackContext.Provider
            value={{
              mode: 'still',
              audible: false,
              startAt: null,
              anchor: null,
              resumeKey: null,
              follow: followed(view, step),
            }}
          >
            <RoomVariables view={view} pin={pin}>
              <SlideView key={slide.slideIndex} slide={slide} />
            </RoomVariables>
          </SlidePlaybackContext.Provider>
        </div>
        {soundMedia ? (
          <ConsoleTransport
            key={`s${slide.slideIndex}`}
            media={soundMedia}
            follow={followed(view, step)}
            anchor={anchorOf(view, step)}
            listening={false}
            gamePaused={view.paused}
            onCommand={(command) => socket?.emit('host:media', { pin, ...command })}
            onGamePause={setPaused}
          />
        ) : null}
        {mutedVideo && !slide.audio ? (
          <p className="text-muted-foreground flex items-center gap-2 self-center text-sm">
            <VolumeX className="size-4" />
            {t('control.slideVideoMuted')}
          </p>
        ) : null}
      </>
    );
    status = reviewing ? t('control.statusLookingBack') : autoStatus;
    primary = reviewing ? (
      backToLive
    ) : (
      <Button type="button" size="lg" onClick={() => emit('host:next')}>
        <SkipForward className="size-4" />
        {nextLabel}
      </Button>
    );
  } else if (phase === 'podium') {
    centre = (
      <div className="flex flex-col items-center gap-6">
        <SectionTitle className="text-2xl">{t('control.podium')}</SectionTitle>
        {view.podium ? <Podium rows={view.podium.podium} /> : null}
        {/* The quiz's podium first, then the room's (#89) once it has played more than one. */}
        {view.standings && view.standings.quizzesPlayed > 1 ? (
          <RoomStandingsPanel standings={view.standings} />
        ) : null}
      </div>
    );
    status = t('control.statusQuizOver');
    primary = (
      <NextQuizButton
        pin={pin}
        socket={socket}
        mode="podium"
        currentQuizId={view.quizId}
        playedQuizIds={view.standings?.playedQuizIds}
      />
    );
  } else if ((state === 'REVEAL' || state === 'LEADERBOARD') && view.question) {
    const question = view.question;
    const reveal = view.reveal;
    const correct = reveal?.correctOptionIds ?? [];
    const found = reveal ? correct.reduce((sum, id) => sum + (reveal.distribution[id] ?? 0), 0) : 0;
    const answeredTotal = reveal
      ? Object.values(reveal.distribution).reduce((a, b) => a + b, 0)
      : 0;
    centre = (
      <>
        {reviewing ? (
          <ReviewBanner step={t('control.stepQuestion', { n: question.questionIndex + 1 })} />
        ) : null}
        <Markdown role="heading" aria-level={2} className="text-2xl font-semibold">
          {question.prompt}
        </Markdown>
        {reveal && question.type === 'image_choice' ? (
          <ImageChoiceGrid
            options={question.options ?? []}
            correctIds={correct}
            counts={reveal.distribution}
            className="max-w-xl"
          />
        ) : reveal && question.options?.length && question.type !== 'ordering' ? (
          <OptionGrid
            options={question.options}
            correctIds={correct}
            counts={reveal.distribution}
          />
        ) : reveal ? (
          <RevealAnswer question={question} reveal={reveal} />
        ) : null}
        {reveal ? <AnswerExplanation reveal={reveal} /> : null}
        {view.leaderboard ? (
          <div className="flex flex-col gap-2">
            <SectionTitle>{t('control.leaderboard')}</SectionTitle>
            <LeaderboardList rows={view.leaderboard.top} max={5} track="console" />
          </div>
        ) : null}
      </>
    );
    status = reviewing
      ? t('control.statusLookingBack')
      : (autoStatus ??
        (correct.length && answeredTotal
          ? t('control.statusFound', { count: found, total: answeredTotal })
          : null));
    primary = reviewing ? (
      backToLive
    ) : (
      <Button type="button" size="lg" onClick={() => emit('host:next')}>
        <SkipForward className="size-4" />
        {nextLabel}
      </Button>
    );
  } else {
    // ── ANSWERING / QUESTION_SHOW ─────────────────────────────────────────────
    const answered = view.answerCount?.answered ?? 0;
    const totalPlayers = view.answerCount?.total ?? view.players.length;
    // Out of what is being counted, as on the screens: the listening, or the answers'
    // window as it is now (the host may have lengthened it).
    const timePct =
      clock && clock.totalS > 0 ? Math.min(1, clock.remaining / clock.totalS) * 100 : 0;
    const tone = timeTone(timePct / 100, view.paused);
    const answeredPct = totalPlayers > 0 ? (answered / totalPlayers) * 100 : 0;
    // The answer key, for the host only (the outline carries it; never sent to players).
    const correctIds = view.outline.find((q) => q.index === view.questionIndex)?.correctOptionIds;
    const key = (view.question?.options ?? []).filter((o) => correctIds?.includes(o.id));
    centre = (
      <article className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm font-medium">
            {t('control.questionProgress', {
              current: view.questionIndex + 1,
              total: view.totalQuestions,
            })}
          </span>
          <ChronoControls clock={clock} onAdjust={adjustTime} />
        </div>
        <ProgressBar pct={timePct} barClassName={tone} label={t('control.timeRemaining')} />
        {/* Shown still: the projection is the one place that plays the sound; its
            waveform follows where the projection is in it. While the question runs,
            the sound is the transport's to draw, with the host's hand on it. */}
        <QuestionMediaStage
          key={view.question?.questionIndex}
          media={
            steerable && view.question?.media
              ? { ...view.question.media, audio: null }
              : view.question?.media
          }
          mode="still"
          follow={
            view.question ? followed(view, { questionIndex: view.question.questionIndex }) : null
          }
          showHiddenWaveform
          boxClassName="h-56"
        />
        {steerable && view.question?.media ? (
          <ConsoleTransport
            key={view.question.questionIndex}
            media={view.question.media}
            follow={followed(view, { questionIndex: view.question.questionIndex })}
            anchor={anchorOf(view, { questionIndex: view.question.questionIndex })}
            listening={listening}
            gamePaused={view.paused}
            onCommand={(command) => socket?.emit('host:media', { pin, ...command })}
            onGamePause={setPaused}
          />
        ) : null}
        <Markdown
          role="heading"
          aria-level={2}
          className="max-w-prose text-2xl font-semibold sm:text-3xl"
        >
          {view.question?.prompt}
        </Markdown>
        {view.question?.type === 'image_choice' ? (
          <ImageChoiceGrid
            options={view.question.options ?? []}
            highlightIds={correctIds}
            className="max-w-xl"
          />
        ) : view.question?.options?.length ? (
          <OptionGrid options={view.question.options} highlightIds={correctIds} />
        ) : (
          <p className="text-muted-foreground text-sm">{t('control.freeAnswer')}</p>
        )}
        {key.length ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{t('control.answerKey')}</span>{' '}
            <span className="text-success font-semibold">
              {key.map((o) => optionLabel(o)).join(' · ')}
            </span>
          </p>
        ) : null}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{t('control.answersReceived')}</span>
          <div className="flex-1">
            <ProgressBar pct={answeredPct} barClassName="bg-primary" />
          </div>
          <span className="font-semibold tabular-nums">
            {answered} / {totalPlayers}
          </span>
        </div>
      </article>
    );
    status = [
      t('control.statusAnswered', { answered, total: totalPlayers }),
      clock ? t('control.statusTimeLeft', { seconds: clock.remaining }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    primary = (
      <Button type="button" size="lg" onClick={() => emit('host:reveal')}>
        <Eye className="size-4" />
        {t('control.revealNow')}
      </Button>
    );
  }

  return (
    <section className={cn(CONSOLE_SECTION, 'gap-4')}>
      <header className="flex flex-col gap-3 border-b pb-3">
        {rowOne}
        {rowTwo}
        <ChromiumNotice />
      </header>
      {tab !== 'control' ? (
        tab === 'screen' ? (
          <div className="overflow-hidden rounded-xl border">
            {/* The console's own session: a second one would re-join the room on the host's socket. */}
            <ScreenSurface pin={pin} view={view} socket={socket} role="preview" />
          </div>
        ) : (
          <ParticipantPreview view={view} pin={pin} />
        )
      ) : (
        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-5">{centre}</div>
          {sideColumn}
        </div>
      )}
      <ActionBar status={status} primary={primary} />
    </section>
  );
}

/**
 * The console's action bar, the same on every screen so the hands never search:
 * on the left what decides when to move on, on the right the one primary action.
 * Nothing else sits next to it (UI system §2.1).
 */
function ActionBar({ status, primary }: { status?: React.ReactNode; primary?: React.ReactNode }) {
  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-6 mt-auto flex flex-wrap items-center gap-3 border-t px-6 py-3 backdrop-blur lg:-mx-10 lg:px-10">
      <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-3 text-sm">
        {status}
      </div>
      {primary}
    </div>
  );
}

/** The console's phases, as the frame names them (UI system §2.1). */
type PhaseKey =
  | 'lobby'
  | 'media'
  | 'slide'
  | 'question'
  | 'reveal'
  | 'leaderboard'
  | 'review'
  | 'podium';
type SideTab = 'outline' | 'players';

/** A step of the quiz, as the outline lists it: slides among the questions. */
type OutlineStep =
  | { kind: 'slide'; slide: OutlineSlide }
  | { kind: 'question'; question: OutlineQuestion };

/** Every step in playing order: each question preceded by the slides placed before it. */
function outlineSteps(questions: OutlineQuestion[], slides: OutlineSlide[]): OutlineStep[] {
  const steps: OutlineStep[] = [];
  for (let qi = 0; qi <= questions.length; qi++) {
    for (const slide of slides.filter((s) => s.beforeQuestionIndex === qi)) {
      steps.push({ kind: 'slide', slide });
    }
    if (qi < questions.length) steps.push({ kind: 'question', question: questions[qi] });
  }
  return steps;
}

/** Where the view stands in the steps: -1 before the first, the count after the last. */
function stepPosition(steps: OutlineStep[], view: GameView): number | null {
  if (view.state === 'LOBBY' || view.state === null) return -1;
  if (view.state === 'PODIUM') return steps.length;
  if (view.state === 'SLIDE_SHOW' && view.slide) {
    const i = steps.findIndex(
      (s) => s.kind === 'slide' && s.slide.slideIndex === view.slide!.slideIndex,
    );
    return i >= 0 ? i : null;
  }
  const i = steps.findIndex(
    (s) => s.kind === 'question' && s.question.index === view.questionIndex,
  );
  return i >= 0 ? i : null;
}

/** The outline as a column: every step, its type and duration; played steps open again. */
function OutlineList({
  steps,
  live,
  looked,
  onPick,
}: {
  steps: OutlineStep[];
  live: number | null;
  looked: number | null;
  onPick?: (step: GameStep) => void;
}) {
  const { t } = useTranslation('live');
  if (steps.length === 0) return null;
  return (
    <ol className="flex flex-col gap-0.5">
      {steps.map((s, i) => {
        const lookedAt = i === looked;
        // The live step stays marked while the host looks back at another one.
        const current = i === live && !lookedAt;
        const played = live !== null && i < live;
        const target: GameStep =
          s.kind === 'slide'
            ? { questionIndex: s.slide.beforeQuestionIndex, slideIndex: s.slide.slideIndex }
            : { questionIndex: s.question.index };
        const clickable = Boolean(onPick) && played && !lookedAt;
        const label =
          s.kind === 'slide' ? s.slide.title || t('control.stepSlide') : s.question.prompt;
        const meta =
          s.kind === 'slide'
            ? `${t('control.stepSlide')} · ${
                s.slide.displayDelayS === null
                  ? t('control.slideAuto', { seconds: 5 })
                  : s.slide.displayDelayS === 0
                    ? t('control.slideManual')
                    : t('control.slideAuto', { seconds: s.slide.displayDelayS })
              }`
            : `${t(`control.types.${s.question.type}`, { defaultValue: s.question.type })} · ${s.question.timeLimitS} s`;
        const body = (
          <>
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center text-xs font-bold',
                s.kind === 'slide' ? 'text-primary bg-primary/10 rounded' : 'bg-muted rounded-full',
                current && s.kind === 'question' && 'bg-primary text-primary-foreground',
              )}
            >
              {s.kind === 'slide' ? <LayoutTemplate className="size-3.5" /> : s.question.index + 1}
            </span>
            <span className={cn('min-w-0 flex-1', played && !lookedAt && 'text-muted-foreground')}>
              <Markdown
                profile="inline"
                className={cn('block truncate', (current || lookedAt) && 'font-semibold')}
              >
                {label}
              </Markdown>
              <span className="text-muted-foreground block text-xs">{meta}</span>
            </span>
            {lookedAt ? (
              <Eye
                className="text-warning-text size-4 shrink-0"
                aria-label={t('control.phase.review')}
              />
            ) : current ? (
              <Radio
                className="text-primary size-4 shrink-0"
                aria-label={t('control.questionCurrent')}
              />
            ) : played ? (
              <Check
                className="text-muted-foreground size-4 shrink-0"
                aria-label={t('control.questionDone')}
              />
            ) : null}
          </>
        );
        const row = cn(
          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm',
          current && 'bg-primary/10',
          lookedAt && 'bg-warning/20',
        );
        return (
          <li
            key={s.kind === 'slide' ? `s${s.slide.slideIndex}` : `q${s.question.index}`}
            aria-current={current ? 'step' : undefined}
          >
            {clickable ? (
              <button
                type="button"
                title={t('control.reviewHint')}
                onClick={() => onPick?.(target)}
                className={cn(row, 'hover:bg-accent cursor-pointer')}
              >
                {body}
              </button>
            ) : (
              <div className={row}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Said in the centre while the host looks back: everyone sees it, nothing is replayed. */
function ReviewBanner({ step }: { step: string }) {
  const { t } = useTranslation('live');
  return (
    <Notice
      role="status"
      icon={<Eye aria-hidden className="text-warning-text mt-0.5 size-4 shrink-0" />}
    >
      <b>{t('control.reviewBannerTitle', { step })}</b> {t('control.reviewBannerText')}
    </Notice>
  );
}

/** A setting of the lobby: a switch, its name and what it does. */
function SettingSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-sm',
        disabled && 'opacity-60',
      )}
    >
      <Switch
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground block">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Compte à rebours d'enchaînement automatique (mode auto, §8) : « suivante dans N s »
 * + barre qui se vide. Tic local 100 ms pour une barre fluide, borné sur la deadline
 * serveur autoritaire.
 */
function AutoAdvanceCountdown({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const { t } = useTranslation('live');
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, deadline - now);
  const pct = totalMs > 0 ? (remainingMs / totalMs) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-sm">
        {t('control.autoNextIn')}{' '}
        <span className="tabular-nums">{Math.ceil(remainingMs / 1000)}</span> {t('control.seconds')}
      </span>
      <ProgressBar pct={pct} barClassName="bg-primary" />
    </div>
  );
}

/** Barre de progression générique (piste neutre + remplissage coloré animé). */
/** Where the console has nothing left to run: why, and the way back to the quizzes. */
function SessionOver({ message, muted = false }: { message: string; muted?: boolean }) {
  const { t } = useTranslation('live');
  return (
    <section className="flex flex-col items-center gap-4 py-16 text-center">
      <p className={muted ? 'text-muted-foreground' : 'text-xl font-semibold'}>{message}</p>
      <Link to="/quizzes" className="underline">
        {t('control.backToQuizzes')}
      </Link>
    </section>
  );
}

function ProgressBar({
  pct,
  barClassName,
  label,
}: {
  pct: number;
  barClassName?: string;
  label?: string;
}) {
  return (
    <div
      className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', barClassName)}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/**
 * The room's name (renamed from its lobby, `onRename`) and the quiz played in it,
 * on one line of the console's first row.
 */
function RecapHeader({ view, onRename }: { view: GameView; onRename?: (name: string) => void }) {
  const { t } = useTranslation('live');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const label = roomLabel(t, view.roomName, view.hostName);
  const fallback = roomLabel(t, null, view.hostName);
  const save = () => {
    setEditing(false);
    if (draft.trim() !== (view.roomName ?? '')) onRename?.(draft);
  };
  const steps = view.outline.length;
  return (
    <div className="flex min-w-0 flex-col">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            value={draft}
            maxLength={60}
            placeholder={fallback}
            aria-label={t('control.roomNameLabel')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-8 max-w-xs text-lg font-bold"
          />
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <PageTitle className="truncate text-xl">{label}</PageTitle>
          {onRename ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('control.renameRoom')}
              title={t('control.renameRoom')}
              onClick={() => {
                setDraft(view.roomName ?? '');
                setEditing(true);
              }}
            >
              <Pencil className="size-4" />
            </Button>
          ) : null}
        </div>
      )}
      {view.quizTitle ? (
        <span className="text-muted-foreground truncate text-sm">
          {view.quizTitle}
          {steps > 0 ? ` · ${t('control.outlineQuestionCount', { count: steps })}` : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Fin de partie (§7) : action **destructive** — gardée par une infobulle d'avertissement
 * et une modale de confirmation. À la confirmation, la partie est détruite (PIN invalidé,
 * joueurs déconnectés). Les résultats ne sont pas conservés (archivage à venir, cf. §2.x).
 */
/** Liste des participants avec action de bannissement (lobby + console en jeu). */
/**
 * How far the devices waited for have loaded the next question's sound or
 * video: a count, and the projection's own state (the one that must be ready).
 */
function ReadinessLine({
  readiness,
  fallbackCount,
}: {
  readiness: MediaReadinessPayload | null;
  /** Said when nothing is waited for: how many are in. */
  fallbackCount?: number;
}) {
  const { t } = useTranslation('live');
  if (!readiness || readiness.total === 0) {
    return fallbackCount !== undefined ? (
      <span>
        {fallbackCount} {t('control.participantsConnected', { count: fallbackCount })}
      </span>
    ) : null;
  }
  const { screens } = readiness;
  // The lobby (#104): one count, the participants; the projection only when it loads something.
  if (readiness.lobby) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="readiness">
        {t('control.readyCount', { ready: readiness.ready, count: readiness.total })}
        {screens.total > 0
          ? ` · ${
              screens.ready === screens.total
                ? t('control.readinessProjectionReady')
                : t('control.readinessProjectionLoading')
            }`
          : null}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-sm" data-testid="readiness">
      {t('control.readiness', { ready: readiness.ready, total: readiness.total })}
      {' · '}
      {screens.total === 0
        ? t('control.readinessNoProjection')
        : screens.ready === screens.total
          ? t('control.readinessProjectionReady')
          : t('control.readinessProjectionLoading')}
    </p>
  );
}

function ParticipantsList({
  players,
  readiness = null,
  onBan,
  layout = 'chips',
}: {
  /** `rows`: one player per line (the console's column); `chips`: wrapped pills. */
  layout?: 'chips' | 'rows';
  players: RosterPlayer[];
  /** Marks the participants whose device is waited for: loaded, or still loading. */
  readiness?: MediaReadinessPayload | null;
  onBan: (playerId: string, minutes: number) => void;
}) {
  const waited = new Map(readiness?.players.map((p) => [p.playerId, p.ready]));
  // The lobby (#104): who said they are ready; a spinner while their media still load.
  const said = new Map(
    readiness?.lobby ? readiness.players.map((p) => [p.playerId, p.pressed]) : [],
  );
  const { t } = useTranslation('live');
  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('control.noParticipants')}</p>;
  }
  return (
    <ul className={cn('flex gap-2', layout === 'rows' ? 'flex-col gap-0.5' : 'flex-wrap')}>
      {players.map((p) => (
        <li
          key={p.playerId}
          className={cn(
            'flex items-center gap-1.5 text-sm',
            layout === 'rows'
              ? 'hover:bg-accent/50 rounded-md px-1.5 py-1'
              : 'rounded-full border py-0.5 pl-1 pr-1',
          )}
        >
          <Avatar name={p.avatar || p.nickname} size={24} />
          <span className={cn('truncate', layout === 'rows' ? 'flex-1' : 'max-w-[8rem]')}>
            {p.nickname}
          </span>
          {readiness?.lobby ? (
            waited.get(p.playerId) ? (
              <Check className="size-3.5 text-success" aria-label={t('control.participantReady')} />
            ) : said.get(p.playerId) ? (
              <Loader2
                className="text-muted-foreground size-3.5 animate-spin"
                aria-label={t('control.participantLoading')}
              />
            ) : null
          ) : waited.has(p.playerId) ? (
            waited.get(p.playerId) ? (
              <Check className="size-3.5 text-success" aria-label={t('control.mediaReady')} />
            ) : (
              <Loader2
                className="text-muted-foreground size-3.5 animate-spin"
                aria-label={t('control.mediaLoading')}
              />
            )
          ) : null}
          {p.presence === 'remote' ? (
            <Tooltip label={t('control.remote')}>
              <Wifi className="text-muted-foreground size-3.5" aria-label={t('control.remote')} />
            </Tooltip>
          ) : null}
          <BanButton nickname={p.nickname} onBan={(m) => onBan(p.playerId, m)} />
        </li>
      ))}
    </ul>
  );
}

/** Bouton + `<dialog>` de confirmation pour bannir un joueur (durée en minutes, RG-12). */
function BanButton({ nickname, onBan }: { nickname: string; onBan: (minutes: number) => void }) {
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  return (
    <>
      <Tooltip label={t('control.banTooltip', { nickname })}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('control.banAria', { nickname })}
          onClick={() => setOpen(true)}
          className="size-6 rounded-full"
        >
          <Trash2 className="text-destructive size-3.5" />
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={t('control.banConfirmTitle', { nickname })}
        description={t('control.banConfirmDescription')}
        confirmLabel={t('control.banConfirm')}
        cancelLabel={t('common:cancel')}
        onConfirm={() => {
          setOpen(false);
          onBan(minutes);
        }}
        onCancel={() => setOpen(false)}
      >
        <label className="flex items-center gap-2 text-[1em]">
          <span className="font-medium">{t('control.banDuration')}</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Math.min(1440, Math.max(1, Number(e.target.value) || 1)))}
            className="border-input w-20 rounded-md border px-2 py-1 text-[1em]"
          />
          <span className="text-muted-foreground">{t('control.banMinutes')}</span>
        </label>
      </ConfirmDialog>
    </>
  );
}

function EndGameButton({
  label,
  offerArchive,
  onConfirm,
}: {
  label: string;
  /** Propose d'archiver les résultats (pertinent dès qu'une partie a été jouée). */
  offerArchive?: boolean;
  onConfirm: (archive: boolean) => void;
}) {
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState(true);
  return (
    <>
      <Tooltip label={t('control.endTooltip')}>
        <Button type="button" variant="destructive-outline" size="sm" onClick={() => setOpen(true)}>
          <Power className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={t('control.endConfirmTitle', { label })}
        description={t('control.endConfirmDescription')}
        confirmLabel={label}
        cancelLabel={t('common:cancel')}
        onConfirm={() => {
          setOpen(false);
          onConfirm(offerArchive ? archive : false);
        }}
        onCancel={() => setOpen(false)}
      >
        {offerArchive ? (
          <CheckboxField
            className="rounded-md border p-3"
            checked={archive}
            onChange={setArchive}
            label={t('control.archiveLabel')}
            hint={t('control.archiveHint')}
          />
        ) : null}
      </ConfirmDialog>
    </>
  );
}

/** Pause/reprise de l'auto-progression (must-have en mode auto, §8). */
function PauseButton({
  paused,
  disabled,
  onToggle,
}: {
  paused: boolean;
  /** Nothing to hold right now: the button stays, greyed with its reason (UI system §1.1). */
  disabled?: boolean;
  onToggle: (paused: boolean) => void;
}) {
  const { t } = useTranslation('live');
  return (
    <Button
      type="button"
      variant={paused ? 'main-action' : 'outline'}
      size="sm"
      aria-pressed={paused}
      disabled={disabled}
      title={disabled ? t('control.pauseNothing') : undefined}
      onClick={() => onToggle(!paused)}
    >
      {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      {paused ? t('control.resume') : t('control.pause')}
      <kbd className="text-muted-foreground rounded border px-1 text-[0.65rem] font-normal">
        {t('control.spaceKey')}
      </kbd>
    </Button>
  );
}

/** Closes the game to new participants, or reopens it — same switch as the lobby's. */
function LockButton({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: (locked: boolean) => void;
}) {
  const { t } = useTranslation('live');
  return (
    <Tooltip label={locked ? t('control.unlockTooltip') : t('control.lockTooltip')}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={locked}
        aria-label={t('control.lockLabel')}
        onClick={() => onToggle(!locked)}
      >
        {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
        {locked ? t('control.locked') : t('control.lock')}
      </Button>
    </Tooltip>
  );
}

/**
 * Whether the room's screens move between steps (UI system §1.8): the host sees
 * what the projector copes with, and switches it for every screen at once — a
 * switch, like Autoplay, so on and off read apart.
 */
function MotionSwitch({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  const { t } = useTranslation('live');
  return (
    <Tooltip label={on ? t('control.motionOnTooltip') : t('control.motionOffTooltip')}>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch checked={on} onCheckedChange={onToggle} aria-label={t('control.motion')} />
        {t('control.motion')}
      </label>
    </Tooltip>
  );
}

/** Ajustement du chrono en direct : [-5 -1 ⏱ +1 +5] (§8). */
function ChronoControls({
  clock,
  onAdjust,
}: {
  clock: QuestionClock | null;
  onAdjust: (deltaS: number) => void;
}) {
  const { t } = useTranslation('live');
  return (
    <div className="qd-chrono flex items-center gap-1.5">
      {CHRONO_STEPS.filter((s) => s < 0).map((s) => (
        <Button key={s} type="button" variant="outline" size="sm" onClick={() => onAdjust(s)}>
          {s}
        </Button>
      ))}
      <span
        className={cn(
          'min-w-14 text-center text-2xl font-bold tabular-nums',
          clock?.paused && 'opacity-60',
        )}
        aria-label={clock?.listening ? t('screen.listening') : t('control.timeRemaining')}
      >
        {clock?.listening ? '🎧' : clock?.paused ? '⏸' : '⏱'} {clock?.remaining ?? '—'}
      </span>
      {CHRONO_STEPS.filter((s) => s > 0).map((s) => (
        <Button key={s} type="button" variant="outline" size="sm" onClick={() => onAdjust(s)}>
          +{s}
        </Button>
      ))}
    </div>
  );
}

type HostTab = 'control' | 'screen' | 'player';
const HOST_TABS: HostTab[] = ['control', 'screen', 'player'];

/** Where a key belongs to the element that has the focus, not to the console's shortcuts. */
const INTERACTIVE =
  'input, textarea, select, button, a, [role="tab"], [role="slider"], [role="switch"], [contenteditable="true"], dialog';

/** The three views of the session, a switch of the first row (the Tab key cycles them). */
function ViewSwitch({ tab, onTab }: { tab: HostTab; onTab: (t: HostTab) => void }) {
  const { t } = useTranslation('live');
  const tabs: { id: HostTab; label: string; icon: React.ReactNode }[] = [
    { id: 'control', label: t('control.tabs.control'), icon: <MonitorPlay className="size-4" /> },
    { id: 'screen', label: t('control.tabs.screen'), icon: <Eye className="size-4" /> },
    { id: 'player', label: t('control.tabs.player'), icon: <Smartphone className="size-4" /> },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('control.viewSwitch')}
      className="bg-muted ml-auto flex rounded-lg p-0.5 text-sm"
    >
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={tab === x.id}
          onClick={() => onTab(x.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
            tab === x.id
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {x.icon}
          <span className="hidden sm:inline">{x.label}</span>
        </button>
      ))}
    </div>
  );
}
