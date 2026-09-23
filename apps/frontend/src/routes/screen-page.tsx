import { useParams } from '@tanstack/react-router';
import { Maximize, Minimize, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFullscreen } from '@/lib/use-fullscreen';
import { Avatar } from '../game/avatar';
import {
  AnswerExplanation,
  AnswerRules,
  LeaderboardList,
  OptionGrid,
  Podium,
  RevealAnswer,
  SlideView,
  TYPE_BASE,
} from '../game/live-components';
import { useAudioUnlocked } from '../game/media/audio-unlock';
import { preloadMedia } from '../game/media/media-pool';
import { QuestionMediaStage } from '../game/media/question-media-stage';
import { SoundUnlockOverlay } from '../game/media/sound-unlock-overlay';
import { Surface } from '../game/surface';
import { useGameRemaining } from '../game/use-countdown';
import { joinHostLabel, joinUrlFor } from '../game/join-url';
import { useGameSession } from '../game/use-game-session';

/**
 * Écran de jeu projeté (grand écran, §4). Socket **spectateur** en lecture seule :
 * aucune auth, le PIN suffit, jamais de bonne réponse avant le reveal (anti-triche §7).
 * Se reconnecte seul au rechargement (le PIN est dans l'URL). Plein écran pour la
 * vidéoprojection.
 */
export function ScreenPage() {
  const { pin } = useParams({ from: '/session/$pin/projection' });
  return <ScreenView pin={pin} playMedia />;
}

/**
 * The projected screen itself; also embedded in the host console's Projection
 * tab. Only the projection window (`playMedia`) plays the questions' videos and
 * sounds — the console's copy shows them still, or the room would hear
 * everything twice.
 */
