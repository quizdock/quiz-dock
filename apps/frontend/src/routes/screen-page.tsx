import { useParams } from '@tanstack/react-router';
import { Maximize, Minimize, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFullscreen } from '@/lib/use-fullscreen';
import { Avatar } from '../game/avatar';
import { LeaderboardList, OptionGrid, Podium, RevealAnswer } from '../game/live-components';
import { useGameRemaining } from '../game/use-countdown';
import { useGameSession } from '../game/use-game-session';

/**
 * Écran de jeu projeté (grand écran, §4). Socket **spectateur** en lecture seule :
 * aucune auth, le PIN suffit, jamais de bonne réponse avant le reveal (anti-triche §7).
 * Se reconnecte seul au rechargement (le PIN est dans l'URL). Plein écran pour la
 * vidéoprojection.
 */
export function ScreenPage() {
  const { t } = useTranslation('live');
  const { pin } = useParams({ from: '/present/$pin/screen' });
  const { view } = useGameSession(pin, 'spectator');
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();
  const remaining = useGameRemaining(view);

  const joinUrl = `${window.location.origin}/join/${pin}`;

  // Rappel d'invitation (QR + PIN) ancré en bas de l'écran projeté : permet aux
  // retardataires de rejoindre en cours de question (notamment quand l'énoncé n'a
  // pas d'options affichées à l'écran, cf. « Réponds sur ton téléphone »).
  const joinBar = (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 border-t bg-background/80 p-4 backdrop-blur">
      <div className="rounded-md bg-white p-1.5 shadow">
        <QRCodeSVG value={joinUrl} size={80} aria-label={t('screen.qrLabel')} />
      </div>
      <div className="flex flex-col items-start">
        <span className="text-muted-foreground text-sm uppercase tracking-widest">
          {window.location.host}/join
        </span>
        <span className="font-mono text-4xl font-bold tracking-[0.2em]">{pin}</span>
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
      <p className="text-muted-foreground text-xl">
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
    body = <p className="text-3xl font-semibold">{t('screen.paused')}</p>;
  } else if (view.state === 'ENDED') {
    body = <p className="text-3xl font-semibold">{t('screen.thanks')}</p>;
  } else if (view.state === 'PODIUM' && view.podium) {
    body = (
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h2 className="text-3xl font-bold">{t('screen.podium')}</h2>
        <Podium rows={view.podium.podium} />
        {view.leaderboard && view.leaderboard.top.length > 3 ? (
          <div className="flex w-full flex-col gap-2">
            <h3 className="text-muted-foreground text-xl font-semibold">
              {t('screen.overallRanking')}
            </h3>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
      </div>
    );
  } else if ((view.state === 'REVEAL' || view.state === 'LEADERBOARD') && view.question) {
    body = (
      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        <h1 className="text-center text-3xl font-semibold">{view.question.prompt}</h1>
        {view.reveal ? <RevealAnswer question={view.question} reveal={view.reveal} /> : null}
        {view.leaderboard ? (
          <div className="flex w-full max-w-md flex-col gap-2 text-lg">
            <h3 className="text-muted-foreground font-semibold">{t('screen.leaderboard')}</h3>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
      </div>
    );
  } else if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && view.question) {
    body = (
      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        <div className="flex w-full items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold">{view.question.prompt}</h1>
          {remaining !== null ? (
            <span
              className={cn('text-4xl font-bold tabular-nums', view.paused && 'opacity-50')}
              aria-label={t('screen.timeRemaining')}
            >
              {view.paused ? '⏸' : '⏱'} {remaining}
            </span>
          ) : null}
        </div>
        {view.question.options?.length ? (
          <OptionGrid options={view.question.options} size="lg" />
        ) : (
          <>
            <p className="text-muted-foreground text-2xl">{t('screen.answerOnPhone')}</p>
            {joinBar}
          </>
        )}
        {counter}
      </div>
    );
  } else {
    // LOBBY (et état initial) : invitation à rejoindre + liste des joueurs (§4.1).
    body = (
      <div className="flex flex-col items-center gap-6">
        <p className="text-2xl">
          {t('screen.joinAt')} <span className="font-semibold">{window.location.host}/join</span>
        </p>
        <p className="font-mono text-7xl font-bold tracking-[0.3em]">{pin}</p>
        <div className="rounded-xl bg-white p-4 shadow">
          <QRCodeSVG value={joinUrl} size={200} aria-label={t('screen.qrLabel')} />
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xl">
          <Users className="size-5" />
          <span data-testid="player-count">{view.players.length}</span>
          <span>{t('screen.participants', { count: view.players.length })}</span>
        </div>
        <ul className="flex max-w-3xl flex-wrap justify-center gap-2">
          {view.players.map((p) => (
            <li
              key={p.playerId}
              className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-lg"
            >
              <Avatar name={p.avatar || p.nickname} size={32} />
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
      className="bg-background relative flex min-h-[80vh] flex-col items-center justify-center gap-6 p-8 text-center"
    >
      {fullscreenBtn}
      {body}
    </div>
  );
}
