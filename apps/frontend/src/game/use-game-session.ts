import type {
  AnswerAck,
  AnswerRefusal,
  AudioTarget,
  GameMode,
  GameModePayload,
  GameOutlinePayload,
  GameState,
  GameStatePayload,
  GameStep,
  LeaderboardPayload,
  MediaControlPayload,
  MediaPositionPayload,
  MediaPreloadPayload,
  MediaReadinessPayload,
  OutlineQuestion,
  OutlineSlide,
  ParticipantAccess,
  PersonalResult,
  PlayerPresence,
  PodiumPayload,
  QuestionRevealPayload,
  QuestionStartPayload,
  QuestionTimePayload,
  RoomSoundsPayload,
  RoomStandingsPayload,
  ServerToClientEvents,
  SessionNotice,
  SlideShowPayload,
} from '@quiz-dock/contracts';
import i18next from 'i18next';
import { useEffect, useRef, useState } from 'react';
import type { FollowedPosition } from './media/question-media-stage';
import {
  type GameSocket,
  clearPlayerSession,
  ensureGameSocket,
  loadPlayerSession,
} from './game-client';

export type LiveRole = 'host' | 'spectator' | 'player';

/**
 * `connecting` : socket en cours d'attache. `ready` : (ré)attaché, l'état suit les
 * events. `no-session` : joueur sans session locale valide → écran « Rejoindre ».
 * `error` : attache refusée (ex. partie terminée).
 */
export type LiveStatus = 'connecting' | 'ready' | 'no-session' | 'error';

export interface RosterPlayer {
  playerId: string;
  nickname: string;
  /** Graine d'avatar (multiavatar) — défaut côté rendu = pseudo si absent. */
  avatar?: string;
  /** In the room when absent. */
  presence?: PlayerPresence;
}

