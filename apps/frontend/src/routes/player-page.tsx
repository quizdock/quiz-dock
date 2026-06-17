import { useParams } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { joinSession, loadPlayerSession } from '../game/game-client';
import { OptionGrid } from '../game/live-components';
import { useGameSession } from '../game/use-game-session';

/**
 * Client apprenant (mobile, §5). Machine à états pilotée par `useGameSession` :
 * une session locale relance la partie (`player:reconnect`), sinon l'écran de join
 * (pseudo) s'affiche (§6.1). Après le join, on suit l'état serveur (attente →
 * réponse → feedback → podium), grille verrouillée à 1 réponse (RG-06).
 */
export function PlayerPage() {
  const { pin } = useParams({ from: '/join/$pin' });
  const { view, socket, markJoined } = useGameSession(pin, 'player');
  const [nickname, setNickname] = useState(() => loadPlayerSession()?.nickname ?? '');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Nouvelle question → réinitialise la sélection locale.
  useEffect(() => setPickedId(null), [view.questionIndex]);

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setJoining(true);
    try {
      await joinSession(pin, nickname.trim());
      markJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre la partie.');
    } finally {
      setJoining(false);
    }
  };

  const onPick = (optionId: string) => {
    setPickedId(optionId);
    socket?.emit('player:submit', { pin, questionIndex: view.questionIndex, answer: optionId });
  };

  const wrap = (children: React.ReactNode) => (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 py-8 text-center">
      {children}
    </section>
  );

  // ── Écran « Rejoindre » (pas de session locale valide) ─────────────────────
  if (view.status === 'no-session') {
    return wrap(
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Ton pseudo</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 text-left" onSubmit={(e) => void onJoin(e)}>
            <Label>
              Pseudo
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Votre pseudo"
                required
              />
            </Label>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <Button type="submit" disabled={joining || !nickname.trim()}>
              <LogIn className="size-4" />
              {joining ? 'Connexion…' : "C'est parti !"}
            </Button>
          </form>
        </CardContent>
      </Card>,
    );
  }

  if (view.status === 'connecting') {
    return wrap(<p className="text-muted-foreground">Connexion à la partie…</p>);
  }

  // ── États de jeu ───────────────────────────────────────────────────────────
  if (view.state === 'HOST_DISCONNECTED') {
    return wrap(
      <p className="text-xl font-semibold">Présentateur déconnecté — partie en pause.</p>,
    );
  }
  if (view.state === 'ENDED') {
    return wrap(<p className="text-xl font-semibold">Merci d’avoir joué ! 🎉</p>);
  }

  if (view.state === 'PODIUM') {
    return wrap(
      <>
        <h2 className="text-2xl font-bold">🏆 Podium</h2>
        {view.podium?.you ? (
          <p className="text-lg">
            Ton classement : <span className="font-semibold">{view.podium.you.rank}ᵉ</span> —{' '}
            {view.podium.you.score} pts
          </p>
        ) : null}
      </>,
    );
  }

  if (view.state === 'REVEAL' || view.state === 'LEADERBOARD') {
    const r = view.result;
    return wrap(
      r ? (
        <div className="flex flex-col items-center gap-2">
          <p className={`text-3xl font-bold ${r.correct ? 'text-green-600' : 'text-destructive'}`}>
            {r.correct ? '✓ Juste !' : '✗ Raté'}
          </p>
          <p className="text-xl">+{r.points} points</p>
          <p className="text-muted-foreground">Rang : {r.rank}ᵉ</p>
        </div>
      ) : (
        <p className="text-muted-foreground">Réponses révélées…</p>
      ),
    );
  }

  if (view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') {
    const answered = pickedId !== null || view.answerAccepted === true;
    if (answered) {
      return wrap(<p className="text-xl font-semibold">Réponse enregistrée ✓</p>);
    }
    return wrap(
      view.question?.options?.length ? (
        <OptionGrid options={view.question.options} onPick={onPick} pickedId={pickedId} />
      ) : (
        <p className="text-muted-foreground">En attente de la question…</p>
      ),
    );
  }

  // ── LOBBY / attente ──────────────────────────────────────────────────────────
  return wrap(
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Tu es dans la partie !</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {nickname ? <p className="text-lg font-semibold">« {nickname} »</p> : null}
        <p className="text-muted-foreground">En attente du formateur…</p>
        {view.fullCapture ? (
          <p className="text-muted-foreground border-t pt-2 text-sm">
            ⓘ Session enregistrée : tes réponses individuelles seront conservées pour le suivi de
            formation.
          </p>
        ) : null}
      </CardContent>
    </Card>,
  );
}
