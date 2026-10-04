import { LobbyCountdown, RoomStandingsPanel, roomLabel } from '../game/room-components';
import { useAudienceLanguage } from '../i18n/interface-language';
import { useWakeLock } from '@/lib/use-wake-lock';
import { LiveMotion } from '../game/motion/level';
import { Pulse } from '../game/motion/primitives';
import { BackdropFade, StepEnter } from '../game/motion/step-transition';
import { backdropOf, stepKeyOf } from '../game/motion/step';
import { useParams } from '@tanstack/react-router';
import { Loader2, Maximize, Minimize, Users } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFullscreen } from '@/lib/use-fullscreen';
import { hasGameSounds, useRoomMedia } from '../game/media/use-room-media';
import { Avatar } from '../game/avatar';
import {
  ConnectionLost,
  AnswerExplanation,
  AnswerRules,
  LeaderboardList,
  OptionGrid,
  QuestionClockBar,
  Podium,
  RevealAnswer,
  SlideView,
  TYPE_BASE,
} from '../game/live-components';
import { unlockAudio, useAudioUnlocked } from '../game/media/audio-unlock';
import { setDeviceMuted, useDeviceSound } from '../game/media/audio-mixer';
import { SoundButton } from '../game/media/sound-button';
import { QuestionMediaStage } from '../game/media/question-media-stage';
import { SlidePlaybackContext } from '../game/media/slide-media';
import { RoomVariables } from '../game/slide-variables';
import { ReadinessMeter } from '../game/media/readiness-meter';
import { anchorOf, followed } from '../game/media/followed';
import { SoundUnlockOverlay } from '../game/media/sound-unlock-overlay';
import { BACKDROP_EDGE, Surface } from '../game/surface';
import { ImageChoiceGrid } from '../game/image-choice';
import { useQuestionClock } from '../game/use-countdown';
import { joinHostLabel, joinUrlFor } from '../game/join-url';
import { type GameView, useGameSession } from '../game/use-game-session';
import type { GameSocket } from '../game/game-client';
import { playsSound } from '@quiz-dock/contracts';

/**
 * The states where the question is on screen, drawn on its background. Not the
 * wait for the next one, the podium or the end: those keep the page's colours.
 */
const QUESTION_STATES = new Set<string>(['QUESTION_SHOW', 'ANSWERING', 'REVEAL', 'LEADERBOARD']);

/**
 * Écran de jeu projeté (grand écran, §4). Socket **spectateur** en lecture seule :
 * aucune auth, le PIN suffit, jamais de bonne réponse avant le reveal (anti-triche §7).
 * Se reconnecte seul au rechargement (le PIN est dans l'URL). Plein écran pour la
 * vidéoprojection.
 */
/** The participants' names a lobby shows before it says how many more (the screen's room). */
const ROSTER_MAX = 18;

export function ScreenPage() {
  const { pin } = useParams({ from: '/session/$pin/projection' });
  return <ScreenView pin={pin} playMedia />;
}

/**
 * A participant's copy of the projection (#104), opened from the link they
 * shared: it follows the big screen; `?sound=1` (a remote participant) plays
 * the sound meant for remote devices, after this device's own unlocking click.
 */
export function FollowScreenPage() {
  const { pin } = useParams({ from: '/join/$pin/screen' });
  const sound = new URLSearchParams(window.location.search).get('sound') === '1';
  return <ScreenView pin={pin} follow={{ sound }} />;
}

/**
 * How a projected screen takes part:
 * - `lead` — the projection window: it plays the media and tells the room where
 *   it is in the sound;
 * - `preview` — the console's Projection tab: media shown still, or the room
 *   would hear everything twice;
 * - `follow` — a participant's copy (#104): it plays along with the projection's
 *   position, muted unless `sound`, never waited for and never a position source.
 */
export type ScreenRole = 'lead' | 'preview' | 'follow';

/**
 * The projected screen itself, also opened by a participant on a device of their
 * own (`follow`). The host console's Projection tab shows `ScreenSurface`
 * (`preview`) on the console's own session.
 */