export function ScreenView({ pin, playMedia = false }: { pin: string; playMedia?: boolean }) {
  const { t } = useTranslation('live');
  const { view } = useGameSession(pin, 'spectator');
  const soundUnlocked = useAudioUnlocked();

  // While the leaderboard is up, the next question's media buffer here.
  useEffect(() => {
    if (playMedia && view.preload) preloadMedia(view.preload.media);
  }, [playMedia, view.preload]);
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();
  const remaining = useGameRemaining(view);

  const joinUrl = joinUrlFor(view, pin);
  const joinHost = joinHostLabel(view);

  // Rappel d'invitation (QR + PIN) ancré en bas de l'écran projeté : permet aux
  // retardataires de rejoindre en cours de question (notamment quand l'énoncé n'a
  // pas d'options affichées à l'écran, cf. « Réponds sur ton téléphone »).
  const joinBar = (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-[1em] border-t bg-background/80 p-[1em] backdrop-blur">
      <div className="rounded-md bg-white p-1.5 shadow">
        <QRCodeSVG value={joinUrl} size={80} aria-label={t('screen.qrLabel')} />
      </div>
      <div className="flex flex-col items-start">
        <span className="text-muted-foreground text-[0.8em] uppercase tracking-widest">
          {joinHost}
        </span>
        <span className="font-mono text-[2.25em] font-bold tracking-[0.2em]">{pin}</span>
      </div>
    </div>
  );

  const fullscreenBtn = supported ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-4 top-4"
      aria-label={isFullscreen ? t('screen.exitFullscreen') : t('screen.fullscreen')}
      onClick={() => void toggle()}
    >
      {isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
    </Button>
  ) : null;

  const counter =
    view.answerCount && view.state === 'ANSWERING' ? (
      <p className="text-muted-foreground text-[1.25em]">
        {t('screen.answersReceived')}{' '}
        <span className="tabular-nums">
          {view.answerCount.answered} / {view.answerCount.total}
        </span>
      </p>
    ) : null;

  let body: React.ReactNode;

  if (view.status === 'error') {
    body = <p className="text-muted-foreground">{view.error ?? t('screen.sessionUnavailable')}</p>;
  } else if (view.state === 'HOST_DISCONNECTED') {
    body = <p className="text-[2em] font-semibold">{t('screen.paused')}</p>;
  } else if (view.state === 'ENDED') {
    body = <p className="text-[2em] font-semibold">{t('screen.thanks')}</p>;
  } else if (view.state === 'SLIDE_SHOW' && view.slide) {
    body = (
      <div className="flex min-h-dvh w-full flex-1">
        <SlideView slide={view.slide} />
      </div>
    );
  } else if (view.state === 'PODIUM' && view.podium) {
    body = (
      <div className="flex w-full max-w-[28em] flex-col items-center gap-[1.5em]">
        <h2 className="text-[2em] font-bold">{t('screen.podium')}</h2>
        <Podium rows={view.podium.podium} />
        {view.leaderboard && view.leaderboard.top.length > 3 ? (
          <div className="flex w-full flex-col gap-[0.5em]">
            <h3 className="text-muted-foreground text-[1.25em] font-semibold">
              {t('screen.overallRanking')}
            </h3>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
      </div>
    );
  } else if ((view.state === 'REVEAL' || view.state === 'LEADERBOARD') && view.question) {
    body = (
      <div className="flex w-full max-w-[40em] flex-col items-center gap-[1.5em]">
        <Markdown role="heading" aria-level={1} className="text-center text-[2em] font-semibold">
          {view.question.prompt}
        </Markdown>
        {view.reveal ? <RevealAnswer question={view.question} reveal={view.reveal} /> : null}
        {view.reveal ? <AnswerExplanation reveal={view.reveal} /> : null}
        {view.leaderboard ? (
          <div className="flex w-full max-w-[28em] flex-col gap-[0.5em]">
            <h3 className="text-muted-foreground font-semibold">{t('screen.leaderboard')}</h3>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
      </div>
    );
  } else if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && view.question) {
    body = (
      <div className="flex w-full max-w-[40em] flex-col items-center gap-[1.5em]">
        <div className="flex w-full items-start justify-between gap-[1em]">
          <Markdown role="heading" aria-level={1} className="text-[2em] font-semibold">
            {view.question.prompt}
          </Markdown>
          {remaining !== null ? (
            <span
              className={cn(
                'shrink-0 text-[2.5em] font-bold whitespace-nowrap tabular-nums',
                view.paused && 'opacity-50',
              )}
              aria-label={t('screen.timeRemaining')}
            >
              {view.paused ? '⏸' : '⏱'} {remaining}
            </span>
          ) : null}
        </div>
        {/* Image or video in one box, the sound as its waveform; played here only. */}
        <QuestionMediaStage
          key={view.question.questionIndex}
          media={view.question.media}
          mode={!playMedia || view.nav?.review ? 'still' : view.paused ? 'pause' : 'play'}
          boxClassName="h-[35vh]"
        />
        <AnswerRules question={view.question} />
        {view.question.options?.length ? (
          <OptionGrid options={view.question.options} />
        ) : (
          <>
            <p className="text-muted-foreground text-[1.5em]">{t('screen.answerOnPhone')}</p>
            {joinBar}
          </>
        )}
        {counter}
      </div>
    );
  } else {
    // LOBBY (et état initial) : invitation à rejoindre + liste des joueurs (§4.1).
    body = (
      <div className="flex flex-col items-center gap-[1.5em]">
        <p className="text-[1.5em]">
          {t('screen.joinAt')} <span className="font-semibold">{joinHost}</span>
        </p>
        <p className="font-mono text-[4em] font-bold tracking-[0.3em]">{pin}</p>
        <div className="rounded-xl bg-white p-4 shadow">
          <QRCodeSVG value={joinUrl} size={200} aria-label={t('screen.qrLabel')} />
        </div>
        <div className="text-muted-foreground flex items-center gap-[0.5em] text-[1.25em]">
          <Users className="size-[1em]" />
          <span data-testid="player-count">{view.players.length}</span>
          <span>{t('screen.participants', { count: view.players.length })}</span>
        </div>
        <ul className="flex max-w-[40em] flex-wrap justify-center gap-[0.5em]">
          {view.players.map((p) => (
            <li
              key={p.playerId}
              className="flex items-center gap-[0.5em] rounded-full border py-[0.25em] pl-[0.25em] pr-[0.75em] text-[1.1em]"
            >
              <Avatar name={p.avatar || p.nickname} size="2em" />
              {p.nickname}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        'bg-background relative flex min-h-dvh flex-col',
        // One typographic base for the whole projected page; everything inside is in em.
        TYPE_BASE.screen,
        // A slide owns the whole surface; everything else is centred with breathing room.
        view.state === 'SLIDE_SHOW'
          ? 'items-stretch justify-stretch p-0'
          : 'items-center justify-center gap-[1.5em] p-[2em] text-center',
      )}
    >
      {fullscreenBtn}
      {playMedia && !soundUnlocked && (view.state === null || view.state === 'LOBBY') ? (
        <SoundUnlockOverlay />
      ) : null}
      {view.nav?.review ? (
        <span className="bg-muted text-muted-foreground absolute left-[1em] top-[1em] z-20 rounded-full px-[0.8em] py-[0.3em] text-[0.8em] font-medium">
          {t('screen.review')}
        </span>
      ) : null}
      {view.question?.background && view.state !== 'SLIDE_SHOW' ? (
        // A question with a background owns the surface like a slide does.
        <Surface
          background={view.question.background}
          textTone={view.question.textTone}
          textOutline={view.question.textOutline}
          className="absolute inset-0 flex items-center justify-center p-[2em]"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-[1.5em]">
            {body}
          </div>
        </Surface>
      ) : (
        body
      )}
    </div>
  );
}