/** Vue unifiée de la partie live, consommée par les trois surfaces (§9). */
export interface GameView {
  status: LiveStatus;
  error: string | null;
  state: GameState | null;
  questionIndex: number;
  totalQuestions: number;
  question: QuestionStartPayload | null;
  /** Content slide on screen while `state === SLIDE_SHOW` (#7). */
  slide: SlideShowPayload | null;
  answerCount: { answered: number; total: number } | null;
  reveal: QuestionRevealPayload | null;
  result: PersonalResult | null;
  leaderboard: LeaderboardPayload | null;
  podium: PodiumPayload | null;
  /** End-of-session rating offered (§2.11) — from the podium / ended payloads. */
  feedbackEnabled: boolean;
  players: RosterPlayer[];
  answerAccepted: boolean | null;
  /** Why the last answer was not counted (with `answerAccepted` false). */
  answerRefusal: AnswerRefusal | null;
  /** Server time of the last acknowledgement: a new one, even with the same verdict. */
  answerAckAt: number | null;
  fullCapture: boolean;
  /** Suivi individuel (RG-16) : faux = seuls les résultats du groupe sont archivés. */
  personalTracking: boolean;
  /** Les participants choisissent leur nom affiché ; sinon il vient de leur compte. */
  pickOwnName: boolean;
  /** How participants get in, fixed at creation (#57). */
  participantAccess: ParticipantAccess;
  /** Closed to new participants by the host. */
  joinLocked: boolean;
  /** Renseigné si l'hôte a banni ce joueur (durée en minutes) — son client l'affiche. */
  kicked: { minutes: number } | null;
  /** The live connection is down (reconnecting): what shows may be out of date. */
  connectionLost: boolean;
  /** Rythme courant (§8) — `manual` par défaut. */
  mode: GameMode;
  /** Auto-progression suspendue par l'hôte (chrono gelé en ANSWERING). */
  paused: boolean;
  /** Drawn with no game (a preview): the clock stands at its full time, nothing plays. */
  still: boolean;
  /** Restant figé (ms) quand le chrono est gelé, sinon `null`. */
  pausedRemainingMs: number | null;
  /** Deadline (ms epoch) de l'enchaînement auto en cours, sinon `null`. */
  autoNextAt: number | null;
  /** Durée totale (ms) de l'attente d'enchaînement auto, pour la barre. */
  autoNextMs: number | null;
  /** Titre du quiz (récap console hôte), `null` tant que le sommaire n'est pas reçu. */
  quizTitle: string | null;
  quizId: string | null;
  /** Description du quiz (récap console hôte), `null` si absente. */
  quizDescription: string | null;
  /** Base URL of the invitations chosen by the host; null = this page's own origin. */
  joinBaseUrl: string | null;
  /** Sommaire des questions (console hôte uniquement). */
  outline: OutlineQuestion[];
  /** The quiz's slides, placed among the questions of the outline (host console only). */
  outlineSlides: OutlineSlide[];
  /** Media of the next question, to fetch ahead (projection and console only). */
  preload: MediaPreloadPayload | null;
  /** Last host command on the current media; `seq` changes with each one. */
  /** Where the host put the current question's media (numbered: a new anchor each time). */
  mediaControl: (MediaControlPayload & { seq: number; receivedAt: number }) | null;
  /** Whether the quiz plays any sound (projection and console only; null until told). */
  quizHasSound: boolean | null;
  /** The room waits for media before `questionIndex`, until `until` (state `MEDIA_LOADING`). */
  mediaWait: { questionIndex: number; until: number } | null;
  /** Where the projection is in the current sound (for the screens that do not play it). */
  mediaPosition: FollowedPosition | null;
  /** Who has loaded the upcoming question's sound or video (projection and console only). */
  readiness: MediaReadinessPayload | null;
  /** Whether the quiz has any media fetched ahead (projection and console only). */
  quizHasMedia: boolean | null;
  /** The game's default audio target (projection and console only; null until told). */
  gameAudioTarget: AudioTarget | null;
  /** Host navigation over played steps (`game:state.nav`); `review` = a past step is on screen. */
  nav: { prev: GameStep | null; next: GameStep | null; review: boolean } | null;
  /** The room's game sounds (#93); null until told. */
  sounds: RoomSoundsPayload | null;
  /** Whether the room's screens move between steps (UI system §1.8); null until told. */
  motion: boolean | null;
  /** Whether this participant said they are ready in the lobby (#104). */
  youReady: boolean;
  /** The lobby's count, as a participant sees it: ready, out of how many (#104). */
  lobbyCount: { ready: number; total: number } | null;
  /** The room's own name (null = the default, "<host>'s room") and its host's name. */
  roomName: string | null;
  hostName: string | null;
  /** The room's standings over its quizzes so far (#89); null before the first is over. */
  standings: RoomStandingsPayload | null;
  /**
   * The quiz this participant can still rate: the last one they played, kept into
   * the next lobby (the host may move on while they rate). Null when they did not
   * play it (joined at its podium) or once the next quiz starts.
   */
  rateable: { quizId: string | null; feedbackEnabled: boolean } | null;
}

/** A view before anything arrived; the base of a preview drawn without a game. */
export const INITIAL_VIEW: GameView = {
  status: 'connecting',
  error: null,
  state: null,
  questionIndex: -1,
  totalQuestions: 0,
  question: null,
  slide: null,
  answerCount: null,
  reveal: null,
  result: null,
  leaderboard: null,
  podium: null,
  feedbackEnabled: true,
  players: [],
  answerAccepted: null,
  answerRefusal: null,
  answerAckAt: null,
  fullCapture: false,
  personalTracking: true,
  pickOwnName: true,
  participantAccess: 'account',
  joinLocked: false,
  kicked: null,
  connectionLost: false,
  mode: 'manual',
  paused: false,
  still: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizId: null,
  quizDescription: null,
  joinBaseUrl: null,
  outline: [],
  outlineSlides: [],
  preload: null,
  mediaControl: null,
  quizHasSound: null,
  gameAudioTarget: null,
  quizHasMedia: null,
  readiness: null,
  mediaPosition: null,
  mediaWait: null,
  nav: null,
  youReady: false,
  lobbyCount: null,
  sounds: null,
  motion: null,
  roomName: null,
  hostName: null,
  standings: null,
  rateable: null,
};

/**
 * What belongs to one quiz of the room and never to a lobby: cleared when a lobby
 * arrives, so the next quiz starts clean. What arrives just before the lobby state
 * (`game:media`, `notice`) or is not sent again with it (outline, standings) stays.
 */