export function ScreenView({
  pin,
  playMedia = false,
  follow,
}: {
  pin: string;
  playMedia?: boolean;
  /** A participant's copy (#104); `sound` when it plays the sound (a remote participant). */
  follow?: { sound: boolean };
}) {
  const session = useGameSession(pin, 'spectator', { follow: !!follow });
  // The audience's language (#209): the room's choice, else the quiz's.
  useAudienceLanguage(session.view.language);
  // A projector, or a participant's copy of it, never dims during the session.
  useWakeLock(session.view.status === 'ready' && session.view.state !== 'ENDED');
  return (
    <>
      <ConnectionLost lost={session.view.connectionLost} />
      <ScreenSurface
        pin={pin}
        view={session.view}
        socket={session.socket}
        role={follow ? 'follow' : playMedia ? 'lead' : 'preview'}
        sound={follow?.sound ?? true}
      />
    </>
  );
}

/**
 * The projected screen for a game view already followed — a projection's own,
 * or a participant's when they switch their phone to the screen (#104).
 */
export function ScreenSurface({
  pin,
  view,
  socket,
  role,
  sound = true,
  embedded = false,
  fit = 'window',
}: {
  pin: string;
  view: GameView;
  socket: GameSocket | null;
  role: ScreenRole;
  /** Whether a `follow` copy plays the sound (the others decide by their role). */
  sound?: boolean;
  /**
   * Shown inside a participant's page (their switch to the big screen): no fullscreen,
   * which would hide the way back to their answers.
   */
  embedded?: boolean;
  /**
   * `box`: drawn in its container (the 1280×720 stage of a preview), sized and typeset
   * by it rather than by the window; no fullscreen.
   */
  fit?: 'window' | 'box';
}) {
  const boxed = fit === 'box';
  const { t } = useTranslation('live');
  const playMedia = role === 'lead';
  // The projection tells the room where it is in the sound (the playheads elsewhere follow):
  // a question's, or the slide's on screen (#125).
  const onSlide = view.state === 'SLIDE_SHOW' && !!view.slide;
  const questionIndex = onSlide
    ? (view.slide?.questionIndex ?? -1)
    : (view.question?.questionIndex ?? -1);
  const slideIndex = onSlide ? view.slide?.slideIndex : undefined;
  const sayPosition = useCallback(
    (t: number, playing: boolean) =>
      socket?.emit('media:position', {
        pin,
        questionIndex,
        ...(slideIndex !== undefined ? { slideIndex } : {}),
        t,
        playing,
      }),
    [socket, pin, questionIndex, slideIndex],
  );
  const soundUnlocked = useAudioUnlocked();
  const deviceSound = useDeviceSound();
  // The game's sounds (#93): the projection, and a copy that plays the sound for a
  // remote participant when the room's sound reaches remote devices.
  const soundsOn = hasGameSounds(view.sounds);
  useRoomMedia(view, pin, socket, {
    sounds:
      role === 'lead' || (role === 'follow' && sound && view.gameAudioTarget !== 'projection'),
    // In the lobby and while the leaderboard is up, what comes next buffers here; the
    // console hears when the projection is ready to play it, not a copy.
    preload: role === 'preview' ? 'off' : playMedia ? 'ready' : 'fetch',
    // The projection's whole sound is the console's (#150): master mute and MEDIA bus.
    room: role === 'lead',
  });
  // The console mutes the room; a mute this window kept from before would be one the
  // host could not lift (the projection has no sound button of its own).
  useEffect(() => {
    if (role === 'lead' && deviceSound.muted) setDeviceMuted(false);
  }, [role, deviceSound.muted]);
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();
  const clock = useQuestionClock(view);

  const joinUrl = joinUrlFor(view, pin);
  const joinHost = joinHostLabel(view);

  // A copy that plays the sound keeps its own button; the projection's sound is the
  // console's (#150), so it has none.
  const soundButton = role === 'follow' && sound;

  const fullscreenBtn =
    supported && !embedded && !boxed ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('bg-background absolute top-4 right-4 z-40', BACKDROP_EDGE)}
        aria-label={isFullscreen ? t('screen.exitFullscreen') : t('screen.fullscreen')}
        onClick={() => {
          // The click that fills the screen also lets this window play sound.
          void unlockAudio();
          void toggle();
        }}
      >
        {isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
      </Button>
    ) : null;

  // ── The frame (UI system §2.2): top band · stage · bottom band, in every phase
  // but a slide, which is the author's own full-screen composition.
  const total = view.totalQuestions || view.outline.length;
  const qNumber = (view.question?.questionIndex ?? view.questionIndex) + 1;
  const reviewing = !!view.nav?.review;
  const where = (step: string) => (
    <div className="flex min-w-0 flex-col text-left leading-tight">
      <span className="font-semibold">{step}</span>
      {/* The room is the page's title: the heading a screen reader lands on. */}
      <div className="text-muted-foreground truncate text-[0.7em]">
        <h1 className="inline">{roomLabel(t, view.roomName, view.hostName)}</h1>
        {view.quizTitle ? ` · ${view.quizTitle}` : null}
      </div>
    </div>
  );
  // The way in for latecomers, while the room takes newcomers (the lobby shows it in full).
  const joinChip = view.joinLocked ? null : (
    <div className="qd-join flex items-center justify-end gap-[0.6em]">
      <div className="text-right leading-tight">
        <span className="text-muted-foreground block text-[0.7em]">
          {t('screen.joinAt')} {joinHost}
        </span>
        <span className="qd-join-pin font-mono text-[1.3em] font-bold tracking-[0.15em]">
          {pin}
        </span>
      </div>
      <div className="qd-join-qr rounded-md bg-white p-1 shadow">
        <QRCodeSVG value={joinUrl} size={56} aria-label={t('screen.qrLabel')} />
      </div>
    </div>
  );
  const band = (
    side: 'top' | 'bottom',
    left: React.ReactNode,
    centre: React.ReactNode,
    right: React.ReactNode,
    tone?: 'warning',
    // A centre that stretches (the clock) takes what its sides leave, the same gap on each.
    stretch?: boolean,
  ) => (
    <div
      className={cn(
        'qd-band grid w-full shrink-0 items-center px-[3.5em] py-[0.6em]',
        stretch
          ? 'grid-cols-[auto_minmax(0,1fr)_auto] gap-[3em]'
          : 'grid-cols-[1fr_minmax(0,1.5fr)_1fr] gap-[1em]',
        side === 'top' ? 'border-b' : 'border-t',
        tone === 'warning'
          ? 'bg-warning/25'
          : 'bg-background/85 on-backdrop:bg-card backdrop-blur [text-shadow:none]',
      )}
      data-band={side}
    >
      <div className="min-w-0">{left}</div>
      <div className="text-center">{centre}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
  const bigStatus = (text: React.ReactNode, small?: React.ReactNode, warn?: boolean) => (
    <span>
      <span className={cn('text-[1.4em] font-bold tabular-nums', warn && 'text-warning-text')}>
        {text}
      </span>
      {small ? <span className="text-muted-foreground ml-[0.8em]">{small}</span> : null}
    </span>
  );

  let top: React.ReactNode = null;
  let bottom: React.ReactNode = null;
  let stage: React.ReactNode;
  // A question's background owns the whole surface, bands included.
  let onBackground = false;
  // A question with a picture takes the air the bands and margins leave (its count goes up).
  let compact = false;

  if (view.status === 'error') {
    stage = <p className="text-muted-foreground">{view.error ?? t('screen.sessionUnavailable')}</p>;
  } else if (view.state === 'HOST_DISCONNECTED') {
    top = band('top', where(t('screen.stepQuestion', { n: qNumber, total })), null, joinChip);
    stage = (
      <div className="flex flex-col items-center gap-[0.8em] opacity-80">
        <Loader2 aria-hidden className="text-muted-foreground size-[2.5em] animate-spin" />
        <p className="text-[2em] font-bold">{t('screen.waitingHost')}</p>
        <p className="text-muted-foreground text-[1.2em]">{t('screen.waitingHostText')}</p>
      </div>
    );
    bottom = band('bottom', null, bigStatus(t('screen.waitingHost'), null, true), null);
  } else if (view.state === 'MEDIA_LOADING') {
    // A device that plays the coming question's sound or video is still loading it.
    top = band('top', where(t('screen.stepQuestion', { n: qNumber, total })), null, joinChip);
    stage = (
      <div className="flex w-full max-w-[40em] flex-col items-center gap-[1em]">
        <p className="text-[2.2em] font-bold">{t('screen.mediaComing', { n: qNumber })}</p>
        <ReadinessMeter
          readiness={view.readiness}
          until={view.mediaWait?.until ?? null}
          className="text-[1.25em]"
        />
      </div>
    );
    bottom = view.readiness
      ? band(
          'bottom',
          null,
          bigStatus(
            t('screen.devicesReady', { ready: view.readiness.ready, total: view.readiness.total }),
          ),
          null,
        )
      : null;
  } else if (view.state === 'ENDED') {
    // A room that played several quizzes closes on its own podium (#89).
    const series = view.standings && view.standings.quizzesPlayed > 1 ? view.standings : null;
    top = band('top', where(t('screen.phaseClosed')), null, null);
    stage = series ? (
      <div className="flex w-full max-w-[28em] flex-col items-center gap-[1.5em]">
        <h2 className="text-[2em] font-bold">{t('screen.roomPodium')}</h2>
        <p className="text-muted-foreground text-[1.25em]">
          {t('room.afterQuizzes', { count: series.quizzesPlayed })}
        </p>
        <Podium rows={series.top.slice(0, 3)} />
        <p className="text-[1.5em] font-semibold">{t('screen.thanks')}</p>
      </div>
    ) : (
      <p className="text-[2.4em] font-bold">{t('screen.thanks')}</p>
    );
  } else if (view.state === 'SLIDE_SHOW' && view.slide) {
    const slide = view.slide;
    const step = { questionIndex: slide.questionIndex, slideIndex: slide.slideIndex };
    // A copy hears the slide only when asked to, and when its sound reaches remote devices.
    const copyHears =
      role === 'follow' && sound && !!slide.audioTarget && playsSound(slide.audioTarget, 'remote');
    stage = (
      <div className={cn('flex w-full flex-1', boxed ? 'min-h-full' : 'min-h-dvh')}>
        {/* Its videos and sound play as a question's do (#125): here, on the common start. */}
        <SlidePlaybackContext.Provider
          value={{
            mode: role === 'preview' || reviewing ? 'still' : view.paused ? 'pause' : 'play',
            audible: role !== 'follow' || copyHears,
            startAt: slide.mediaStartAt ?? null,
            anchor: anchorOf(view, step),
            resumeKey: playMedia ? `${pin}:s${slide.slideIndex}` : null,
            follow: playMedia || copyHears ? undefined : followed(view, step),
            catchUp: role === 'follow' ? followed(view, step) : undefined,
            onPosition: playMedia ? sayPosition : undefined,
          }}
        >
          <RoomVariables view={view} pin={pin}>
            <SlideView key={slide.slideIndex} slide={slide} />
          </RoomVariables>
        </SlidePlaybackContext.Provider>
        {/* The one element of the frame a slide keeps: how to join (UI system §2.2). */}
        {view.joinLocked ? null : (
          <span
            className={cn(
              'qd-join absolute top-[1em] right-[4em] z-20 rounded-full bg-white px-[0.8em] py-[0.3em] text-[0.9em] text-neutral-900',
              BACKDROP_EDGE,
              'ring-1 ring-black/70 ring-offset-1 ring-offset-white/70',
            )}
          >
            {t('screen.joinChip')} · <b className="qd-join-pin font-mono tracking-[0.1em]">{pin}</b>
          </span>
        )}
      </div>
    );
  } else if (view.state === 'PODIUM' && view.podium) {
    top = band('top', where(t('screen.phasePodium')), null, null);
    stage = (
      <div className="flex w-full max-w-[32em] flex-col items-center gap-[1.5em]">
        <Podium rows={view.podium.podium} />
        {/* Then the room's standings (#89) once it has played more than one quiz. */}
        {view.standings && view.standings.quizzesPlayed > 1 ? (
          <RoomStandingsPanel standings={view.standings} className="text-[1.1em]" />
        ) : view.leaderboard && view.leaderboard.top.length > 3 ? (
          <div className="flex w-full flex-col gap-[0.5em]">
            <h3 className="text-muted-foreground text-[1.25em] font-semibold">
              {t('screen.overallRanking')}
            </h3>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
      </div>
    );
    // Small, but seen by the room: the attribution a CC-BY licence asks for.
    bottom = view.podium.credits?.length
      ? band(
          'bottom',
          null,
          <span className="text-muted-foreground text-[0.8em]">
            {t('screen.credits')} {view.podium.credits.join(' · ')}
          </span>,
          null,
        )
      : null;
  } else if (view.state === 'LEADERBOARD' && view.leaderboard && !reviewing) {
    // A real leaderboard moment: the top eight, large, bars as long as the scores — as
    // many as the 16:9 screen holds between its bands.
    onBackground = !!view.question?.background;
    top = band(
      'top',
      where(t('screen.stepAfter', { n: qNumber, total })),
      <span className="text-[1.3em] font-bold">{t('screen.leaderboard')}</span>,
      joinChip,
    );
    stage = (
      <div className="w-full max-w-[48em] text-[1.25em]">
        <LeaderboardList rows={view.leaderboard.top} max={8} />
      </div>
    );
    bottom =
      qNumber < total
        ? band('bottom', null, bigStatus(t('screen.nextStep', { n: qNumber + 1 })), null)
        : null;
  } else if ((view.state === 'REVEAL' || view.state === 'LEADERBOARD') && view.question) {
    onBackground = !!view.question.background;
    const question = view.question;
    const reveal = view.reveal;
    const correct = reveal?.correctOptionIds ?? [];
    const found = reveal ? correct.reduce((sum, id) => sum + (reveal.distribution[id] ?? 0), 0) : 0;
    const answeredTotal = reveal
      ? Object.values(reveal.distribution).reduce((a, b) => a + b, 0)
      : 0;
    top = band(
      'top',
      where(t('screen.stepQuestion', { n: qNumber, total })),
      reviewing ? (
        <span className="text-[1.2em] font-bold">{t('screen.lookingBackAt', { n: qNumber })}</span>
      ) : (
        <span className="text-muted-foreground">{t('screen.answerLabel')}</span>
      ),
      joinChip,
      reviewing ? 'warning' : undefined,
    );
    stage = (
      <div className="flex min-h-0 w-full max-w-[72em] flex-1 flex-col items-center justify-center gap-[1em]">
        <Markdown
          role="heading"
          aria-level={1}
          className="qd-prompt shrink-0 text-center text-[2em] font-semibold"
        >
          {question.prompt}
        </Markdown>
        {reveal && question.type === 'image_choice' ? (
          // The pictures stay where they were, each with its count.
          <ImageChoiceGrid
            fit="screen"
            className="flex-1"
            options={question.options ?? []}
            correctIds={correct}
            counts={reveal.distribution}
          />
        ) : reveal && question.options?.length && question.type !== 'ordering' ? (
          // The tiles stay where they were, filled in proportion to their answers.
          <div className="w-full text-[1.2em]">
            <OptionGrid
              options={question.options}
              correctIds={correct}
              counts={reveal.distribution}
            />
          </div>
        ) : reveal ? (
          <RevealAnswer question={question} reveal={reveal} />
        ) : null}
        {reveal ? <AnswerExplanation reveal={reveal} className="max-w-[48em]" /> : null}
      </div>
    );
    bottom =
      correct.length && answeredTotal
        ? band(
            'bottom',
            null,
            bigStatus(
              t('screen.found', { count: found, total: answeredTotal }),
              reviewing ? t('screen.gameGoesOn') : null,
            ),
            null,
          )
        : null;
  } else if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && view.question) {
    onBackground = !!view.question.background;
    const visual = !!view.question.media?.visual;
    // A copy hears the question only when asked to (a remote participant) and when
    // its sound is meant for remote devices.
    const copyHears =
      role === 'follow' &&
      sound &&
      !!view.question.audioTarget &&
      playsSound(view.question.audioTarget, 'remote');
    const images = view.question.type === 'image_choice';
    compact = visual;
    const position = (visual && view.question.media?.position) || 'bottom';
    const side = position === 'left' || position === 'right';
    // With a picture, the count joins the clock in the top band: the bottom one's room is the picture's.
    const count =
      visual && view.answerCount && view.state === 'ANSWERING' && !view.paused ? (
        <span className="qd-answered flex flex-col items-center leading-none">
          <b className="text-[1.3em] tabular-nums">
            {view.answerCount.answered} / {view.answerCount.total}
          </b>
          <span className="text-muted-foreground text-[0.65em]">{t('screen.answeredShort')}</span>
        </span>
      ) : null;
    top = band(
      'top',
      where(t('screen.stepQuestion', { n: qNumber, total })),
      clock || count ? (
        <div className="flex items-center justify-center gap-[3em]">
          {clock ? (
            <QuestionClockBar clock={clock} className="min-w-0 flex-1 text-[1.3em]" />
          ) : null}
          {count}
        </div>
      ) : null,
      joinChip,
      undefined,
      !!clock,
    );
    const media = (
      <QuestionMediaStage
        key={view.question.questionIndex}
        media={view.question.media}
        mode={role === 'preview' || reviewing ? 'still' : view.paused ? 'pause' : 'play'}
        // A copy plays the sound only when asked (a remote participant), and only
        // when the question's sound is for remote devices.
        audible={role !== 'follow' || copyHears}
        className={!visual ? 'shrink-0' : side ? 'h-full min-h-0' : 'min-h-[6em] flex-1'}
        boxClassName={visual ? 'aspect-auto h-full min-h-0 w-full flex-1' : undefined}
        resumeKey={playMedia ? `${pin}:${view.question.questionIndex}` : null}
        // The projection plays on its own; the console's tab draws its position; a copy
        // that plays the sound starts on the common instant and catches up with it,
        // as a remote participant's phone does.
        follow={
          playMedia || copyHears
            ? undefined
            : followed(view, { questionIndex: view.question.questionIndex })
        }
        catchUp={
          role === 'follow'
            ? followed(view, { questionIndex: view.question.questionIndex })
            : undefined
        }
        onPosition={playMedia ? sayPosition : undefined}
        startAt={view.question.mediaStartAt ?? null}
        anchor={anchorOf(view, { questionIndex: view.question.questionIndex })}
      />
    );
    // The text: the prompt, then how to answer. Beside a picture it reads from the left.
    const words = (
      <div className={cn('flex shrink-0 flex-col gap-[0.4em]', side ? 'text-left' : 'w-full')}>
        <Markdown
          role="heading"
          aria-level={1}
          className={cn(
            'qd-prompt w-full leading-tight font-semibold',
            side ? 'text-[2.1em]' : 'text-[2em]',
          )}
        >
          {view.question.prompt}
        </Markdown>
        <AnswerRules question={view.question} className={side ? 'justify-start' : undefined} />
      </div>
    );
    // Nobody scrolls a projector: the stage is the screen's height, the answers keep
    // their room and the picture takes what is left (#92) — below the text, above it,
    // or beside it, as the author placed it; the answers stay at the bottom.
    stage = (
      <div className="flex min-h-0 w-full max-w-[64em] flex-1 flex-col items-center justify-center gap-[1em]">
        {side ? (
          <div
            className={cn(
              'grid min-h-0 w-full flex-1 items-center gap-[2em]',
              position === 'left' ? 'grid-cols-[1.3fr_1fr]' : 'grid-cols-[1fr_1.3fr]',
            )}
          >
            {position === 'left' ? (
              <>
                {media}
                {words}
              </>
            ) : (
              <>
                {words}
                {media}
              </>
            )}
          </div>
        ) : position === 'top' ? (
          <>
            {media}
            {words}
          </>
        ) : (
          <>
            {words}
            {media}
          </>
        )}
        {images ? (
          // No picture of its own: the pictures are the answers, and take what is left.
          <ImageChoiceGrid
            fit="screen"
            className="min-h-[8em] flex-1"
            options={view.question.options ?? []}
          />
        ) : view.question.options?.length ? (
          <div className="w-full shrink-0 text-[1.2em]">
            <OptionGrid options={view.question.options} />
          </div>
        ) : (
          <p className="text-[1.8em] font-semibold">{t('screen.answerOnPhone')}</p>
        )}
      </div>
    );
    bottom = view.paused
      ? band('bottom', null, bigStatus(t('screen.pausedBig'), t('screen.pausedText'), true), null)
      : view.answerCount && view.state === 'ANSWERING' && !visual
        ? band(
            'bottom',
            null,
            bigStatus(
              <Pulse
                value={t('screen.answered', {
                  answered: view.answerCount.answered,
                  total: view.answerCount.total,
                })}
              />,
            ),
            null,
          )
        : null;
  } else {
    // LOBBY (et état initial) : invitation à rejoindre + liste des joueurs (§4.1).
    // The room's next quiz (#89): what comes, and where the room stands.
    const nextInRoom = view.standings ? view.standings : null;
    top = band(
      'top',
      where(t('screen.phaseLobby')),
      view.quizTitle ? (
        <span className="text-[1.2em]">
          <span className="text-muted-foreground">
            {nextInRoom ? t('screen.nextQuiz') : t('screen.quizLabel')}
          </span>{' '}
          <b>{view.quizTitle}</b>
        </span>
      ) : view.state === 'LOBBY' && view.totalQuestions === 0 ? (
        // Back from a quiz: the host picks the next.
        <span className="text-muted-foreground text-[1.2em]">{t('live:room.pickingNextQuiz')}</span>
      ) : null,
      null,
    );
    // Beside the room's standings, the invitation keeps its QR code and PIN side by side.
    const lobby = (
      <div className="qd-lobby flex w-full flex-col items-center gap-[1.5em]">
        <div
          className={cn(
            'flex items-center justify-center',
            nextInRoom ? 'flex-nowrap gap-[2em]' : 'flex-wrap gap-[3em]',
          )}
        >
          <div className="qd-join-qr shrink-0 rounded-xl bg-white p-4 shadow">
            <QRCodeSVG
              value={joinUrl}
              size={nextInRoom ? 180 : 260}
              aria-label={t('screen.qrLabel')}
            />
          </div>
          <div className="flex flex-col items-start gap-[0.3em] text-left">
            <span className="text-[1.4em]">{t('screen.joinAt')}</span>
            <span className="text-[2em] font-bold">{joinHost}</span>
            <span className="qd-join-pin font-mono text-[4.5em] leading-none font-bold tracking-[0.12em]">
              {pin}
            </span>
          </div>
        </div>
        {/* The first question's sound or video, loaded on the devices that will play it. */}
        {view.readiness?.questionIndex === 0 ? (
          <ReadinessMeter readiness={view.readiness} className="text-[1em]" />
        ) : null}
        {/* Beside the room's standings, who is here is already said: no list again. */}
        {nextInRoom ? null : (
          <ul className="qd-roster flex max-w-[56em] flex-wrap justify-center gap-[0.5em]">
            {/* A crowded room: the first ones, then how many more (the count is below). */}
            {view.players.slice(0, ROSTER_MAX).map((p) => (
              <li
                key={p.playerId}
                className="flex items-center gap-[0.5em] rounded-full border py-[0.25em] pr-[0.75em] pl-[0.25em] text-[1.1em]"
              >
                <Avatar name={p.avatar || p.nickname} size="2em" />
                {p.nickname}
              </li>
            ))}
            {view.players.length > ROSTER_MAX ? (
              <li className="text-muted-foreground flex items-center rounded-full border px-[0.75em] py-[0.25em] text-[1.1em]">
                +{view.players.length - ROSTER_MAX}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    );
    // A room's next quiz (#198): the lobby on the left, the room's standings on the right.
    stage = nextInRoom ? (
      <div
        className={cn(
          'grid w-full items-start gap-[3em]',
          // A preview draws on a 1280-wide stage; a real projection splits when it is wide.
          boxed
            ? 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
            : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
        )}
      >
        {lobby}
        <RoomStandingsPanel standings={nextInRoom} max={6} className="text-[1.1em]" />
      </div>
    ) : (
      lobby
    );
    bottom = band(
      'bottom',
      null,
      bigStatus(
        <>
          <Users aria-hidden className="mr-[0.3em] inline size-[0.9em]" />
          <span data-testid="player-count">{view.players.length}</span>{' '}
          {t('screen.participants', { count: view.players.length })}
        </>,
        view.readiness?.lobby ? t('screen.readyOf', { ready: view.readiness.ready }) : null,
      ),
      view.lobbyStartAt ? (
        <LobbyCountdown startAt={view.lobbyStartAt} className="text-[1.3em] font-semibold" />
      ) : null,
    );
  }

  const slide = view.state === 'SLIDE_SHOW';
  // The motion layer (UI system §1.8): what the step is, and what it is drawn on.
  const stepKey = stepKeyOf(view);
  const frame = (
    <div className={cn('flex w-full flex-1 flex-col', !slide && 'min-h-0')}>
      {top}
      <StepEnter
        stepKey={stepKey}
        className={cn(
          'flex min-h-0 w-full flex-1 flex-col items-center',
          slide
            ? 'items-stretch'
            : cn(
                'justify-center px-[3.5em] text-center',
                compact ? 'gap-[1em] py-[0.8em]' : 'gap-[1.5em] py-[1.5em]',
              ),
          view.paused && !slide && 'opacity-60',
        )}
      >
        {stage}
      </StepEnter>
      {bottom}
    </div>
  );

  return (
    <LiveMotion on={view.motion}>
      <div
        ref={ref}
        data-state={view.state ?? 'none'}
        className={cn(
          'qd-screen bg-background relative flex flex-col',
          boxed ? 'h-full w-full overflow-hidden' : 'min-h-dvh',
          // A question fits the screen exactly; the rest may grow.
          !boxed &&
            (view.state === 'ANSWERING' ||
              view.state === 'QUESTION_SHOW' ||
              view.state === 'REVEAL' ||
              view.state === 'LEADERBOARD') &&
            'h-dvh',
          // One typographic base for the whole projected page; everything inside is in em.
          boxed ? TYPE_BASE.stage : TYPE_BASE.screen,
        )}
      >
        {fullscreenBtn}
        {soundButton ? (
          <SoundButton
            size="lg"
            align="start"
            className={cn('absolute top-4 left-4 z-40', BACKDROP_EDGE)}
            onUnmute={() => void unlockAudio()}
          />
        ) : null}
        {/* A quiz with sound asks for the unlocking click as soon as this window opens,
          whatever the moment of the session; a silent quiz never asks. */}
        {(playMedia || (role === 'follow' && sound)) &&
        !soundUnlocked &&
        !deviceSound.muted &&
        (view.quizHasSound || soundsOn) &&
        view.state !== 'ENDED' ? (
          // The projection cannot be muted from here: the console does it.
          <SoundUnlockOverlay allowSilent={role === 'follow'} />
        ) : null}
        {onBackground &&
        view.question?.background &&
        view.state &&
        QUESTION_STATES.has(view.state) ? (
          // A question with a background owns the surface, bands included.
          <Surface
            background={view.question.background}
            textTone={view.question.textTone}
            textOutline={view.question.textOutline}
            className="absolute inset-0"
          >
            {frame}
          </Surface>
        ) : (
          frame
        )}
        <BackdropFade stepKey={stepKey} backdrop={backdropOf(view, onBackground)} />
      </div>
    </LiveMotion>
  );
}
