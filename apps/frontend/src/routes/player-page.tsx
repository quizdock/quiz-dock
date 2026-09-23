import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type PlayerPresence, playsSound } from '@quiz-dock/contracts';
import { Check, LogIn, LogOut, Shuffle, Users, Volume2, VolumeX, Wifi } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '../game/avatar';
import {
  joinSession,
  clearPlayerSession,
  loadAvatarSeed,
  loadNickname,
  loadPlayerSession,
  peekSession,
  saveAvatarSeed,
} from '../game/game-client';
import { ResultMark } from '../game/result-mark';
import { SortableAnswer } from '../game/sortable-answer';
import {
  AnswerExplanation,
  AnswerRules,
  QuestionMedia,
  OptionGrid,
  RevealAnswer,
  SlideView,
  TYPE_BASE,
} from '../game/live-components';
import { cn } from '@/lib/utils';
import { Surface } from '../game/surface';
import { unlockAudio } from '../game/media/audio-unlock';
import { claimMediaElements } from '../game/media/media-pool';
import { QuestionMediaStage } from '../game/media/question-media-stage';
import { RatingPanel } from '../game/rating-panel';
import { useCountdown, useGameRemaining } from '../game/use-countdown';
import { type GameView, useGameSession } from '../game/use-game-session';
import { getAuthMode } from '../auth/auth-context';

/**
 * Avis de transparence (§2.10, RG-16) : ce que la session enregistre de ce
 * participant. Sans compte (mode local) rien n'est rattaché à un compte : le texte
 * parle du pseudo, faute de quoi il promettrait l'inverse de ce qui se passe.
 */
function trackingNotice(
  t: (key: string) => string,
  view: Pick<GameView, 'personalTracking' | 'fullCapture'>,
): string {
  if (!view.personalTracking) return t('player.noTrackingNotice');
  const account = getAuthMode() === 'oidc';
  if (view.fullCapture) return t(account ? 'player.captureNotice' : 'player.captureNoticeGuest');
  return t(account ? 'player.trackingNotice' : 'player.trackingNoticeGuest');
}

/**
 * Client participant (mobile, §5). Machine à états pilotée par `useGameSession` :
 * une session locale relance la partie (`player:reconnect`), sinon l'écran de join
 * (pseudo) s'affiche (§6.1). Après le join, on suit l'état serveur (attente →
 * réponse → feedback → podium), grille verrouillée à 1 réponse (RG-06).
 */
