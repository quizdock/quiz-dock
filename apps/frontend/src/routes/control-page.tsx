import type { GameMode, OutlineQuestion } from '@quiz-dock/contracts';
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
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { APP_NAME } from '../config';
import { Avatar } from '../game/avatar';
import { LeaderboardList, OptionGrid, Podium, RevealAnswer } from '../game/live-components';
import { useGameRemaining } from '../game/use-countdown';
import { type GameView, useGameSession } from '../game/use-game-session';

/** Boutons d'ajustement du chrono (§8) : retire/ajoute des secondes en direct. */
const CHRONO_STEPS = [-5, -1, 1, 5] as const;

/**
 * Console d'animation (hôte, §3). Tableau de bord de **contrôle** privé : récap du
 * quiz, déroulé des questions, rythme (manuel/auto), pause et ajustement du chrono.
 * Volontairement distinct du grand écran à vidéoprojeter (`/present/$pin/screen`) —
 * le QR d'invitation y reste discret (simple info), pour ne pas confondre les deux.
 */
export function ControlPage() {
  const { t } = useTranslation(['live', 'common']);
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
    <Tooltip label={t('control.screenButtonTooltip')}>
      <Button type="button" variant="outline" size="sm" onClick={openScreen}>
        <Eye className="size-4" />
        {t('control.screenButton')}
      </Button>
    </Tooltip>
  );

  const qrFile = async (): Promise<File | null> => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return null;
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      return blob ? new File([blob], `quiz-dock-${pin}.png`, { type: 'image/png' }) : null;
    } catch {
      return null;
    }
  };

  const onShare = async () => {
    const text = [
      t('control.shareText', { appName: APP_NAME }),
      t('control.sharePin', { pin }),
      t('control.shareLink', { url: joinUrl }),
    ].join('\n');
    const data: ShareData = {
      title: t('control.shareTitle', { appName: APP_NAME }),
      text,
      url: joinUrl,
    };
    const file = await qrFile();
    const withFile = file ? { ...data, files: [file] } : null;
    try {
      if (withFile && navigator.canShare?.(withFile)) {
        await navigator.share(withFile);
      } else if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(text);
        setShareNote(t('control.shareCopied'));
      }
    } catch {
      /* partage annulé / non supporté */
    }
  };

  if (view.status === 'connecting') {
    return <p className="text-muted-foreground py-16 text-center">{t('control.connecting')}</p>;
  }
  if (view.status === 'error') {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">{view.error ?? t('control.sessionUnavailable')}</p>
        <Link to="/dashboard" className="underline">
          {t('control.backToQuizzes')}
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
            <h2 className="font-semibold">{t('control.inviteParticipants')}</h2>
            <Tooltip label={t('control.shareTooltip')}>
              <Button type="button" variant="outline" size="sm" onClick={() => void onShare()}>
                <Share2 className="size-4" />
                {t('control.share')}
              </Button>
            </Tooltip>
          </div>
          <div className="flex items-center gap-4">
            <Tooltip label={t('control.shareScreenTooltip')} side="bottom">
              <div className="rounded-md border bg-white p-2">
                <QRCodeSVG value={joinUrl} size={88} aria-label={t('control.qrLabel')} />
              </div>
            </Tooltip>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs uppercase tracking-widest">
                {window.location.host}/join
              </span>
              <span
                className="font-mono text-3xl font-bold tracking-[0.2em]"
                aria-label={t('control.pinLabel')}
              >
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
            <span className="font-medium">{t('control.captureLabel')}</span>
            <span className="text-muted-foreground block">{t('control.captureHint')}</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <ModeToggle mode={view.mode} onChange={setMode} />
          <div className="flex items-center gap-2">
            <EndGameButton label={t('control.stopSession')} onConfirm={endGame} />
            {screenButton}
            <Tooltip label={t('control.startTooltip')}>
              <Button
                type="button"
                variant="main-action"
                disabled={view.players.length === 0}
                onClick={() => emit('host:start')}
              >
                <Play className="size-4" />
                {t('control.start')}
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
      <p className="text-muted-foreground py-16 text-center">{t('control.hostDisconnected')}</p>
    );
  }

  // ── ENDED ─────────────────────────────────────────────────────────────────
  if (view.state === 'ENDED') {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-xl font-semibold">{t('control.sessionEnded')}</p>
        <Link to="/dashboard" className="underline">
          {t('control.backToQuizzes')}
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
            <h2 className="mb-2 font-semibold">{t('control.leaderboard')}</h2>
            <LeaderboardList rows={view.leaderboard.top} />
          </div>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {view.mode === 'auto' && view.paused ? (
              <span className="text-muted-foreground text-sm">{t('control.autoPaused')}</span>
            ) : view.mode === 'auto' && view.autoNextAt ? (
              <AutoAdvanceCountdown deadline={view.autoNextAt} totalMs={view.autoNextMs ?? 0} />
            ) : null}
          </div>
          <Button type="button" onClick={() => emit('host:next')}>
            <SkipForward className="size-4" />
            {t('control.nextQuestion')}
          </Button>
        </div>
      </section>
    );
  }

  // ── PODIUM ──────────────────────────────────────────────────────────────────
  if (view.state === 'PODIUM') {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-8">
        <h2 className="text-2xl font-bold">{t('control.podium')}</h2>
        {view.podium ? <Podium rows={view.podium.podium} /> : null}
        <EndGameButton label={t('control.endSession')} offerArchive onConfirm={endGame} />
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
            {t('control.questionProgress', {
              current: view.questionIndex + 1,
              total: view.totalQuestions,
            })}
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
          <p className="text-muted-foreground text-sm">{t('control.freeAnswer')}</p>
        )}

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('control.answersReceived')}</span>
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
          {t('control.revealNow')}
        </Button>
        <EndGameButton label={t('control.endSession')} offerArchive onConfirm={endGame} />
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
  const { t } = useTranslation('live');
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
        {t('control.autoNextIn')}{' '}
        <span className="tabular-nums">{Math.ceil(remainingMs / 1000)}</span> {t('control.seconds')}
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
  const { t } = useTranslation('live');
  return (
    <span className="text-muted-foreground flex items-center gap-2 text-sm">
      <Users className="size-4" />
      <span data-testid="player-count">{count}</span>
      <span>{t('control.participantsConnected', { count })}</span>
    </span>
  );
}

