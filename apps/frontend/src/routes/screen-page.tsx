import { useParams } from '@tanstack/react-router';
import { Maximize, Minimize, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFullscreen } from '@/lib/use-fullscreen';
import { OptionGrid, Podium, RevealAnswer } from '../game/live-components';
import { useGameRemaining } from '../game/use-countdown';
import { useGameSession } from '../game/use-game-session';

/**
 * Écran de jeu projeté (grand écran, §4). Socket **spectateur** en lecture seule :
 * aucune auth, le PIN suffit, jamais de bonne réponse avant le reveal (anti-triche §7).
 * Se reconnecte seul au rechargement (le PIN est dans l'URL). Plein écran pour la
 * vidéoprojection.
 */
export function ScreenPage() {
  const { pin } = useParams({ from: '/present/$pin/screen' });
  const { view } = useGameSession(pin, 'spectator');
  const { ref, isFullscreen, toggle, supported } = useFullscreen<HTMLDivElement>();
  const remaining = useGameRemaining(view);

  const joinUrl = `${window.location.origin}/join/${pin}`;

  const fullscreenBtn = supported ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-4 top-4"
      aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
      onClick={() => void toggle()}
    >
      {isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
    </Button>
  ) : null;

  const counter =
    view.answerCount && view.state === 'ANSWERING' ? (
      <p className="text-muted-foreground text-xl">
        Réponses reçues :{' '}
        <span className="tabular-nums">
          {view.answerCount.answered} / {view.answerCount.total}
        </span>
      </p>
    ) : null;

  let body: React.ReactNode;

  if (view.status === 'error') {
    body = <p className="text-muted-foreground">{view.error ?? 'Partie indisponible.'}</p>;
  } else if (view.state === 'HOST_DISCONNECTED') {
    body = <p className="text-3xl font-semibold">Partie en pause…</p>;
  } else if (view.state === 'ENDED') {
    body = <p className="text-3xl font-semibold">Merci d’avoir joué ! 🎉</p>;
  } else if (view.state === 'PODIUM' && view.podium) {
    body = (
      <div className="flex flex-col items-center gap-6">
        <h2 className="text-3xl font-bold">🏆 Podium</h2>
        <Podium rows={view.podium.podium} />
      </div>
    );
  } else if ((view.state === 'REVEAL' || view.state === 'LEADERBOARD') && view.question) {
    body = (
      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        <h1 className="text-center text-3xl font-semibold">{view.question.prompt}</h1>
        {view.reveal ? <RevealAnswer question={view.question} reveal={view.reveal} /> : null}
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
              aria-label="Temps restant"
            >
              {view.paused ? '⏸' : '⏱'} {remaining}
            </span>
          ) : null}
        </div>
        {view.question.options?.length ? (
          <OptionGrid options={view.question.options} size="lg" />
        ) : (
          <p className="text-muted-foreground text-2xl">Réponds sur ton téléphone 📱</p>
        )}
        {counter}
      </div>
    );
  } else {
    // LOBBY (et état initial) : invitation à rejoindre + liste des joueurs (§4.1).
    body = (
      <div className="flex flex-col items-center gap-6">
        <p className="text-2xl">
          Rejoignez sur <span className="font-semibold">{window.location.host}/join</span>
        </p>
        <p className="font-mono text-7xl font-bold tracking-[0.3em]">{pin}</p>
        <div className="rounded-xl bg-white p-4 shadow">
          <QRCodeSVG value={joinUrl} size={200} aria-label="QR code pour rejoindre" />
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xl">
          <Users className="size-5" />
          <span data-testid="player-count">{view.players.length}</span>
          <span>joueur(s)</span>
        </div>
        <ul className="flex max-w-3xl flex-wrap justify-center gap-2">
          {view.players.map((p) => (
            <li key={p.playerId} className="rounded-full border px-3 py-1 text-lg">
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
