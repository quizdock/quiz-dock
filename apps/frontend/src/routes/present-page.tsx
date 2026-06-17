import { Link, useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Play, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
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
    </section>
  );
}
