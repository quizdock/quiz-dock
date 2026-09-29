import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type PlayerPresence, playsSound } from '@quiz-dock/contracts';
import {
  Check,
  ListChecks,
  LogIn,
  LogOut,
  MonitorPlay,
  Share2,
  Shuffle,
  Users,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { APP_NAME } from '../config';
import { ScreenSurface } from './screen-page';
import { type FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hasGameSounds, useRoomMedia } from '../game/media/use-room-media';
import { Avatar } from '../game/avatar';
import {
  joinSession,
  clearPlayerSession,
  loadAvatarSeed,
  loadNickname,
  loadPlayerSession,
  peekSession,
  saveAvatarSeed,
  disconnectGame,
} from '../game/game-client';
import { ResultMark } from '../game/result-mark';
import { SortableAnswer } from '../game/sortable-answer';
import {
  ConnectionLost,
  AnswerExplanation,
  AnswerRules,
  QuestionMedia,
  OptionGrid,
  OptionTiles,
  QuestionClockBar,
  RevealAnswer,
  SlideView,
  TYPE_BASE,
} from '../game/live-components';
import { ImageChoiceGrid } from '../game/image-choice';
import { cn } from '@/lib/utils';
import { Surface } from '../game/surface';
import { unlockAudio } from '../game/media/audio-unlock';
import { claimMediaElements, mediaElementsClaimed } from '../game/media/media-pool';
import { FollowedWaveform, QuestionMediaStage } from '../game/media/question-media-stage';
import { SlidePlaybackContext } from '../game/media/slide-media';
import { RoomVariables } from '../game/slide-variables';
import { anchorOf, followed } from '../game/media/followed';
import { RatingPanel } from '../game/rating-panel';
import { setDeviceMuted, useDeviceSound } from '../game/media/audio-mixer';
import { SoundButton } from '../game/media/sound-button';
import { roomLabel } from '../game/room-components';
import { useCountdown, useQuestionClock } from '../game/use-countdown';
import { type GameView, useGameSession } from '../game/use-game-session';
import { getAuthMode, isAuthenticated, rememberAfterLogin } from '../auth/auth-context';
import { Spinner } from '@/components/ui/loading';

/**
 * Avis de transparence (§2.10, RG-16) : ce que la session enregistre de ce
 * participant. Sans compte (mode local, ou partie en accès libre #57) rien n'est
 * rattaché à un compte : le texte parle du pseudo, faute de quoi il promettrait
 * l'inverse de ce qui se passe.
 */
function trackingNotice(
  t: (key: string) => string,
  view: Pick<GameView, 'personalTracking' | 'fullCapture' | 'participantAccess'>,
): string {
  if (!view.personalTracking) return t('player.noTrackingNotice');
  const account = getAuthMode() === 'oidc' && view.participantAccess === 'account';
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
  const { pin } = useParams({ from: '/join/$pin' });
  const session = useGameSession(pin, 'player');
  return (
    <>
      <ConnectionLost lost={session.view.connectionLost} />
      {/* A hook for override.css, with the game's state (no box: the layout is the page's). */}
      <div className="qd-player contents" data-state={session.view.state ?? 'none'}>
        <PlayerView pin={pin} session={session} />
      </div>
    </>
  );
}

/** The participant's side of the session the page follows, in each state of the game. */
function PlayerView({ pin, session }: { pin: string; session: ReturnType<typeof useGameSession> }) {
  const { t } = useTranslation('live');
  const { view, socket, markJoined, markReady } = session;
  const [nickname, setNickname] = useState(() => loadPlayerSession()?.nickname ?? loadNickname());
  const [joining, setJoining] = useState(false);
  // Asked only when the quiz plays sound: a remote player then gets it on their device.
  const [hasSound, setHasSound] = useState(false);
  const [wantedPresence, setPresence] = useState<PlayerPresence>('room');
  // This device's own sound (SPECIFICATIONS-MEDIA §9.2): its mute, kept on it.
  const { muted } = useDeviceSound();
  // The big screen on this phone (#104), in place of the answers, and back.
  const [showScreen, setShowScreen] = useState(false);
  // "Share the projection": the link once copied (and its QR code) when the phone cannot share.
  const [sharedLink, setSharedLink] = useState<string | null>(null);
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
  // Whether this phone's media elements were claimed in a gesture (at the join when
  // the quiz had sound); read at each render, `claimSound` re-renders after the tap.
  const [, setClaims] = useState(0);
  const soundReady = mediaElementsClaimed();
  const claimSound = () => {
    claimMediaElements();
    void unlockAudio();
    setClaims((n) => n + 1);
  };

  const question = view.question;
  const isMulti =
    question?.type === 'multiple_choice' ||
    (question?.type === 'image_choice' && !!question.multiSelect);
  const clock = useQuestionClock(view);
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
  // Where this device follows from: in the room, or remote (it then gets the whole
  // question, its sound when the room's reaches remote devices, the game's sounds).
  const presence = view.players.find((p) => p.playerId === myId)?.presence ?? 'room';
  const remote = presence === 'remote';
  // The game's sounds (#93) on a remote phone, when the room's sound reaches remote
  // devices; on the big screen view (#104), the projection's surface plays them.
  const gameSoundsHere =
    remote && view.gameAudioTarget !== 'projection' && hasGameSounds(view.sounds);
  // What the next question will show or play here is fetched while the room waits,
  // and the host's console hears when this device is ready to play it.
  useRoomMedia(view, pin, socket, { sounds: gameSoundsHere && !showScreen, preload: 'ready' });
  const serverAvatar = view.players.find((p) => p.playerId === myId)?.avatar;
  const inLobby = view.state === null || view.state === 'LOBBY';
  // Graine déjà synchronisée vers le serveur (pour n'émettre que sur changement réel).
  const [syncedSeed, setSyncedSeed] = useState(avatarSeed);
  const joinedRoom = view.status !== 'no-session';
  // The lobby card previews a new draw; everywhere else (the top bar, the podium)
  // shows the avatar the room knows, until the player saves the new one.
  const avatarOf = (seed: string) =>
    (inLobby ? seed || serverAvatar : serverAvatar || seed) || nickname || '?';
  const avatarPreview = avatarOf(avatarSeed);
  const avatarName = avatarOf(syncedSeed);

  /**
   * Randomise l'avatar **localement** uniquement (aperçu) : pas d'émission réseau
   * ici, pour éviter d'inonder le serveur/animateur à chaque clic. Once in the room
   * the draw waits for « Enregistrer » (or « Annuler »); before joining, the join
   * itself carries it.
   */
  const randomizeAvatar = () => {
    const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    setAvatarSeed(seed);
    if (!joinedRoom) {
      setSyncedSeed(seed);
      saveAvatarSeed(seed);
    }
  };

  /** Synchronise l'avatar choisi vers la room (refusé côté serveur après le démarrage). */
  const commitAvatar = () => {
    socket?.emit('player:avatar', { pin, avatar: avatarPreview });
    setSyncedSeed(avatarSeed);
    saveAvatarSeed(avatarSeed);
  };

  /** Back to the avatar the room knows. */
  const cancelAvatar = () => setAvatarSeed(syncedSeed);

  // Nouvelle question → réinitialise la saisie locale.
  useEffect(() => {
    setSelected([]);
    setFreeValue('');
    setSubmitted(false);
  }, [view.questionIndex]);
  // Refused as too early (the answers were not open yet): the answer box comes back.
  useEffect(() => {
    if (view.answerRefusal === 'early') setSubmitted(false);
  }, [view.answerRefusal, view.answerAckAt]);
  // L'ordre de départ suit l'arrivée d'une question (remise en ordre) : une nouvelle
  // question, pas un nouvel objet — l'hôte qui ajuste le chrono renvoie la même.
  const questionKey = question ? question.questionIndex : null;
  useEffect(() => {
    setOrder(question?.options?.map((o) => o.id) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per question only
  }, [questionKey]);

  const needsJoin = view.status === 'no-session';
  useEffect(() => {
    if (!needsJoin) return;
    let cancelled = false;
    // No answer (game over, network): the form stays as it was, the join says why.
    peekSession(pin)
      .then((res) => {
        if (cancelled) return;
        // A game that requires accounts, and no session here: sign in first, then
        // back to this invitation (RG-15). Only reachable when open access is
        // offered — otherwise the route guard already sent them (#57).
        if (res.participantAccess === 'account' && getAuthMode() === 'oidc' && !isAuthenticated()) {
          rememberAfterLogin(window.location.pathname + window.location.search);
          void navigate({ to: '/login' });
          return;
        }
        setHasSound(res.hasSound);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsJoin, pin, navigate]);

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
        wantedPresence,
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

  /** "Ready!" or "Not yet" (#104), shown once the server took it. */
  const sayReady = async (ready: boolean) => {
    if (!socket) return;
    const res = await socket.emitWithAck('player:ready', { pin, ready }).catch(() => null);
    if (res?.ok) markReady(ready);
  };

  /** Shares the projection's copy: the share sheet where there is one, else the link copied and its QR code. */
  const shareProjection = async () => {
    const url = `${window.location.origin}/join/${pin}/screen${remote ? '?sound=1' : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: t('player.shareProjectionTitle', { appName: APP_NAME }),
          url,
        });
        return;
      }
      await navigator.clipboard?.writeText(url);
    } catch {
      /* cancelled or refused: the QR code below still carries it */
    }
    setSharedLink(url);
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
          {/* Shown once the answers open (the reading shows a message instead): the
              focus goes straight to it, the phone's keyboard with it. */}
          <Input
            autoFocus
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

    // À options (QCM unique/multi, V-F, sondage) : the tiles, in the projection's grid.
    if (opts.length) {
      return (
        <>
          {/* In the room the text is read on the projection, at the same place in the
              same grid; a remote participant has no projection, so it is in the tiles. */}
          {question.type === 'image_choice' ? (
            // The pictures themselves, in the projection's order, in the room as at a
            // distance: a phone has the room for them, and they are the answers.
            <ImageChoiceGrid options={opts} onPick={onPick} selectedIds={selected} />
          ) : remote ? (
            <OptionGrid options={opts} onPick={onPick} selectedIds={selected} />
          ) : (
            <OptionTiles options={opts} onPick={onPick} selectedIds={selected} />
          )}
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
  const [topbarStart, setTopbarStart] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById('participant-topbar'));
    setTopbarStart(document.getElementById('participant-topbar-start'));
  }, []);
  // Whether the current question sounds here. A remote participant gets the whole question
  // (a muted video when the sound is not theirs); in the room, the phone shows the image
  // unless the sound is meant for it too.
  const hears = !!question?.audioTarget && playsSound(question.audioTarget, presence);
  const playsHere = remote || hears;

  const participantTop =
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
            {/* This device's sound: when it plays something (the question here, or the game's). */}
            {hears || gameSoundsHere || remote ? <SoundButton onUnmute={claimSound} /> : null}
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
                disconnectGame();
                void navigate({ to: '/join' });
              }}
            />
          </>,
          topbarSlot,
        )
      : null;

  // The answers or the big screen, next to the logo: a switch, both sides always in sight.
  const screenSwitch =
    topbarStart && view.status === 'ready' && view.state !== 'ENDED' && !view.kicked
      ? createPortal(
          <div
            role="group"
            aria-label={t('player.viewSwitch')}
            className="bg-muted flex items-center rounded-full p-0.5"
          >
            {(
              [
                [false, ListChecks, t('player.showAnswers')],
                [true, MonitorPlay, t('player.showScreen')],
              ] as const
            ).map(([screenSide, Icon, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={showScreen === screenSide}
                aria-label={label}
                title={label}
                onClick={() => setShowScreen(screenSide)}
                className={cn(
                  'flex h-7 w-9 items-center justify-center rounded-full transition-colors',
                  showScreen === screenSide
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>,
          topbarStart,
        )
      : null;
  const participantBar = (
    <>
      {participantTop}
      {screenSwitch}
    </>
  );

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

  // Where this participant stands in the room (#89), once it has played more than one quiz.
  const roomYou = view.standings && view.standings.quizzesPlayed > 1 ? view.standings.you : null;
  const roomLine = roomYou ? (
    <p className="text-muted-foreground">
      {t('player.roomRank', {
        rank: roomYou.rank,
        score: roomYou.score,
      })}
    </p>
  ) : null;

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
              <Avatar name={avatarPreview} size={88} />
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
            <PresenceChoice value={wantedPresence} onChange={setPresence} />
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
    return wrap(<Spinner label={t('player.connectingToSession')} showLabel />);
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

  // The big screen on this phone (#104): the projection as it is, from this
  // participant's own session — the sound only where it would play here anyway.
  if (showScreen && view.state && view.state !== 'ENDED') {
    return (
      <div className="-mx-4 -my-4 min-h-[calc(100dvh-4rem)]">
        {participantBar}
        <ScreenSurface
          pin={pin}
          view={view}
          socket={socket}
          role="follow"
          sound={remote && !muted}
          embedded
        />
      </div>
    );
  }

  // ── États de jeu ───────────────────────────────────────────────────────────
  // A slide is projected, not read: it breaks out of the phone column to the whole
  // viewport (width and height under the header), content centred.
  if (view.state === 'SLIDE_SHOW' && view.slide) {
    const slide = view.slide;
    const step = { questionIndex: slide.questionIndex, slideIndex: slide.slideIndex };
    // Its media as a question's (#125): a remote participant sees the videos and hears
    // the sound meant for them; a phone in the room plays only a sound meant for everyone.
    const slideHears = !!slide.audioTarget && playsSound(slide.audioTarget, presence);
    return (
      <div
        className={cn('-my-4 mx-[calc(50%-50vw)] flex min-h-[calc(100dvh-4rem)]', TYPE_BASE.phone)}
      >
        {participantBar}
        <SlidePlaybackContext.Provider
          value={{
            mode: view.nav?.review ? 'still' : view.paused ? 'pause' : 'play',
            audible: slideHears,
            muted,
            startAt: slide.mediaStartAt ?? null,
            anchor: anchorOf(view, step),
            resumeKey: `${pin}:s${slide.slideIndex}`,
            follow: slideHears ? undefined : followed(view, step),
            catchUp: followed(view, step),
            videos: remote,
          }}
        >
          <RoomVariables view={view} pin={pin}>
            <SlideView key={slide.slideIndex} slide={slide} />
          </RoomVariables>
        </SlidePlaybackContext.Provider>
      </div>
    );
  }
  if (view.state === 'HOST_DISCONNECTED') {
    return wrap(<p className="text-xl font-semibold">{t('player.hostDisconnected')}</p>);
  }
  if (view.state === 'MEDIA_LOADING') {
    return wrap(<p className="text-xl font-semibold">{t('player.questionComing')}</p>);
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
            {roomLine}
          </>
        ) : (
          <>
            <span className="text-[4.5em] leading-none" aria-hidden>
              🎉
            </span>
            <p className="text-xl font-semibold">{t('player.thanks')}</p>
          </>
        )}
        {/* Only a quiz they played, keyed by it: a room plays several under one PIN. */}
        {view.rateable?.feedbackEnabled ? (
          <RatingPanel pin={pin} quizId={view.rateable.quizId} socket={socket} />
        ) : null}
        {/* Only once the room is closed: at a podium the participant is still in it (the host
            may open the next quiz), and leaving goes through "Leave", which really leaves. */}
        {view.state === 'ENDED' ? (
          <Link to="/join" className="text-muted-foreground text-sm underline underline-offset-2">
            {t('player.joinAnother')}
          </Link>
        ) : null}
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
    // A refused answer is never shown as saved: too early, the box is back; an
    // earlier answer that counts is the saved one; otherwise it did not count.
    const refusal = view.answerAccepted === false ? view.answerRefusal : null;
    const lost = refusal === 'closed' || refusal === 'late' || refusal === 'unknown';
    const done = !lost && refusal !== 'early' && (submitted || view.answerAccepted === true);
    // Tap tiles (QCM, V-F, poll): pinned to the bottom of the screen. Typed answers
    // and ordering stay in the flow (the keyboard would fight a pin).
    const tiled =
      !!question.options?.length &&
      question.type !== 'ordering' &&
      question.type !== 'numeric' &&
      question.type !== 'text_input';
    // Layout en 3 zones, identique d'une question à l'autre (UX first) : le chrono
    // reste en haut, l'énoncé occupe le centre et **défile** s'il est long, la zone
    // de réponse est ancrée en bas (position constante, jamais repoussée hors écran).
    return (
      <Surface
        background={question.background}
        textTone={question.textTone}
        textOutline={question.textOutline}
        className={cn(
          '-mx-4 -my-4 min-h-[calc(100dvh-4rem)] px-4 py-4',
          !question.background && 'bg-transparent',
        )}
      >
        <section
          className={cn(
            // Fills the viewport under the header (main padding included): the chrono
            // on top, the prompt centred in the remaining height, the answer zone at the bottom.
            'mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-[24em] flex-col gap-[0.75em] text-center md:max-w-[36em]',
            TYPE_BASE.phone,
          )}
        >
          {participantBar}
          {clock ? (
            // Pinned on top while the rest scrolls; above an opened picture too.
            <QuestionClockBar
              clock={clock}
              className={cn(
                'sticky top-0 z-50 shrink-0 py-[0.5em] text-[1.25em]',
                !question.background && 'bg-background',
              )}
            />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-[0.75em] overflow-y-auto py-[0.5em]">
            {/* The prompt first, then the picture: a small one in the room (it is big on the
              projection), a tap to open it over the screen (#92). */}
            <Markdown
              role="heading"
              aria-level={1}
              className="qd-prompt text-[1.5em] font-semibold text-balance"
            >
              {question.prompt}
            </Markdown>
            {playsHere ? (
              <QuestionMediaStage
                key={question.questionIndex}
                media={question.media}
                mode={view.paused ? 'pause' : 'play'}
                audible={hears}
                muted={muted}
                follow={
                  hears ? undefined : followed(view, { questionIndex: question.questionIndex })
                }
                catchUp={followed(view, { questionIndex: question.questionIndex })}
                startAt={question.mediaStartAt ?? null}
                zoomable
                boxClassName="w-full max-h-[30dvh]"
                resumeKey={`${pin}:${question.questionIndex}`}
                anchor={anchorOf(view, { questionIndex: question.questionIndex })}
              />
            ) : (
              <>
                <QuestionMedia media={question.media} zoomable className="max-h-[18dvh] w-auto" />
                {/* In the room the sound plays on the projection; its playhead shows here only
                  when the sound is the question (listen first), not a background (#92). */}
                {question.media?.audio && question.listenFirst ? (
                  <FollowedWaveform
                    audio={question.media.audio}
                    follow={followed(view, { questionIndex: question.questionIndex })}
                  />
                ) : null}
              </>
            )}
          </div>
          <div
            className={cn(
              'flex w-full shrink-0 flex-col items-center gap-[0.75em] pb-[0.5em]',
              tiled && 'sticky bottom-0 pt-[0.5em] pb-[max(0.5em,env(safe-area-inset-bottom))]',
              tiled && !question.background && 'bg-background',
            )}
          >
            <AnswerRules question={question} />
            {reading ? (
              <p className="text-muted-foreground text-[1.1em] font-medium">
                {question.listenFirst ? t('player.listenFirst') : t('player.readQuestion')}{' '}
                <span className="tabular-nums">{readingLeft}</span>
              </p>
            ) : lost ? (
              <p role="alert" className="text-destructive text-[1.1em] font-semibold">
                {t(`player.answerRefused.${refusal}`)}
              </p>
            ) : done ? (
              <p className="text-[1.25em] font-semibold">{t('player.answerSaved')}</p>
            ) : (
              <>
                {refusal === 'early' ? (
                  <p role="alert" className="text-muted-foreground">
                    {t('player.answerRefused.early')}
                  </p>
                ) : null}
                {renderAnswerInput()}
              </>
            )}
          </div>
        </section>
      </Surface>
    );
  }

  if (view.state === 'ANSWERING' || view.state === 'QUESTION_SHOW') {
    return wrap(<p className="text-muted-foreground">{t('player.waitingQuestion')}</p>);
  }

  // ── LOBBY / attente ──────────────────────────────────────────────────────────
  return wrap(
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('player.inSession')}</CardTitle>
          <p className="text-lg font-semibold">{roomLabel(t, view.roomName, view.hostName)}</p>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <Avatar name={avatarPreview} size={72} />
          {nickname ? <p className="text-lg font-semibold">« {nickname} »</p> : null}
          {/* Avatar modifiable tant que la partie n'a pas démarré : on randomise en local
            puis on synchronise explicitement (évite d'inonder le serveur à chaque clic). */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={randomizeAvatar}>
              <Shuffle className="size-4" />
              {t('player.randomAvatar')}
            </Button>
            {avatarSeed !== syncedSeed ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  onClick={commitAvatar}
                  aria-label={t('player.saveAvatar')}
                  title={t('player.saveAvatar')}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={cancelAvatar}
                  aria-label={t('player.cancelAvatar')}
                  title={t('player.cancelAvatar')}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : null}
          </div>
          {/* Between two quizzes of a room (#89): where they stand, then what comes. */}
          {view.standings?.you ? (
            <p className="text-muted-foreground">
              {t('player.roomRank', {
                rank: view.standings.you.rank,
                score: view.standings.you.score,
              })}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {view.standings ? t('player.waitingNextQuiz') : t('player.waitingHost')}
          </p>
          {/* The next quiz plays sound and this device never enabled it (it joined a
            silent one): the tap is the only way a phone lets it play later. */}
          {(view.quizHasSound || gameSoundsHere) && !soundReady && !muted ? (
            <div className="flex flex-col items-center gap-1">
              <Button type="button" variant="outline" size="sm" onClick={claimSound}>
                <Volume2 className="size-4" />
                {t('player.enableSound')}
              </Button>
              {/* The tap still readies the phone; its sound stays off until the sound button. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  claimSound();
                  setDeviceMuted(true);
                }}
              >
                {t('media.withoutSound')}
              </Button>
            </div>
          ) : null}
          <p className="text-muted-foreground border-t pt-2 text-sm">{trackingNotice(t, view)}</p>
          {/* "Ready!" (#104): the host sees one count and still starts when they choose. */}
          <div className="flex w-full flex-col items-center gap-1 border-t pt-3">
            {view.youReady ? (
              // What the wait is about, once ready: the quiz to come and the room filling up.
              <div className="qd-pop bg-muted/40 flex w-full flex-col items-center gap-1.5 rounded-lg border p-3">
                <p className="text-success flex items-center gap-1.5 font-semibold">
                  <Check className="size-4" />
                  {t('player.readyDone')}
                </p>
                {view.quizTitle ? (
                  <p className="text-sm font-medium">
                    {t('player.upNext', { title: view.quizTitle })}
                  </p>
                ) : null}
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <Users className="size-4" />
                  {t('player.lobbyPlayers', {
                    count: view.lobbyCount?.total ?? view.players.length,
                  })}
                  {view.lobbyCount ? (
                    <span>
                      {' · '}
                      {t('player.lobbyReady', view.lobbyCount)}
                    </span>
                  ) : null}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void sayReady(false)}
                >
                  {t('player.notYet')}
                </Button>
              </div>
            ) : (
              // Breathes until pressed: the one thing the room waits for from this phone.
              <Button
                type="button"
                variant="main-action"
                className="qd-breathe transition-transform active:scale-95"
                onClick={() => void sayReady(true)}
              >
                {t('player.ready')}
              </Button>
            )}
          </div>
          {/* The whole question, big, on a tablet or a computer (#104). The link
              carries the PIN, never this participant's seat. */}
          <div className="flex w-full flex-col items-center gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void shareProjection()}
            >
              <Share2 className="size-4" />
              {t('player.shareProjection')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('player.shareProjectionHint')}</p>
            {sharedLink ? (
              <div className="flex flex-col items-center gap-1">
                <div className="rounded-md bg-white p-2">
                  <QRCodeSVG
                    value={sharedLink}
                    size={120}
                    aria-label={t('player.shareProjection')}
                  />
                </div>
                <p className="text-muted-foreground text-xs">{t('player.projectionLinkCopied')}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {/* The host moved on while they were rating the quiz just played: it stays open. */}
      {view.rateable?.feedbackEnabled ? (
        <RatingPanel pin={pin} quizId={view.rateable.quizId} socket={socket} hideWhenDone />
      ) : null}
    </>,
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
