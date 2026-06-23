import type { GameMode, OutlineQuestion } from '@roux-quizz/contracts';
import { Link, useParams } from '@tanstack/react-router';
import {
  Ban,
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
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Avatar } from '../game/avatar';
import { LeaderboardList, OptionGrid, Podium, RevealAnswer } from '../game/live-components';
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
  const emit = (event: 'host:start' | 'host:reveal' | 'host:next') => socket?.emit(event, { pin });
  const endGame = (archive: boolean) => socket?.emit('host:end', { pin, archive });
  const setMode = (mode: GameMode) => socket?.emit('host:mode', { pin, mode });
  const setCapture = (fullCapture: boolean) => socket?.emit('host:capture', { pin, fullCapture });
  const banPlayer = (playerId: string, minutes: number) =>
    socket?.emit('host:ban', { pin, playerId, minutes });
  const setPaused = (paused: boolean) => socket?.emit('host:pause', { pin, paused });
  const adjustTime = (deltaS: number) => socket?.emit('host:adjust-time', { pin, deltaS });

  const remaining = useGameRemaining(view);

  const openScreen = () => window.open(screenUrl, '_blank', 'noopener,noreferrer');
  const screenButton = (
    <Tooltip label="Ouvre le grand écran à vidéoprojeter (vue spectateur)">
      <Button type="button" variant="outline" size="sm" onClick={openScreen}>
        <Eye className="size-4" />
        Écran de projection
      </Button>
    </Tooltip>
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
      onBan={banPlayer}
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
            <Tooltip label="Partager l'invitation (PIN + lien) par le système de partage ou le presse-papier">
              <Button type="button" variant="outline" size="sm" onClick={() => void onShare()}>
                <Share2 className="size-4" />
                Partager
              </Button>
            </Tooltip>
          </div>
          <div className="flex items-center gap-4">
            <Tooltip label="Ouvrir l'écran de projection pour partager le QRcode" side="bottom">
              <div className="rounded-md border bg-white p-2">
                <QRCodeSVG value={joinUrl} size={88} aria-label="QR code pour rejoindre" />
              </div>
            </Tooltip>
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
          <ParticipantsList players={view.players} onBan={banPlayer} />
        </div>

        {/* Capture intégrale (§3.1 / RG-13) : choix avant le démarrage, verrouillé une
            fois la partie lancée (cette vue lobby disparaît au start). Les joueurs déjà
            connectés sont informés en direct (avis de consentement §2.10). */}
        <label className="flex items-start gap-2 rounded-lg border p-4 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={view.fullCapture}
            onChange={(e) => setCapture(e.target.checked)}
          />
          <span>
            <span className="font-medium">
              Enregistrer toutes les réponses (audit / certification)
            </span>
            <span className="text-muted-foreground block">
              ⓘ Les apprenants en seront informés au démarrage. Conserve le détail des réponses de
              chaque participant pour le suivi de formation.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <ModeToggle mode={view.mode} onChange={setMode} />
          <div className="flex items-center gap-2">
            <EndGameButton label="Arrêter la partie" onConfirm={endGame} />
            {screenButton}
            <Tooltip label="Attendez que le maximum de joueurs soient connectés avant de démarrer">
              <Button
                type="button"
                variant="main-action"
                disabled={view.players.length === 0}
                onClick={() => emit('host:start')}
              >
                <Play className="size-4" />
                Démarrer la partie
              </Button>
            </Tooltip>
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
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {view.mode === 'auto' && view.paused ? (
              <span className="text-muted-foreground text-sm">
                Auto en pause — enchaînement suspendu.
              </span>
            ) : view.mode === 'auto' && view.autoNextAt ? (
              <AutoAdvanceCountdown deadline={view.autoNextAt} totalMs={view.autoNextMs ?? 0} />
            ) : null}
          </div>
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
        <EndGameButton label="Terminer la partie" offerArchive onConfirm={endGame} />
      </section>
    );
  }

  // ── ANSWERING / QUESTION_SHOW ──────────────────────────────────────────────
  const timeLimit = view.question?.timeLimitS ?? 0;
  const answered = view.answerCount?.answered ?? 0;
  const totalPlayers = view.answerCount?.total ?? view.players.length;
  const timePct = remaining != null && timeLimit > 0 ? (remaining / timeLimit) * 100 : 0;
  const timeTone = view.paused
    ? 'bg-muted-foreground'
    : timePct <= 20
      ? 'bg-destructive'
      : timePct <= 50
        ? 'bg-amber-500'
        : 'bg-success';
  const answeredPct = totalPlayers > 0 ? (answered / totalPlayers) * 100 : 0;
  // Bonne réponse mise en avant pour l'animateur (clé de correction du sommaire hôte).
  const correctIds = view.outline.find((q) => q.index === view.questionIndex)?.correctOptionIds;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
      {controlBar}

      {/* Question en cours — panneau principal agrandi (énoncé + réponses + chrono). */}
      <article className="bg-card flex flex-col gap-4 rounded-xl border p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm font-medium">
            Question {view.questionIndex + 1} / {view.totalQuestions}
          </span>
          <ChronoControls remaining={remaining} paused={view.paused} onAdjust={adjustTime} />
        </div>

        <ProgressBar pct={timePct} barClassName={timeTone} />

        {view.question?.media?.kind === 'image' ? (
          <img
            src={view.question.media.url}
            alt=""
            className="max-h-56 self-center object-contain"
          />
        ) : null}

        <h1 className="text-2xl font-semibold sm:text-3xl">{view.question?.prompt}</h1>

        {view.question?.options?.length ? (
          <OptionGrid options={view.question.options} highlightIds={correctIds} />
        ) : (
          <p className="text-muted-foreground text-sm">Réponse libre (numérique ou texte).</p>
        )}

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Réponses reçues</span>
            <span className="font-semibold tabular-nums">
              {answered} / {totalPlayers}
            </span>
          </div>
          <ProgressBar pct={answeredPct} barClassName="bg-primary" />
        </div>
      </article>

      {/* Déroulé du quiz (vue d'ensemble). */}
      <QuestionCarousel outline={view.outline} currentIndex={view.questionIndex} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => emit('host:reveal')}>
          <Eye className="size-4" />
          Révéler maintenant
        </Button>
        <EndGameButton label="Terminer la partie" offerArchive onConfirm={endGame} />
      </div>
    </section>
  );
}