const PER_QUIZ: Partial<GameView> = {
  question: null,
  slide: null,
  answerCount: null,
  reveal: null,
  result: null,
  leaderboard: null,
  podium: null,
  answerAccepted: null,
  answerRefusal: null,
  answerAckAt: null,
  mediaWait: null,
  mediaPosition: null,
  mediaControl: null,
  nav: null,
  youReady: false,
  lobbyCount: null,
};

/**
 * Read when the error shows, not from `useTranslation`: this hook renders no
 * text, and a change of language must not subscribe the view again (audit F8).
 */
const sessionNotFound = () => i18next.t('live:errors.sessionNotFound');

/**
 * S'abonne à la partie `pin` selon le rôle et expose une vue réactive. Garanties :
 * - **un seul socket** (dédoublonnage `ensureGameSocket`, robuste au StrictMode) ;
 * - **listeners posés AVANT le kick** (`host:attach`/`spectator:join`/`player:reconnect`)
 *   pour ne pas rater la rafale d'état renvoyée par le serveur ;
 * - le socket survit au démontage (singleton) ; seuls les listeners sont retirés.
 *
 * Le rôle `player` n'émet rien tant qu'aucune session locale n'existe (`no-session`
 * → écran Rejoindre) ; `markJoined` est appelé par le formulaire après un join réussi.
 */
