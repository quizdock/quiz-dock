import { Link, useParams } from '@tanstack/react-router';
import { Eye, Play, Share2, SkipForward, Square, Users } from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LeaderboardList, Podium, RevealAnswer } from '../game/live-components';
import { useCountdown } from '../game/use-countdown';
import { useGameSession } from '../game/use-game-session';

/**
 * Console d'animation (hôte, §3). Une seule fenêtre attachée en hôte propriétaire :
 * pilote la partie (démarrer / révéler / suivant / terminer) et survit au rechargement
 * via `host:attach` (l'état est rejoué par le serveur). Le grand écran à vidéoprojeter
 * est une fenêtre séparée (`/present/$pin/screen`), ouvrable sur un autre poste.
 */
export function ControlPage() {
  const { pin } = useParams({ from: '/present/$pin/control' });
  const { view, socket } = useGameSession(pin, 'host');
  const [shareNote, setShareNote] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const joinUrl = `${window.location.origin}/join/${pin}`;
  const screenUrl = `${window.location.origin}/present/${pin}/screen`;
  const emit = (event: 'host:start' | 'host:reveal' | 'host:next' | 'host:end') =>
    socket?.emit(event, { pin });
  const remaining = useCountdown(
    view.state === 'ANSWERING' && view.question ? view.question.endsAt : null,
  );
  const openScreen = () => window.open(screenUrl, '_blank', 'noopener,noreferrer');
  const screenButton = (
    <Button type="button" variant="outline" onClick={openScreen}>
      <Eye className="size-4" />
      Écran de projection
    </Button>
  );

  const qrFile = async (): Promise<File | null> => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return null;
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      return blob ? new File([blob], `roux-quizz-${pin}.png`, { type: 'image/png' }) : null;
    } catch {
      return null;
    }
  };

  const onShare = async () => {
    const text = [
      'Rejoignez la partie Roux-Quizz 🎮',
      `PIN : ${pin}`,
      `Lien direct : ${joinUrl}`,
    ].join('\n');
    const data: ShareData = { title: 'Rejoindre la partie Roux-Quizz', text, url: joinUrl };
    const file = await qrFile();
    const withFile = file ? { ...data, files: [file] } : null;
    try {
      if (withFile && navigator.canShare?.(withFile)) {
        await navigator.share(withFile);
      } else if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(text);
        setShareNote('Invitation copiée (PIN + lien) dans le presse-papier.');
      }
    } catch {
      /* partage annulé / non supporté */
    }
  };

  if (view.status === 'connecting') {
    return <p className="text-muted-foreground py-16 text-center">Connexion à la partie…</p>;
  }
  if (view.status === 'error') {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">{view.error ?? 'Partie indisponible.'}</p>
        <Link to="/dashboard" className="underline">
          Retour à mes quiz
        </Link>
      </section>
    );
  }

  const header = (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <Users className="size-4" />
      <span data-testid="player-count">{view.players.length}</span>
      <span>joueur(s) connecté(s)</span>
    </div>
  );

  // ── LOBBY ────────────────────────────────────────────────────────────────
  if (view.state === 'LOBBY' || view.state === null) {
    return (
      <section className="flex flex-col items-center gap-6 py-8">
        <div className="flex flex-col items-center gap-1">
          <p className="text-muted-foreground text-sm uppercase tracking-widest">
            Rejoignez sur {window.location.host}/join
          </p>
          <p className="font-mono text-6xl font-bold tracking-[0.3em]" aria-label="Code PIN">
            {pin}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow">
          <QRCodeSVG value={joinUrl} size={180} aria-label="QR code pour rejoindre" />
        </div>
        {header}
        <ul className="flex flex-wrap justify-center gap-2">
          {view.players.map((p) => (
            <li key={p.playerId} className="rounded-full border px-3 py-1 text-sm">
              {p.nickname}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            disabled={view.players.length === 0}
            onClick={() => emit('host:start')}
          >
            <Play className="size-4" />
            Démarrer la partie
          </Button>
          <Button type="button" variant="outline" onClick={() => void onShare()}>
            <Share2 className="size-4" />
            Partager
          </Button>
          {screenButton}
        </div>
        {shareNote ? <p className="text-muted-foreground text-sm">{shareNote}</p> : null}
        <QRCodeCanvas value={joinUrl} size={512} ref={qrCanvasRef} className="hidden" />
      </section>
    );
  }

  // ── HOST_DISCONNECTED (vu depuis une autre fenêtre de contrôle) ───────────
  if (view.state === 'HOST_DISCONNECTED') {
    return (
      <p className="text-muted-foreground py-16 text-center">
        Partie en pause — présentateur déconnecté.
      </p>
    );
  }

  // ── ENDED ─────────────────────────────────────────────────────────────────
  if (view.state === 'ENDED') {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-xl font-semibold">Partie terminée.</p>
        <Link to="/dashboard" className="underline">
          Retour à mes quiz
        </Link>
      </section>
    );
  }

  // ── REVEAL / LEADERBOARD ───────────────────────────────────────────────────
  if (view.state === 'REVEAL' || view.state === 'LEADERBOARD') {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6">
        <div className="flex items-center justify-between">
          {header}
          {screenButton}
        </div>
        {view.question && view.reveal ? (
          <RevealAnswer question={view.question} reveal={view.reveal} />
        ) : null}
        {view.leaderboard ? (
          <div>
            <h2 className="mb-2 font-semibold">Classement</h2>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" onClick={() => emit('host:next')}>
            <SkipForward className="size-4" />
            Question suivante
          </Button>
        </div>
      </section>
    );
  }

  // ── PODIUM ──────────────────────────────────────────────────────────────────
  if (view.state === 'PODIUM') {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-8">
        <h2 className="text-2xl font-bold">🏆 Podium</h2>
        {view.podium ? <Podium rows={view.podium.podium} /> : null}
        <Button type="button" variant="outline" onClick={() => emit('host:end')}>
          <Square className="size-4" />
          Terminer la partie
        </Button>
      </section>
    );
  }

  // ── ANSWERING / QUESTION_SHOW ──────────────────────────────────────────────
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          Question {view.questionIndex + 1} / {view.totalQuestions}
        </span>
        {remaining !== null ? (
          <span className="text-2xl font-bold tabular-nums" aria-label="Temps restant">
            ⏱ {remaining}
          </span>
        ) : null}
        {header}
        {screenButton}
      </div>
      <h1 className="text-2xl font-semibold">{view.question?.prompt}</h1>
      <p className="text-lg">
        Réponses reçues :{' '}
        <span className="font-semibold tabular-nums">
          {view.answerCount?.answered ?? 0} / {view.answerCount?.total ?? view.players.length}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => emit('host:reveal')}>
          <Eye className="size-4" />
          Révéler maintenant
        </Button>
        <Button type="button" variant="outline" onClick={() => emit('host:end')}>
          <Square className="size-4" />
          Terminer la partie
        </Button>
      </div>
    </section>
  );
}