/**
 * Compte à rebours d'enchaînement automatique (mode auto, §8) : « suivante dans N s »
 * + barre qui se vide. Tic local 100 ms pour une barre fluide, borné sur la deadline
 * serveur autoritaire.
 */
function AutoAdvanceCountdown({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, deadline - now);
  const pct = totalMs > 0 ? (remainingMs / totalMs) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-sm">
        Question suivante dans <span className="tabular-nums">{Math.ceil(remainingMs / 1000)}</span>{' '}
        s
      </span>
      <ProgressBar pct={pct} barClassName="bg-primary" />
    </div>
  );
}

/** Barre de progression générique (piste neutre + remplissage coloré animé). */
function ProgressBar({ pct, barClassName }: { pct: number; barClassName?: string }) {
  return (
    <div
      className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', barClassName)}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
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
    <div className="flex flex-col gap-0.5">
      <h1 className="text-xl font-bold">{view.quizTitle ?? 'Partie en cours'}</h1>
      {view.quizDescription ? (
        <p className="text-muted-foreground max-w-prose text-sm">{view.quizDescription}</p>
      ) : null}
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
  onBan,
  screenButton,
}: {
  view: GameView;
  pin: string;
  onMode: (mode: GameMode) => void;
  onPause: (paused: boolean) => void;
  onBan: (playerId: string, minutes: number) => void;
  screenButton: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <RecapHeader view={view} pin={pin} />
      <div className="flex flex-wrap items-center gap-2">
        <ParticipantsControl players={view.players} onBan={onBan} />
        <ModeToggle mode={view.mode} onChange={onMode} />
        {/* Pause utile dès qu'il y a quelque chose à figer : le chrono d'une question
            en cours (ANSWERING, tous modes) ou l'enchaînement auto (mode auto). */}
        {view.mode === 'auto' || view.state === 'ANSWERING' ? (
          <PauseButton paused={view.paused} onToggle={onPause} />
        ) : null}
        {screenButton}
      </div>
    </header>
  );
}

