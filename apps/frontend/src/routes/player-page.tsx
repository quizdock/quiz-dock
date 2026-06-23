import { useParams } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Check, LogIn, Shuffle } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '../game/avatar';
import {
  joinSession,
  loadAvatarSeed,
  loadPlayerSession,
  saveAvatarSeed,
} from '../game/game-client';
import { OptionGrid } from '../game/live-components';
import { RatingPanel } from '../game/rating-panel';
import { useGameRemaining } from '../game/use-countdown';
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
  const [selected, setSelected] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [freeValue, setFreeValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // Graine d'avatar persistée localement (réinjectée d'une partie à l'autre).
  const [avatarSeed, setAvatarSeed] = useState(() => loadAvatarSeed() ?? '');

  const question = view.question;
  const isMulti = question?.type === 'multiple_choice';
  const remaining = useGameRemaining(view);
  // Avatar affiché : graine choisie, sinon dérivée du pseudo.
  const avatarName = avatarSeed || nickname || '?';

  // Graine déjà synchronisée vers le serveur (pour n'émettre que sur changement réel).
  const [syncedSeed, setSyncedSeed] = useState(avatarSeed);

  /**
   * Randomise l'avatar **localement** uniquement (aperçu + mémorisation) : pas
   * d'émission réseau ici, pour éviter d'inonder le serveur/formateur à chaque clic.
   * La synchronisation se fait explicitement via « Enregistrer l'avatar ».
   */
  const randomizeAvatar = () => {
    const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    setAvatarSeed(seed);
    saveAvatarSeed(seed);
  };

  /** Synchronise l'avatar choisi vers la room (refusé côté serveur après le démarrage). */
  const commitAvatar = () => {
    socket?.emit('player:avatar', { pin, avatar: avatarName });
    setSyncedSeed(avatarSeed);
  };

  // Nouvelle question → réinitialise la saisie locale.
  useEffect(() => {
    setSelected([]);
    setFreeValue('');
    setSubmitted(false);
  }, [view.questionIndex]);
  // L'ordre de départ suit l'arrivée de la question (remise en ordre).
  useEffect(() => {
    setOrder(question?.options?.map((o) => o.id) ?? []);
  }, [question]);

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setJoining(true);
    try {
      await joinSession(pin, nickname.trim(), avatarSeed || undefined);
      markJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre la partie.');
    } finally {
      setJoining(false);
    }
  };

  const submit = (answer: string | string[] | number) => {
    setSubmitted(true);
    socket?.emit('player:submit', { pin, questionIndex: view.questionIndex, answer });
  };

  // QCM unique / V-F / sondage : le tap soumet ; multi-réponses : le tap (dé)sélectionne,
  // la soumission attend le bouton « Valider » (sinon on perdrait au 1ᵉʳ clic — RG-06).
  const onPick = (optionId: string) => {
    if (isMulti) {
      setSelected((prev) =>
        prev.includes(optionId) ? prev.filter((x) => x !== optionId) : [...prev, optionId],
      );
    } else {
      setSelected([optionId]);
      submit(optionId);
    }
  };

  const moveOrder = (i: number, dir: -1 | 1) =>
    setOrder((prev) => {
      const next = [...prev];
      const target = i + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });

  /** Widget de réponse selon le type de question (§4/§5.3). */
  const renderAnswerInput = () => {
    if (!question) return <p className="text-muted-foreground">En attente de la question…</p>;
    const opts = question.options ?? [];

    // Saisie libre : numérique (nombre) ou texte.
    if (question.type === 'numeric' || question.type === 'text_input') {
      const numeric = question.type === 'numeric';
      const valid = numeric
        ? freeValue.trim() !== '' && Number.isFinite(Number(freeValue))
        : freeValue.trim() !== '';
      return (
        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            submit(numeric ? Number(freeValue) : freeValue.trim());
          }}
        >
          <Input
            value={freeValue}
            onChange={(e) => setFreeValue(e.target.value)}
            type={numeric ? 'number' : 'text'}
            inputMode={numeric ? 'decimal' : 'text'}
            placeholder={numeric ? 'Ta réponse (nombre)' : 'Ta réponse'}
            className="text-center text-lg"
          />
          <Button type="submit" disabled={!valid}>
            Valider ma réponse
          </Button>
        </form>
      );
    }

    // Remise en ordre : liste réordonnable (monter/descendre) puis valider.
    if (question.type === 'ordering' && opts.length) {
      const ordered = order.length ? order : opts.map((o) => o.id);
      return (
        <div className="flex w-full flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {ordered.map((id, i) => {
              const o = opts.find((x) => x.id === id);
              if (!o) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="flex-1 text-left">{o.text ?? o.color}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Monter"
                    disabled={i === 0}
                    onClick={() => moveOrder(i, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Descendre"
                    disabled={i === ordered.length - 1}
                    onClick={() => moveOrder(i, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button type="button" onClick={() => submit(ordered)}>
            Valider ma réponse
          </Button>
        </div>
      );
    }

    // À options (QCM unique/multi, V-F, sondage).
    if (opts.length) {
      return (
        <>
          <OptionGrid options={opts} onPick={onPick} selectedIds={selected} />
          {isMulti ? (
            <Button type="button" disabled={selected.length === 0} onClick={() => submit(selected)}>
              Valider ma réponse
            </Button>
          ) : null}
        </>
      );
    }

    return <p className="text-muted-foreground">Type de question non pris en charge.</p>;
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
            <div className="flex flex-col items-center gap-2">
              <Avatar name={avatarName} size={88} />
              <Button type="button" variant="outline" size="sm" onClick={randomizeAvatar}>
                <Shuffle className="size-4" />
                Avatar aléatoire
              </Button>
            </div>
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

  // Exclu par l'hôte : écran terminal (la session locale a été purgée, pas de reprise).
  if (view.kicked) {
    return wrap(
      <>
        <span className="text-7xl leading-none" aria-hidden>
          🚫
        </span>
        <p className="text-xl font-semibold">Tu as été exclu de la partie.</p>
        <p className="text-muted-foreground">
          L’animateur t’a banni pour {view.kicked.minutes} minute
          {view.kicked.minutes > 1 ? 's' : ''}.
        </p>
      </>,
    );
  }

  // ── États de jeu ───────────────────────────────────────────────────────────
  if (view.state === 'HOST_DISCONNECTED') {
    return wrap(
      <p className="text-xl font-semibold">Présentateur déconnecté — partie en pause.</p>,
    );
  }
  // Fin de partie (podium ou terminée) : on propose de noter le quiz. Les deux états
  // partagent la même structure pour que le panneau d'avis (et le commentaire en
  // cours de saisie) survive à la transition PODIUM → ENDED déclenchée par l'hôte.
  if (view.state === 'PODIUM' || view.state === 'ENDED') {
    return wrap(
      <>
        {view.state === 'PODIUM' ? (
          <>
            <span className="text-7xl leading-none" aria-hidden>
              🏆
            </span>
            <Avatar name={avatarName} size={72} />
            <h2 className="text-2xl font-bold">Podium</h2>
            {view.podium?.you ? (
              <p className="text-lg">
                Ton classement : <span className="font-semibold">{view.podium.you.rank}ᵉ</span> —{' '}
                {view.podium.you.score} pts
              </p>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-7xl leading-none" aria-hidden>
              🎉
            </span>
            <p className="text-xl font-semibold">Merci d’avoir joué !</p>
          </>
        )}
        <RatingPanel pin={pin} socket={socket} />
      </>,
    );
  }

  if (view.state === 'REVEAL' || view.state === 'LEADERBOARD') {
    const r = view.result;
    // Classement perso : `you` (du leaderboard) est toujours présent au reveal, même
    // si le joueur n'a pas répondu (pas de `result`). On l'affiche systématiquement.
    const you = view.leaderboard?.you;
    return wrap(
      <div className="flex flex-col items-center gap-3">
        {r ? (
          <>
            <span
              className={`text-7xl leading-none ${r.correct ? 'text-success' : 'text-destructive'}`}
              aria-hidden
            >
              {r.correct ? '✓' : '✗'}
            </span>
            <p className={`text-3xl font-bold ${r.correct ? 'text-success' : 'text-destructive'}`}>
              {r.correct ? 'Juste !' : 'Raté'}
            </p>
            <p className="text-xl">+{r.points} points</p>
          </>
        ) : (
          <p className="text-muted-foreground">Réponses révélées…</p>
        )}
        {you ? (
          <p className="border-t pt-3 text-2xl">
            Ton classement : <span className="font-bold">{you.rank}ᵉ</span>
            <span className="text-muted-foreground"> — {you.score} pts</span>
          </p>
        ) : r ? (
          <p className="text-muted-foreground">Rang : {r.rank}ᵉ</p>
        ) : null}
      </div>,
    );
  }

  if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && question) {
    const done = submitted || view.answerAccepted === true;
    // Layout en 3 zones, identique d'une question à l'autre (UX first) : le chrono
    // reste en haut, l'énoncé occupe le centre et **défile** s'il est long, la zone
    // de réponse est ancrée en bas (position constante, jamais repoussée hors écran).
    return (
      <section className="mx-auto flex h-full w-full max-w-sm flex-col gap-3 text-center">
        {remaining !== null ? (
          <span
            className="shrink-0 pt-2 text-4xl font-bold tabular-nums"
            aria-label="Temps restant"
          >
            ⏱ {remaining}
          </span>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h1 className="text-xl font-semibold text-balance">{question.prompt}</h1>
        </div>
        <div className="flex w-full shrink-0 flex-col items-center gap-3 pb-2">
          {done ? (
            <p className="text-xl font-semibold">Réponse enregistrée ✓</p>
          ) : (
            renderAnswerInput()
          )}
        </div>
      </section>
    );
  }

  if (view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') {
    return wrap(<p className="text-muted-foreground">En attente de la question…</p>);
  }

  // ── LOBBY / attente ──────────────────────────────────────────────────────────
  return wrap(
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Tu es dans la partie !</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <Avatar name={avatarName} size={72} />
        {nickname ? <p className="text-lg font-semibold">« {nickname} »</p> : null}
        {/* Avatar modifiable tant que la partie n'a pas démarré : on randomise en local
            puis on synchronise explicitement (évite d'inonder le serveur à chaque clic). */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={randomizeAvatar}>
            <Shuffle className="size-4" />
            Avatar aléatoire
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={commitAvatar}
            disabled={avatarSeed === syncedSeed}
            aria-label="Enregistrer l’avatar"
            title="Enregistrer l’avatar"
          >
            <Check className="size-4" />
          </Button>
        </div>
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