/** Récap compact du quiz (titre + PIN) — en-tête du tableau de bord. */
function RecapHeader({ view, pin }: { view: GameView; pin: string }) {
  const { t } = useTranslation('live');
  return (
    <div className="flex flex-col gap-0.5">
      <h1 className="text-xl font-bold">{view.quizTitle ?? t('control.sessionInProgress')}</h1>
      {view.quizDescription ? (
        <p className="text-muted-foreground max-w-prose text-sm">{view.quizDescription}</p>
      ) : null}
      <span className="text-muted-foreground text-sm">
        PIN <span className="font-mono tracking-widest">{pin}</span>
        {view.outline.length > 0
          ? ` · ${t('control.outlineQuestionCount', { count: view.outline.length })}`
          : null}
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
  const { t } = useTranslation('live');
  return (
    // Pas d'`overflow-hidden` ici : il rognerait les infobulles (positionnées en
    // absolu) des boutons. L'arrondi est porté par les boutons d'extrémité.
    <div
      role="group"
      aria-label={t('control.rhythmGroup')}
      className="border-input inline-flex rounded-md border text-sm"
    >
      <Tooltip label={t('control.modeManualTooltip')}>
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
          {t('control.modeManual')}
        </button>
      </Tooltip>
      <Tooltip label={t('control.modeAutoTooltip')}>
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
          {t('control.modeAuto')}
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
  players: { playerId: string; nickname: string; avatar?: string }[];
  onBan: (playerId: string, minutes: number) => void;
}) {
  const { t } = useTranslation('live');
  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('control.noParticipants')}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {players.map((p) => (
        <li
          key={p.playerId}
          className="flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-1 text-sm"
        >
          <Avatar name={p.avatar || p.nickname} size={24} />
          <span className="max-w-[8rem] truncate">{p.nickname}</span>
          <BanButton nickname={p.nickname} onBan={(m) => onBan(p.playerId, m)} />
        </li>
      ))}
    </ul>
  );
}

/** Bouton + `<dialog>` de confirmation pour bannir un joueur (durée en minutes, RG-12). */
function BanButton({ nickname, onBan }: { nickname: string; onBan: (minutes: number) => void }) {
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  return (
    <>
      <Tooltip label={t('control.banTooltip', { nickname })}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('control.banAria', { nickname })}
          onClick={() => setOpen(true)}
          className="size-6 rounded-full"
        >
          <Ban className="text-destructive size-3.5" />
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={t('control.banConfirmTitle', { nickname })}
        description={t('control.banConfirmDescription')}
        confirmLabel={t('control.banConfirm')}
        cancelLabel={t('common:cancel')}
        onConfirm={() => {
          setOpen(false);
          onBan(minutes);
        }}
        onCancel={() => setOpen(false)}
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">{t('control.banDuration')}</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Math.min(1440, Math.max(1, Number(e.target.value) || 1)))}
            className="border-input w-20 rounded-md border px-2 py-1"
          />
          <span className="text-muted-foreground">{t('control.banMinutes')}</span>
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
  players: { playerId: string; nickname: string; avatar?: string }[];
  onBan: (playerId: string, minutes: number) => void;
}) {
  const { t } = useTranslation('live');
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Tooltip label={t('control.participantsTooltip')}>
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
  const { t } = useTranslation(['live', 'common']);
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState(true);
  return (
    <>
      <Tooltip label={t('control.endTooltip')}>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Square className="size-4" />
          {label}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        destructive
        title={t('control.endConfirmTitle', { label })}
        description={t('control.endConfirmDescription')}
        confirmLabel={label}
        cancelLabel={t('common:cancel')}
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
              <span className="font-medium">{t('control.archiveLabel')}</span>
              <span className="text-muted-foreground block">{t('control.archiveHint')}</span>
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
  const { t } = useTranslation('live');
  return (
    <Button
      type="button"
      variant={paused ? 'main-action' : 'outline'}
      size="sm"
      aria-pressed={paused}
      onClick={() => onToggle(!paused)}
    >
      {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      {paused ? t('control.resume') : t('control.pause')}
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
  const { t } = useTranslation('live');
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
        aria-label={t('control.timeRemaining')}
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
  const { t } = useTranslation('live');
  if (outline.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-sm font-semibold">{t('control.outline')}</h2>
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
                  <Check className="text-success size-4" aria-label={t('control.questionDone')} />
                ) : current ? (
                  <Radio
                    className="text-primary size-4"
                    aria-label={t('control.questionCurrent')}
                  />
                ) : null}
              </div>
              <p className="line-clamp-2">{q.prompt}</p>
              <span className="text-muted-foreground text-xs">
                ⏱ {q.timeLimitS}s · {t(`control.types.${q.type}`, { defaultValue: q.type })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