/** Bascule du rythme manuel ⇄ auto (le présentateur peut reprendre la main, §8). */
function ModeToggle({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }) {
  return (
    // Pas d'`overflow-hidden` ici : il rognerait les infobulles (positionnées en
    // absolu) des boutons. L'arrondi est porté par les boutons d'extrémité.
    <div
      role="group"
      aria-label="Rythme de la partie"
      className="border-input inline-flex rounded-md border text-sm"
    >
      <Tooltip label="Mode manuel : vous passez vous-même à la question suivante">
        <button
          type="button"
          aria-pressed={mode === 'manual'}
          onClick={() => onChange('manual')}
          className={cn(
            'flex items-center gap-1.5 rounded-l-md px-3 py-1.5 font-medium transition-colors',
            mode === 'manual'
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Hand className="size-4" />
          Manuel
        </button>
      </Tooltip>
      <Tooltip label="Mode auto : passage automatique à la question suivante après chaque résultat">
        <button
          type="button"
          aria-pressed={mode === 'auto'}
          onClick={() => onChange('auto')}
          className={cn(
            'flex items-center gap-1.5 rounded-r-md px-3 py-1.5 font-medium transition-colors',
            mode === 'auto'
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Gauge className="size-4" />
          Auto
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Fin de partie (§7) : action **destructive** — gardée par une infobulle d'avertissement
 * et une modale de confirmation. À la confirmation, la partie est détruite (PIN invalidé,
 * joueurs déconnectés). Les résultats ne sont pas conservés (archivage à venir, cf. §2.x).
 */
/** Liste des participants avec action de bannissement (lobby + console en jeu). */
function ParticipantsList({
  players,
  onBan,
}: {
  players: { playerId: string; nickname: string }[];
  onBan: (playerId: string, minutes: number) => void;
}) {
  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun joueur connecté.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {players.map((p) => (
        <li
          key={p.playerId}
          className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
        >
          <Avatar name={p.nickname} size={24} />
          <span className="min-w-0 flex-1 truncate text-left">{p.nickname}</span>
          <BanButton nickname={p.nickname} onBan={(m) => onBan(p.playerId, m)} />
        </li>
      ))}
    </ul>
  );
}

/** Bouton + `<dialog>` de confirmation pour bannir un joueur (durée en minutes, RG-12). */
function BanButton({ nickname, onBan }: { nickname: string; onBan: (minutes: number) => void }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  return (
    <>
      <Tooltip label={`Exclure ${nickname}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Bannir ${nickname}`}
          onClick={() => setOpen(true)}
        >
          <Ban className="text-destructive size-4" />
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={`Bannir ${nickname} ?`}
        description="Le joueur est exclu immédiatement et ne pourra pas revenir avec ce pseudo pendant la durée choisie."
        confirmLabel="Bannir"
        cancelLabel="Annuler"
        onConfirm={() => {
          setOpen(false);
          onBan(minutes);
        }}
        onCancel={() => setOpen(false)}
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Durée du ban</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Math.min(1440, Math.max(1, Number(e.target.value) || 1)))}
            className="border-input w-20 rounded-md border px-2 py-1"
          />
          <span className="text-muted-foreground">minutes</span>
        </label>
      </ConfirmDialog>
    </>
  );
}

/** Accès aux participants depuis la barre de contrôle : permet de bannir en cours de partie. */
function ParticipantsControl({
  players,
  onBan,
}: {
  players: { playerId: string; nickname: string }[];
  onBan: (playerId: string, minutes: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Tooltip label="Participants (exclure un joueur)">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          <Users className="size-4" />
          {players.length}
        </Button>
      </Tooltip>
      {open ? (
        <div className="bg-background absolute right-0 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border p-2 shadow-lg">
          <ParticipantsList players={players} onBan={onBan} />
        </div>
      ) : null}
    </div>
  );
}

function EndGameButton({
  label,
  offerArchive,
  onConfirm,
}: {
  label: string;
  /** Propose d'archiver les résultats (pertinent dès qu'une partie a été jouée). */
  offerArchive?: boolean;
  onConfirm: (archive: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState(true);
  return (
    <>
      <Tooltip label="Attention : la partie sera détruite (PIN invalidé, joueurs déconnectés). Action irréversible.">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Square className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={`${label} ?`}
        description="La partie sera définitivement terminée : le PIN est invalidé et les joueurs sont déconnectés. Cette action est irréversible."
        confirmLabel={label}
        cancelLabel="Annuler"
        onConfirm={() => {
          setOpen(false);
          onConfirm(offerArchive ? archive : false);
        }}
        onCancel={() => setOpen(false)}
      >
        {offerArchive ? (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
            />
            <span>
              <span className="font-medium">Archiver les résultats de cette partie</span>
              <span className="text-muted-foreground block">
                Classement et statistiques resteront consultables après la partie.
              </span>
            </span>
          </label>
        ) : null}
      </ConfirmDialog>
    </>
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
