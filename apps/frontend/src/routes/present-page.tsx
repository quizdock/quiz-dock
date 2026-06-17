import { Link, useParams } from '@tanstack/react-router';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Play, Share2, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getGameSocket } from '../game/game-client';

interface LobbyPlayer {
  playerId: string;
  nickname: string;
}

/**
 * Salle d'attente de l'hôte : PIN en grand + QR code à scanner, liste des joueurs
 * en temps réel, et démarrage de la partie. Le socket (et la partie) ont été créés
 * au clic « Présenter » ; on réutilise ici le singleton.
 */
export function PresentPage() {
  const { pin } = useParams({ from: '/present/$pin' });
  const socket = getGameSocket();
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [started, setStarted] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!socket) return;
    const onJoined = (p: { playerId: string; nickname: string }) =>
      setPlayers((prev) =>
        prev.some((x) => x.playerId === p.playerId)
          ? prev
          : [...prev, { playerId: p.playerId, nickname: p.nickname }],
      );
    const onLeft = (p: { playerId: string }) =>
      setPlayers((prev) => prev.filter((x) => x.playerId !== p.playerId));
    socket.on('player:joined', onJoined);
    socket.on('player:left', onLeft);
    return () => {
      socket.off('player:joined', onJoined);
      socket.off('player:left', onLeft);
    };
  }, [socket]);

  if (!socket) {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">
          Session perdue (la page a été rechargée). Relancez la partie depuis le quiz.
        </p>
        <Link to="/dashboard" className="underline">
          Retour à mes quiz
        </Link>
      </section>
    );
  }

  const joinUrl = `${window.location.origin}/join/${pin}`;

  /**
   * Partage le lien d'invitation : QR en image + texte/PIN via l'API Web Share
   * (mobile), repli texte+URL, puis copie presse-papier si rien d'autre n'existe.
   */
  const qrFile = async (): Promise<File | null> => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return null;
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      return blob ? new File([blob], `roux-quizz-${pin}.png`, { type: 'image/png' }) : null;
    } catch {
      return null; // canvas non disponible (ex. jsdom) → repli sans image
    }
  };

  const onShare = async () => {
    // Message lisible : PIN mis en avant + lien direct. `url` est repris comme
    // lien hypertexte cliquable par les cibles de partage (mail, messagerie…).
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
        // Texte + lien cliquable + QR en image (cible qui accepte les fichiers).
        await navigator.share(withFile);
      } else if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(text);
        setShareNote('Invitation copiée (PIN + lien) dans le presse-papier.');
      }
    } catch {
      // Partage annulé par l'utilisateur ou non supporté : on ignore.
    }
  };

  return (
    <section className="flex flex-col items-center gap-8 py-8">
      <div className="flex flex-col items-center gap-2">
        <p className="text-muted-foreground text-sm uppercase tracking-widest">
          Rejoignez sur {window.location.host}/join
        </p>
        <p className="font-mono text-6xl font-bold tracking-[0.3em]" aria-label="Code PIN">
          {pin}
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <QRCodeSVG value={joinUrl} size={200} aria-label="QR code pour rejoindre" />
      </div>

      <div className="flex items-center gap-2 text-lg">
        <Users className="size-5" />
        <span data-testid="player-count">{players.length}</span>
        <span className="text-muted-foreground">joueur(s) connecté(s)</span>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {players.map((p) => (
          <li key={p.playerId} className="rounded-full border px-3 py-1 text-sm">
            {p.nickname}
          </li>
        ))}
      </ul>

      {started ? (
        <p className="text-muted-foreground">Partie lancée — les écrans de jeu arrivent bientôt.</p>
      ) : (
        <Button
          type="button"
          disabled={players.length === 0}
          onClick={() => {
            socket.emit('host:start', { pin });
            setStarted(true);
          }}
        >
          <Play className="size-4" />
          Démarrer la partie
        </Button>
      )}

      {/* QR hors-écran : sert à produire l'image PNG pour le partage. */}
      <QRCodeCanvas value={joinUrl} size={512} ref={qrCanvasRef} className="hidden" />

      <footer className="mt-4 flex flex-col items-center gap-2 border-t pt-6">
        <Button type="button" variant="outline" onClick={() => void onShare()}>
          <Share2 className="size-4" />
          Partager
        </Button>
        {shareNote ? <p className="text-muted-foreground text-sm">{shareNote}</p> : null}
      </footer>
    </section>
  );
}
