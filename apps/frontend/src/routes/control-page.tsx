import type { GameMode, OutlineQuestion } from '@roux-quizz/contracts';
import { Link, useParams } from '@tanstack/react-router';
import {
  Check,
  Eye,
  Gauge,
  Hand,
  Pause,
  Play,
  Radio,
  Share2,
  SkipForward,
  Square,
  Users,
} from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LeaderboardList, Podium, RevealAnswer } from '../game/live-components';
import { useGameRemaining } from '../game/use-countdown';
import { type GameView, useGameSession } from '../game/use-game-session';

const TYPE_LABEL: Record<string, string> = {
  single_choice: 'QCM',
  multiple_choice: 'QCM multi',
  true_false: 'Vrai / Faux',
  text_input: 'Saisie',
  numeric: 'Numérique',
  ordering: 'Ordre',
  poll: 'Sondage',
};

/** Boutons d'ajustement du chrono (§8) : retire/ajoute des secondes en direct. */
const CHRONO_STEPS = [-5, -1, 1, 5] as const;

/**
 * Console d'animation (hôte, §3). Tableau de bord de **contrôle** privé : récap du
 * quiz, déroulé des questions, rythme (manuel/auto), pause et ajustement du chrono.
 * Volontairement distinct du grand écran à vidéoprojeter (`/present/$pin/screen`) —
 * le QR d'invitation y reste discret (simple info), pour ne pas confondre les deux.
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
  const setMode = (mode: GameMode) => socket?.emit('host:mode', { pin, mode });
  const setPaused = (paused: boolean) => socket?.emit('host:pause', { pin, paused });
  const adjustTime = (deltaS: number) => socket?.emit('host:adjust-time', { pin, deltaS });

  const remaining = useGameRemaining(view);

  const openScreen = () => window.open(screenUrl, '_blank', 'noopener,noreferrer');
  const screenButton = (
    <Button type="button" variant="outline" size="sm" onClick={openScreen}>
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

  const controlBar = (
    <ControlBar
      view={view}
      pin={pin}
      onMode={setMode}
      onPause={setPaused}
      screenButton={screenButton}
    />
  );

  // ── LOBBY ────────────────────────────────────────────────────────────────
  if (view.state === 'LOBBY' || view.state === null) {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
        <RecapHeader view={view} pin={pin} />

        {/* Invitation discrète : simple info, pas le grand écran de projection. */}
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Inviter les joueurs</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => void onShare()}>
              <Share2 className="size-4" />
              Partager
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <div className="rounded-md border bg-white p-2">
              <QRCodeSVG value={joinUrl} size={88} aria-label="QR code pour rejoindre" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs uppercase tracking-widest">
                {window.location.host}/join
              </span>
              <span className="font-mono text-3xl font-bold tracking-[0.2em]" aria-label="Code PIN">
                {pin}
              </span>
            </div>
          </div>
          {shareNote ? <p className="text-muted-foreground text-sm">{shareNote}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <PlayersBadge count={view.players.length} />
          <ul className="flex flex-wrap gap-2">
            {view.players.map((p) => (
              <li key={p.playerId} className="rounded-full border px-3 py-1 text-sm">
                {p.nickname}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <ModeToggle mode={view.mode} onChange={setMode} />
          <div className="flex items-center gap-2">
            {screenButton}
            <Button
              type="button"
              variant="main-action"
              disabled={view.players.length === 0}
              onClick={() => emit('host:start')}
            >
              <Play className="size-4" />
              Démarrer la partie
            </Button>
          </div>
        </div>
        <QRCodeCanvas value={joinUrl} size={512} ref={qrCanvasRef} className="hidden" />
      </section>
    );
  }

  // ── HOST_DISCONNECTED ─────────────────────────────────────────────────────
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
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
        {controlBar}
        <QuestionCarousel outline={view.outline} currentIndex={view.questionIndex} />
        {view.question && view.reveal ? (
          <RevealAnswer question={view.question} reveal={view.reveal} />
        ) : null}
        {view.leaderboard ? (
          <div>
            <h2 className="mb-2 font-semibold">Classement</h2>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm">
            {view.mode === 'auto'
              ? view.paused
                ? 'Auto en pause — enchaînement suspendu.'
                : 'Enchaînement automatique…'
              : null}
          </span>
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
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-8">
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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
      {controlBar}
      <QuestionCarousel outline={view.outline} currentIndex={view.questionIndex} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          Question {view.questionIndex + 1} / {view.totalQuestions}
        </span>
        <ChronoControls remaining={remaining} paused={view.paused} onAdjust={adjustTime} />
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

/** Compteur de joueurs connectés (testid stable pour les tests/diagnostics). */
function PlayersBadge({ count }: { count: number }) {
  return (
    <span className="text-muted-foreground flex items-center gap-2 text-sm">
      <Users className="size-4" />
      <span data-testid="player-count">{count}</span>
      <span>joueur(s) connecté(s)</span>
    </span>
  );
}

/** Récap compact du quiz (titre + PIN) — en-tête du tableau de bord. */
function RecapHeader({ view, pin }: { view: GameView; pin: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold">{view.quizTitle ?? 'Partie en cours'}</span>
      <span className="text-muted-foreground text-sm">
        PIN <span className="font-mono tracking-widest">{pin}</span>
        {view.outline.length > 0 ? ` · ${view.outline.length} question(s)` : null}
      </span>
    </div>
  );
}

/** Barre de contrôle persistante : récap + joueurs + rythme + pause + projection. */
function ControlBar({
  view,
  pin,
  onMode,
  onPause,
  screenButton,
}: {
  view: GameView;
  pin: string;
  onMode: (mode: GameMode) => void;
  onPause: (paused: boolean) => void;
  screenButton: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <RecapHeader view={view} pin={pin} />
      <div className="flex flex-wrap items-center gap-2">
        <PlayersBadge count={view.players.length} />
        <ModeToggle mode={view.mode} onChange={onMode} />
        {view.mode === 'auto' ? <PauseButton paused={view.paused} onToggle={onPause} /> : null}
        {screenButton}
      </div>
    </header>
  );
}

/** Bascule du rythme manuel ⇄ auto (le présentateur peut reprendre la main, §8). */
function ModeToggle({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Rythme de la partie"
      className="border-input inline-flex overflow-hidden rounded-md border text-sm"
    >
      <button
        type="button"
        aria-pressed={mode === 'manual'}
        onClick={() => onChange('manual')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors',
          mode === 'manual'
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Hand className="size-4" />
        Manuel
      </button>
      <button
        type="button"
        aria-pressed={mode === 'auto'}
        onClick={() => onChange('auto')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors',
          mode === 'auto'
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Gauge className="size-4" />
        Auto
      </button>
    </div>
  );
}

/** Pause/reprise de l'auto-progression (must-have en mode auto, §8). */
function PauseButton({
  paused,
  onToggle,
}: {
  paused: boolean;
  onToggle: (paused: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant={paused ? 'main-action' : 'outline'}
      size="sm"
      aria-pressed={paused}
      onClick={() => onToggle(!paused)}
    >
      {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      {paused ? 'Reprendre' : 'Pause'}
    </Button>
  );
}

/** Ajustement du chrono en direct : [-5 -1 ⏱ +1 +5] (§8). */
function ChronoControls({
  remaining,
  paused,
  onAdjust,
}: {
  remaining: number | null;
  paused: boolean;
  onAdjust: (deltaS: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {CHRONO_STEPS.filter((s) => s < 0).map((s) => (
        <Button key={s} type="button" variant="outline" size="sm" onClick={() => onAdjust(s)}>
          {s}
        </Button>
      ))}
      <span
        className={cn(
          'min-w-14 text-center text-2xl font-bold tabular-nums',
          paused && 'opacity-60',
        )}
        aria-label="Temps restant"
      >
        ⏱ {remaining ?? '—'}
      </span>
      {CHRONO_STEPS.filter((s) => s > 0).map((s) => (
        <Button key={s} type="button" variant="outline" size="sm" onClick={() => onAdjust(s)}>
          +{s}
        </Button>
      ))}
    </div>
  );
}

/**
 * Déroulé du quiz : carrousel horizontal des questions pour **visualiser
 * l'avancement** (question faite / courante / à venir). Lecture seule — la machine
 * à états est linéaire, il n'y a pas de saut arbitraire vers une question.
 */
function QuestionCarousel({
  outline,
  currentIndex,
}: {
  outline: OutlineQuestion[];
  currentIndex: number;
}) {
  if (outline.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-sm font-semibold">Déroulé du quiz</h2>
      <ol className="flex snap-x gap-2 overflow-x-auto pb-2">
        {outline.map((q) => {
          const done = q.index < currentIndex;
          const current = q.index === currentIndex;
          return (
            <li
              key={q.index}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex w-44 shrink-0 snap-start flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                current && 'border-primary bg-primary/5 ring-primary ring-1',
                done && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">Q{q.index + 1}</span>
                {done ? (
                  <Check className="text-success size-4" aria-label="terminée" />
                ) : current ? (
                  <Radio className="text-primary size-4" aria-label="en cours" />
                ) : null}
              </div>
              <p className="line-clamp-2">{q.prompt}</p>
              <span className="text-muted-foreground text-xs">
                ⏱ {q.timeLimitS}s · {TYPE_LABEL[q.type] ?? q.type}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