export function PlayerPage() {
  const { t } = useTranslation('live');
  const { pin } = useParams({ from: '/join/$pin' });
  const { view, socket, markJoined } = useGameSession(pin, 'player');
  const [nickname, setNickname] = useState(() => loadPlayerSession()?.nickname ?? loadNickname());
  const [joining, setJoining] = useState(false);
  // Asked only when the quiz plays sound: a remote player then gets it on their device.
  const [hasSound, setHasSound] = useState(false);
  const [wantedPresence, setPresence] = useState<PlayerPresence>('room');
  const [muted, setMuted] = useState(loadMuted);
  const toggleMuted = () => {
    setMuted(!muted);
    saveMuted(!muted);
  };
  // Leaving on purpose: the seat and the score are gone, so it is confirmed first.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const navigate = useNavigate();
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
  // Délai de lecture (§6/§8) : la fenêtre de réponse n'ouvre qu'à `startedAt`. Avant,
  // une réponse serait rejetée par le serveur (« trop tôt ») sans être comptée — on
  // bloque donc la saisie pendant la lecture pour ne jamais perdre de réponse.
  const readingLeft = useCountdown(question ? question.startedAt : null);
  const reading = readingLeft !== null && readingLeft > 0;
  // Avatar affiché : dans le lobby, la graine choisie localement (aperçu avant
  // enregistrement) ; une fois la partie lancée, **celle que le serveur connaît**
  // (la même que sur le podium, la projection et la console) — un rechargement
  // sans graine locale ou un choix non enregistré ne doivent pas diverger.
  const myId = loadPlayerSession()?.playerId;
  const serverAvatar = view.players.find((p) => p.playerId === myId)?.avatar;
  const inLobby = view.state === null || view.state === 'LOBBY';
  const avatarName =
    (inLobby ? avatarSeed || serverAvatar : serverAvatar || avatarSeed) || nickname || '?';

  // Graine déjà synchronisée vers le serveur (pour n'émettre que sur changement réel).
  const [syncedSeed, setSyncedSeed] = useState(avatarSeed);

  /**
   * Randomise l'avatar **localement** uniquement (aperçu + mémorisation) : pas
   * d'émission réseau ici, pour éviter d'inonder le serveur/animateur à chaque clic.
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

  const needsJoin = view.status === 'no-session';
  useEffect(() => {
    if (!needsJoin) return;
    let cancelled = false;
    // No answer (game over, network): the form stays as it was, the join says why.
    peekSession(pin)
      .then((res) => !cancelled && setHasSound(res.hasSound))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsJoin, pin]);

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    // Inside the click: the only moment a phone lets its media start with sound later.
    if (hasSound) {
      claimMediaElements();
      void unlockAudio();
    }
    setError(null);
    setJoining(true);
    try {
      const joined = await joinSession(
        pin,
        nickname.trim(),
        avatarSeed || undefined,
        hasSound ? wantedPresence : undefined,
      );
      // Le serveur a pu retenir un autre nom (compte, homonyme) : l'écran suit.
      if (joined.nickname && joined.nickname !== nickname.trim()) setNickname(joined.nickname);
      markJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('player.joinFailed'));
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

  /** Widget de réponse selon le type de question (§4/§5.3). */
  const renderAnswerInput = () => {
    if (!question) return <p className="text-muted-foreground">{t('player.waitingQuestion')}</p>;
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
            placeholder={
              numeric ? t('player.answerNumberPlaceholder') : t('player.answerPlaceholder')
            }
            className="text-center text-lg"
          />
          <Button type="submit" disabled={!valid}>
            {t('player.submitAnswer')}
          </Button>
        </form>
      );
    }

    // Remise en ordre : liste réordonnable (monter/descendre) puis valider.
    if (question.type === 'ordering' && opts.length) {
      const ordered = order.length ? order : opts.map((o) => o.id);
      return (
        <div className="flex w-full flex-col gap-[0.75em]">
          <SortableAnswer options={opts} order={ordered} onChange={setOrder} />
          <Button type="button" onClick={() => submit(ordered)}>
            {t('player.submitAnswer')}
          </Button>
        </div>
      );
    }

    // À options (QCM unique/multi, V-F, sondage).
    if (opts.length) {
      return (
        <>
          <OptionGrid options={opts} onPick={onPick} selectedIds={selected} layout="split" />
          {isMulti ? (
            <Button type="button" disabled={selected.length === 0} onClick={() => submit(selected)}>
              {t('player.submitAnswer')}
            </Button>
          ) : null}
        </>
      );
    }

    return <p className="text-muted-foreground">{t('player.unsupportedType')}</p>;
  };

  // `wide` lets a screen use a laptop's width (the reveal lays out side by side);
  // `center` places the content in the middle of the remaining height.
  // Identity and the way out live in the topbar (same place on every screen), not in the page.
  // The slot exists once the layout is in the DOM (after the first commit), hence the effect.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setTopbarSlot(document.getElementById('participant-topbar')), []);
  // Where this device follows from, and whether the current question sounds here.
  const presence = view.players.find((p) => p.playerId === myId)?.presence ?? 'room';
  const device = presence === 'remote' ? 'remote' : 'room';
  const hears = !!question?.audioTarget && playsSound(question.audioTarget, device);
  // A remote participant gets the whole question (a muted video when the sound is not
  // theirs); in the room, the phone shows the image unless the sound is meant for it too.
  const playsHere = presence === 'remote' || hears;

  const participantBar =
    topbarSlot && view.status === 'ready' && view.state !== 'ENDED' && !view.kicked
      ? createPortal(
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut className="size-4" />
              {t('player.leave')}
            </Button>
            {hears ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-pressed={muted}
                aria-label={muted ? t('player.unmute') : t('player.mute')}
                onClick={() => toggleMuted()}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
            ) : null}
            <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
              {nickname}
            </span>
            <Avatar name={avatarName} size={32} />
            <ConfirmDialog
              open={confirmLeave}
              destructive
              title={t('player.leaveConfirmTitle')}
              description={t('player.leaveConfirmDescription')}
              confirmLabel={t('player.leave')}
              onCancel={() => setConfirmLeave(false)}
              onConfirm={() => {
                setConfirmLeave(false);
                clearPlayerSession();
                socket?.disconnect();
                void navigate({ to: '/join' });
              }}
            />
          </>,
          topbarSlot,
        )
      : null;

  const wrap = (children: React.ReactNode, opts: { wide?: boolean; center?: boolean } = {}) => (
    <Surface
      background={view.question?.background}
      textTone={view.question?.textTone}
      textOutline={view.question?.textOutline}
      className={cn(
        '-mx-4 -my-4 min-h-[calc(100dvh-4rem)] px-4 py-4',
        TYPE_BASE.phone,
        !view.question?.background && 'bg-transparent',
      )}
    >
      {participantBar}
      <section
        className={cn(
          'mx-auto flex w-full flex-1 flex-col items-center gap-[1.5em] py-[1.5em] text-center',
          opts.wide ? 'max-w-[24em] md:max-w-[36em]' : 'max-w-[24em]',
          opts.center && 'min-h-[calc(100dvh-6rem)]',
        )}
      >
        {opts.center ? (
          <div className="my-auto flex w-full flex-col items-center gap-[1.5em]">{children}</div>
        ) : (
          children
        )}
      </section>
    </Surface>
  );

  // ── Écran « Rejoindre » (pas de session locale valide) ─────────────────────
  if (view.status === 'no-session') {
    return wrap(
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('player.yourNickname')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 text-left" onSubmit={(e) => void onJoin(e)}>
            <div className="flex flex-col items-center gap-2">
              <Avatar name={avatarName} size={88} />
              <Button type="button" variant="outline" size="sm" onClick={randomizeAvatar}>
                <Shuffle className="size-4" />
                {t('player.randomAvatar')}
              </Button>
            </div>
            <Label>
              {t('player.nickname')}
              <Input
                autoFocus
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('player.nicknamePlaceholder')}
                required
              />
            </Label>
            {hasSound ? <PresenceChoice value={wantedPresence} onChange={setPresence} /> : null}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <Button type="submit" disabled={joining || !nickname.trim()}>
              <LogIn className="size-4" />
              {joining ? t('player.connecting') : t('player.letsGo')}
            </Button>
          </form>
        </CardContent>
      </Card>,
    );
  }

  if (view.status === 'connecting') {
    return wrap(<p className="text-muted-foreground">{t('player.connectingToSession')}</p>);
  }

  // Exclu par l'hôte : écran terminal (la session locale a été purgée, pas de reprise).
  if (view.kicked) {
    return wrap(
      <>
        <span className="text-[4.5em] leading-none" aria-hidden>
          🚫
        </span>
        <p className="text-xl font-semibold">{t('player.kickedTitle')}</p>
        <p className="text-muted-foreground">
          {t('player.kickedDescription', { count: view.kicked.minutes })}
        </p>
      </>,
    );
  }

  // ── États de jeu ───────────────────────────────────────────────────────────
  // A slide is projected, not read: it breaks out of the phone column to the whole
  // viewport (width and height under the header), content centred.
  if (view.state === 'SLIDE_SHOW' && view.slide) {
    return (
      <div
        className={cn('-my-4 mx-[calc(50%-50vw)] flex min-h-[calc(100dvh-4rem)]', TYPE_BASE.phone)}
      >
        {participantBar}
        <SlideView slide={view.slide} />
      </div>
    );
  }
  if (view.state === 'HOST_DISCONNECTED') {
    return wrap(<p className="text-xl font-semibold">{t('player.hostDisconnected')}</p>);
  }
  // Fin de partie (podium ou terminée) : on propose de noter le quiz. Les deux états
  // partagent la même structure pour que le panneau d'avis (et le commentaire en
  // cours de saisie) survive à la transition PODIUM → ENDED déclenchée par l'hôte.
  if (view.state === 'PODIUM' || view.state === 'ENDED') {
    return wrap(
      <>
        {view.state === 'PODIUM' ? (
          <>
            <span className="text-[4.5em] leading-none" aria-hidden>
              🏆
            </span>
            <Avatar name={avatarName} size={72} />
            <h2 className="text-[1.5em] font-bold">{t('player.podium')}</h2>
            {view.podium?.you ? (
              <p className="text-lg">
                {t('player.yourRank')}{' '}
                <span className="font-semibold">
                  {t('player.rankValue', { rank: view.podium.you.rank })}
                </span>{' '}
                {t('player.podiumScore', { score: view.podium.you.score })}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-[4.5em] leading-none" aria-hidden>
              🎉
            </span>
            <p className="text-xl font-semibold">{t('player.thanks')}</p>
          </>
        )}
        {view.feedbackEnabled ? <RatingPanel pin={pin} socket={socket} /> : null}
        <Link to="/join" className="text-muted-foreground text-sm underline underline-offset-2">
          {t('player.joinAnother')}
        </Link>
      </>,
    );
  }

  if (view.state === 'REVEAL' || view.state === 'LEADERBOARD') {
    const r = view.result;
    // Classement perso : `you` (du leaderboard) est toujours présent au reveal, même
    // si le joueur n'a pas répondu (pas de `result`). On l'affiche systématiquement.
    const you = view.leaderboard?.you;
    // One column, in reading order: verdict, explanation, then the ranking — with
    // even spacing, centred in the remaining height so nothing floats in a blank.
    return wrap(
      <div className="flex w-full flex-col items-center gap-[1.5em]">
        {question?.type === 'poll' ? (
          // A poll has no right answer: no verdict, no points — just the picture.
          <p className="text-[1.5em] font-semibold">{t('player.pollThanks')}</p>
        ) : r ? (
          <div className="flex flex-col items-center gap-[0.5em]">
            <ResultMark correct={r.correct} />
            <p
              className={`text-[2em] font-bold ${r.correct ? 'text-success' : 'text-destructive'}`}
            >
              {r.correct ? t('player.correct') : t('player.wrong')}
            </p>
            <p className="text-[1.25em]">{t('player.points', { points: r.points })}</p>
            {r.closestRank ? (
              <p className="text-muted-foreground text-[1em]">
                {t('player.yourClosest', {
                  rank: r.closestRank,
                  distance: +(r.distance ?? 0).toFixed(2),
                })}
              </p>
            ) : r.credit ? (
              <p className="text-muted-foreground text-[1em]">
                {t('player.yourCredit', { percent: Math.round(r.credit * 100) })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground">{t('player.answersRevealed')}</p>
        )}
        {/* What was asked and what this participant answered, next to the right answer. */}
        {question && view.reveal ? (
          question.options?.length && question.type !== 'ordering' ? (
            <OptionGrid
              options={question.options}
              selectedIds={selected}
              correctIds={view.reveal.correctOptionIds}
              layout="list"
            />
          ) : (
            <div className="flex w-full flex-col items-center gap-[0.5em]">
              {question.type === 'ordering' && order.length ? (
                <p className="text-muted-foreground text-[0.95em]">
                  {t('reveal.yourAnswer')}{' '}
                  <strong>
                    {order
                      .map((id) => question.options?.find((o) => o.id === id)?.text ?? id)
                      .join(' → ')}
                  </strong>
                </p>
              ) : freeValue ? (
                <p className="text-muted-foreground text-[0.95em]">
                  {t('reveal.yourAnswer')} <strong>{freeValue}</strong>
                </p>
              ) : null}
              <RevealAnswer question={question} reveal={view.reveal} />
            </div>
          )
        ) : null}
        {view.reveal?.answerExplanation ? <AnswerExplanation reveal={view.reveal} /> : null}
        {you ? (
          <p className="w-full border-t pt-[1em] text-[1.5em]">
            {t('player.yourRankShort')}{' '}
            <span className="font-bold">{t('player.rankValue', { rank: you.rank })}</span>
            <span className="text-muted-foreground">
              {t('player.scoreValue', { score: you.score })}
            </span>
          </p>
        ) : r ? (
          <p className="text-muted-foreground">{t('player.rank', { rank: r.rank })}</p>
        ) : null}
      </div>,
      { wide: true, center: true },
    );
  }

  if ((view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') && question) {
    const done = submitted || view.answerAccepted === true;
    // Layout en 3 zones, identique d'une question à l'autre (UX first) : le chrono
    // reste en haut, l'énoncé occupe le centre et **défile** s'il est long, la zone
    // de réponse est ancrée en bas (position constante, jamais repoussée hors écran).
    return (
      <section
        className={cn(
          // Fills the viewport under the header (main padding included): the chrono
          // on top, the prompt centred in the remaining height, the answer zone at the bottom.
          'mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-[24em] flex-col gap-[0.75em] text-center md:max-w-[36em]',
          TYPE_BASE.phone,
        )}
      >
        {participantBar}
        {remaining !== null ? (
          <span
            className="shrink-0 pt-[0.5em] text-[2.5em] font-bold tabular-nums"
            aria-label={t('player.timeRemaining')}
          >
            ⏱ {remaining}
          </span>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-[0.75em] overflow-y-auto py-[1em]">
          {/* #41: capped at ~a third of the viewport so the answer zone below
              stays where the thumb expects it, whatever the image's ratio. */}
          {playsHere ? (
            <QuestionMediaStage
              key={question.questionIndex}
              media={question.media}
              mode={view.paused ? 'pause' : 'play'}
              audible={hears}
              muted={muted}
              boxClassName="w-full max-h-[35dvh]"
              resumeKey={`${pin}:${question.questionIndex}`}
              restartSignal={
                view.mediaControl?.questionIndex === question.questionIndex
                  ? view.mediaControl.seq
                  : 0
              }
            />
          ) : (
            <QuestionMedia media={question.media} className="max-h-[35dvh] w-auto" />
          )}
          <Markdown
            role="heading"
            aria-level={1}
            className="text-[1.5em] font-semibold text-balance"
          >
            {question.prompt}
          </Markdown>
        </div>
        <div className="flex w-full shrink-0 flex-col items-center gap-[0.75em] pb-[0.5em]">
          <AnswerRules question={question} />
          {reading ? (
            <p className="text-muted-foreground text-[1.1em] font-medium">
              {t('player.readQuestion')} <span className="tabular-nums">{readingLeft}</span>
            </p>
          ) : done ? (
            <p className="text-[1.25em] font-semibold">{t('player.answerSaved')}</p>
          ) : (
            renderAnswerInput()
          )}
        </div>
      </section>
    );
  }

  if (view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') {
    return wrap(<p className="text-muted-foreground">{t('player.waitingQuestion')}</p>);
  }

  // ── LOBBY / attente ──────────────────────────────────────────────────────────
  return wrap(
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t('player.inSession')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <Avatar name={avatarName} size={72} />
        {nickname ? <p className="text-lg font-semibold">« {nickname} »</p> : null}
        {/* Avatar modifiable tant que la partie n'a pas démarré : on randomise en local
            puis on synchronise explicitement (évite d'inonder le serveur à chaque clic). */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={randomizeAvatar}>
            <Shuffle className="size-4" />
            {t('player.randomAvatar')}
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={commitAvatar}
            disabled={avatarSeed === syncedSeed}
            aria-label={t('player.saveAvatar')}
            title={t('player.saveAvatar')}
          >
            <Check className="size-4" />
          </Button>
        </div>
        <p className="text-muted-foreground">{t('player.waitingHost')}</p>
        <p className="text-muted-foreground border-t pt-2 text-sm">{trackingNotice(t, view)}</p>
      </CardContent>
    </Card>,
  );
}

/** "In the room" or "remote": whether this device will get the question's video and sound. */
function PresenceChoice({
  value,
  onChange,
}: {
  value: PlayerPresence;
  onChange: (presence: PlayerPresence) => void;
}) {
  const { t } = useTranslation('live');
  const choices = [
    {
      id: 'room',
      icon: Users,
      label: t('player.presenceRoom'),
      hint: t('player.presenceRoomHint'),
    },
    {
      id: 'remote',
      icon: Wifi,
      label: t('player.presenceRemote'),
      hint: t('player.presenceRemoteHint'),
    },
  ] as const;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('player.presenceLegend')}</legend>
      {choices.map(({ id, icon: Icon, label, hint }) => (
        <label
          key={id}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
            value === id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
          )}
        >
          <input
            type="radio"
            name="presence"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
            className="accent-primary mt-1"
          />
          <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-muted-foreground text-xs">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The participant's own mute, kept for the tab's life (a reload keeps it). */
const MUTED_KEY = 'live.muted';
function loadMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
function saveMuted(muted: boolean): void {
  try {
    sessionStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}