export function useGameSession(pin: string, role: LiveRole, opts: { follow?: boolean } = {}) {
  const follow = opts.follow === true;
  const [view, setView] = useState<GameView>(INITIAL_VIEW);
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    let active = true;
    let s: GameSocket | null = null;
    let reconnectHandler: (() => void) | null = null;

    const patch = (p: Partial<GameView>) => setView((prev) => ({ ...prev, ...p }));

    const onState = (p: GameStatePayload) =>
      patch({
        status: 'ready',
        state: p.state,
        questionIndex: p.questionIndex,
        totalQuestions: p.totalQuestions,
        nav: p.nav ?? null,
        // Nouvelle question : on purge le résultat/accusé précédent.
        ...(p.state === 'ANSWERING'
          ? {
              reveal: null,
              result: null,
              answerAccepted: null,
              answerRefusal: null,
              answerAckAt: null,
              rateable: null,
            }
          : {}),
        // Back to a lobby (the room's next quiz): nothing of the last one shows.
        ...(p.state === 'LOBBY' ? { ...PER_QUIZ, nav: p.nav ?? null } : {}),
      });
    const onRoster = (p: { players: RosterPlayer[] }) => patch({ players: p.players });
    const onJoined = (p: RosterPlayer) =>
      setView((prev) =>
        prev.players.some((x) => x.playerId === p.playerId)
          ? prev
          : {
              ...prev,
              players: [
                ...prev.players,
                {
                  playerId: p.playerId,
                  nickname: p.nickname,
                  avatar: p.avatar,
                  presence: p.presence,
                },
              ],
            },
      );
    const onLeft = (p: { playerId: string }) =>
      setView((prev) => ({
        ...prev,
        players: prev.players.filter((x) => x.playerId !== p.playerId),
      }));
    // A new question starts at 0 answers: the last one's count would otherwise stand until
    // the first answer (the console shows it; the tick reads its rise). A screen attaching
    // mid-question is sent the true count right after.
    const onQuestion = (p: QuestionStartPayload) =>
      setView((prev) => ({
        ...prev,
        question: p,
        answerCount:
          prev.question?.questionIndex === p.questionIndex
            ? prev.answerCount
            : { answered: 0, total: prev.answerCount?.total ?? prev.players.length },
      }));
    const onJoinUrl = (p: { baseUrl: string | null }) => patch({ joinBaseUrl: p.baseUrl });
    const onMode = (p: GameModePayload) =>
      patch({
        mode: p.mode,
        paused: p.paused,
        pausedRemainingMs: p.remainingMs ?? null,
        autoNextAt: p.autoNextAt ?? null,
        autoNextMs: p.autoNextMs ?? null,
      });
    const onOutline = (p: GameOutlinePayload) =>
      patch({
        quizId: p.quizId,
        quizTitle: p.title,
        quizDescription: p.description,
        outline: p.questions,
        outlineSlides: p.slides ?? [],
      });
    // Ajustement du chrono : on remplace les timings de la question courante (le
    // décompte est dérivé de `endsAt`), sans toucher au reste de son contenu.
    const onTime = (p: QuestionTimePayload) =>
      setView((prev) =>
        prev.question && prev.question.questionIndex === p.questionIndex
          ? {
              ...prev,
              question: {
                ...prev.question,
                startedAt: p.startedAt,
                endsAt: p.endsAt,
                ...(p.mediaStartAt !== undefined ? { mediaStartAt: p.mediaStartAt } : {}),
              },
            }
          : prev,
      );
    const onCount = (p: { answered: number; total: number }) => patch({ answerCount: p });
    const onAck = (p: AnswerAck) =>
      patch({
        answerAccepted: p.accepted,
        answerRefusal: p.accepted ? null : (p.reason ?? 'closed'),
        answerAckAt: p.receivedAt,
      });
    const onSlide = (p: SlideShowPayload) => patch({ slide: p });
    const onReveal = (p: QuestionRevealPayload) =>
      patch({ reveal: p, result: p.yourResult ?? null });
    const onLeaderboard = (p: LeaderboardPayload) => patch({ leaderboard: p });
    const onPreload = (p: MediaPreloadPayload) => patch({ preload: p });
    const onReadiness = (p: MediaReadinessPayload) => patch({ readiness: p });
    const onMediaWait = (p: { questionIndex: number; until: number }) => patch({ mediaWait: p });
    const onPosition = (p: MediaPositionPayload) =>
      patch({ mediaPosition: { ...p, receivedAt: performance.now() } });
    const onGameMedia = (p: {
      title?: string;
      hasSound: boolean;
      hasMedia: boolean;
      audioTarget: AudioTarget;
    }) =>
      patch({
        quizHasSound: p.hasSound,
        quizHasMedia: p.hasMedia,
        gameAudioTarget: p.audioTarget,
        ...(p.title !== undefined ? { quizTitle: p.title } : {}),
      });
    const onStandings = (p: RoomStandingsPayload) => patch({ standings: p });
    const onLobbyYou = (p: { ready: boolean }) => patch({ youReady: p.ready });
    const onLobbyCount = (p: { ready: number; total: number }) => patch({ lobbyCount: p });
    const onSounds = (p: RoomSoundsPayload) => patch({ sounds: p });
    const onMotion = (p: { on: boolean }) => patch({ motion: p.on });
    const onRoomInfo = (p: { name: string | null; hostName: string }) =>
      patch({ roomName: p.name, hostName: p.hostName });
    const onMediaControl = (p: MediaControlPayload) =>
      setView((prev) => ({
        ...prev,
        mediaControl: {
          ...p,
          seq: (prev.mediaControl?.seq ?? 0) + 1,
          receivedAt: performance.now(),
        },
      }));
    const onPodium = (p: PodiumPayload) =>
      patch({
        podium: p,
        state: 'PODIUM' as GameState,
        feedbackEnabled: p.feedbackEnabled ?? true,
        // Only a quiz they played: someone who joined at its podium has no line in it.
        rateable: p.you
          ? { quizId: p.quizId ?? null, feedbackEnabled: p.feedbackEnabled ?? true }
          : null,
      });
    const onEnded = (p: { feedbackEnabled?: boolean; quizId?: string }) =>
      setView((prev) => ({
        ...prev,
        state: 'ENDED' as GameState,
        feedbackEnabled: p?.feedbackEnabled ?? true,
        // Ended mid-quiz: that quiz. Closed at a podium or in a lobby: the one played before.
        rateable:
          prev.state === 'PODIUM' || prev.state === 'LOBBY'
            ? prev.rateable
            : { quizId: p?.quizId ?? null, feedbackEnabled: p?.feedbackEnabled ?? true },
      }));
    const onNotice = (p: SessionNotice) =>
      patch({
        fullCapture: p.fullCapture,
        personalTracking: p.personalTracking,
        pickOwnName: p.pickOwnName,
        participantAccess: p.participantAccess,
        joinLocked: p.joinLocked,
      });
    // Banni par l'hôte : on purge la session locale (pas d'auto-reconnexion) et on
    // bascule la vue en écran d'exclusion.
    const onKicked = (p: { minutes: number }) => {
      clearPlayerSession();
      patch({ kicked: p });
    };

    // Every event this view follows, taken on and off together: one list, never two to keep in step.
    // The connection itself (socket.io's own events, outside the contract): down until it is back.
    // Letting go of it on purpose (leaving the game) is not a loss.
    const onDisconnect = (reason: string) => {
      if (reason !== 'io client disconnect') patch({ connectionLost: true });
    };
    const onConnect = () => patch({ connectionLost: false });

    const handlers = {
      'game:state': onState,
      'game:roster': onRoster,
      'player:joined': onJoined,
      'player:left': onLeft,
      'question:start': onQuestion,
      'game:mode': onMode,
      'game:join-url': onJoinUrl,
      'game:outline': onOutline,
      'question:time': onTime,
      'answer:count': onCount,
      'answer:ack': onAck,
      'question:reveal': onReveal,
      'slide:show': onSlide,
      leaderboard: onLeaderboard,
      'media:preload': onPreload,
      'media:readiness': onReadiness,
      'media:position': onPosition,
      'media:wait': onMediaWait,
      'media:control': onMediaControl,
      'game:media': onGameMedia,
      'game:podium': onPodium,
      'room:standings': onStandings,
      'room:info': onRoomInfo,
      'lobby:you': onLobbyYou,
      'lobby:count': onLobbyCount,
      'room:sounds': onSounds,
      'room:motion': onMotion,
      'game:ended': onEnded,
      notice: onNotice,
      kicked: onKicked,
    } satisfies Partial<ServerToClientEvents>;
    const events = Object.entries(handlers) as [keyof ServerToClientEvents, never][];

    void ensureGameSocket(role === 'host' ? 'host' : 'guest', pin).then((sock) => {
      if (!active) return;
      s = sock;
      socketRef.current = sock;

      for (const [event, handler] of events) sock.on(event, handler);
      sock.on('disconnect', onDisconnect);
      sock.on('connect', onConnect);

      // Kick — listeners déjà en place : la rafale `sendStateTo` ne peut être ratée.
      // Rejoué à chaque (re)connexion : après un redémarrage du serveur, le socket
      // revient seul mais n'est plus dans la room — sans ré-attache, l'écran se fige.
      const kick = () => {
        if (!active) return;
        if (role === 'host') {
          sock.emit('host:attach', { pin }, (res: { ok: boolean }) => {
            if (active && !res.ok) patch({ status: 'error', error: sessionNotFound() });
          });
        } else if (role === 'spectator') {
          sock.emit('spectator:join', { pin, follow }, (res: { ok: boolean }) => {
            if (active && !res.ok) patch({ status: 'error', error: sessionNotFound() });
          });
        } else {
          const session = loadPlayerSession();
          if (session && session.pin === pin) {
            sock.emit(
              'player:reconnect',
              { sessionToken: session.sessionToken },
              (res: { ok: boolean }) => {
                if (!active) return;
                if (!res.ok) {
                  clearPlayerSession();
                  patch({ status: 'no-session' });
                }
              },
            );
          } else {
            patch({ status: 'no-session' });
          }
        }
      };
      kick();
      // `io` is the socket.io manager (absent on the lighter fakes some tests use).
      sock.io?.on('reconnect', kick);
      reconnectHandler = kick;
    });

    return () => {
      active = false;
      if (!s) return;
      if (reconnectHandler) s.io?.off('reconnect', reconnectHandler);
      for (const [event, handler] of events) s.off(event, handler);
      s.off('disconnect', onDisconnect);
      s.off('connect', onConnect);
    };
  }, [pin, role, follow]);

  /** Joueur : à appeler après un `player:join` réussi pour quitter `no-session`. */
  const markJoined = () => setView((prev) => ({ ...prev, status: 'ready' }));
  /** The participant said (or took back) that they are ready (#104), once the server took it. */
  const markReady = (ready: boolean) => setView((prev) => ({ ...prev, youReady: ready }));

  return { view, socket: socketRef.current, markJoined, markReady };
}
