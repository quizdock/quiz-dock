import type {
  GameMode,
  GameModePayload,
  GameOutlinePayload,
  GameState,
  GameStatePayload,
  GameStep,
  LeaderboardPayload,
  MediaPreloadPayload,
  OutlineQuestion,
  PersonalResult,
  PodiumPayload,
  QuestionRevealPayload,
  QuestionStartPayload,
  QuestionTimePayload,
  SlideShowPayload,
} from '@quiz-dock/contracts';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  fullCapture: boolean;
  /** Suivi individuel (RG-16) : faux = seuls les résultats du groupe sont archivés. */
  personalTracking: boolean;
  /** Les participants choisissent leur nom affiché ; sinon il vient de leur compte. */
  pickOwnName: boolean;
  /** Renseigné si l'hôte a banni ce joueur (durée en minutes) — son client l'affiche. */
  kicked: { minutes: number } | null;
  /** Rythme courant (§8) — `manual` par défaut. */
  mode: GameMode;
  /** Auto-progression suspendue par l'hôte (chrono gelé en ANSWERING). */
  paused: boolean;
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
  /** Media of the next question, to fetch ahead (projection and console only). */
  preload: MediaPreloadPayload | null;
  /** Host navigation over played steps (`game:state.nav`); `review` = a past step is on screen. */
  nav: { prev: GameStep | null; next: GameStep | null; review: boolean } | null;
}

const INITIAL: GameView = {
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
  fullCapture: false,
  personalTracking: true,
  pickOwnName: true,
  kicked: null,
  mode: 'manual',
  paused: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizId: null,
  quizDescription: null,
  joinBaseUrl: null,
  outline: [],
  preload: null,
  nav: null,
};

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
export function useGameSession(pin: string, role: LiveRole) {
  const { t } = useTranslation('live');
  const [view, setView] = useState<GameView>(INITIAL);
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
        ...(p.state === 'ANSWERING' ? { reveal: null, result: null, answerAccepted: null } : {}),
      });
    const onRoster = (p: { players: RosterPlayer[] }) => patch({ players: p.players });
    const onJoined = (p: { playerId: string; nickname: string; avatar?: string }) =>
      setView((prev) =>
        prev.players.some((x) => x.playerId === p.playerId)
          ? prev
          : {
              ...prev,
              players: [
                ...prev.players,
                { playerId: p.playerId, nickname: p.nickname, avatar: p.avatar },
              ],
            },
      );
    const onLeft = (p: { playerId: string }) =>
      setView((prev) => ({
        ...prev,
        players: prev.players.filter((x) => x.playerId !== p.playerId),
      }));
    const onQuestion = (p: QuestionStartPayload) => patch({ question: p });
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
      });
    // Ajustement du chrono : on remplace les timings de la question courante (le
    // décompte est dérivé de `endsAt`), sans toucher au reste de son contenu.
    const onTime = (p: QuestionTimePayload) =>
      setView((prev) =>
        prev.question && prev.question.questionIndex === p.questionIndex
          ? { ...prev, question: { ...prev.question, startedAt: p.startedAt, endsAt: p.endsAt } }
          : prev,
      );
    const onCount = (p: { answered: number; total: number }) => patch({ answerCount: p });
    const onAck = (p: { accepted: boolean }) => patch({ answerAccepted: p.accepted });
    const onSlide = (p: SlideShowPayload) => patch({ slide: p });
    const onReveal = (p: QuestionRevealPayload) =>
      patch({ reveal: p, result: p.yourResult ?? null });
    const onLeaderboard = (p: LeaderboardPayload) => patch({ leaderboard: p });
    const onPreload = (p: MediaPreloadPayload) => patch({ preload: p });
    const onPodium = (p: PodiumPayload) =>
      patch({
        podium: p,
        state: 'PODIUM' as GameState,
        feedbackEnabled: p.feedbackEnabled ?? true,
      });
    const onEnded = (p: { feedbackEnabled?: boolean }) =>
      patch({ state: 'ENDED' as GameState, feedbackEnabled: p?.feedbackEnabled ?? true });
    const onNotice = (p: {
      fullCapture: boolean;
      personalTracking: boolean;
      pickOwnName: boolean;
    }) =>
      patch({
        fullCapture: p.fullCapture,
        personalTracking: p.personalTracking,
        pickOwnName: p.pickOwnName,
      });
    // Banni par l'hôte : on purge la session locale (pas d'auto-reconnexion) et on
    // bascule la vue en écran d'exclusion.
    const onKicked = (p: { minutes: number }) => {
      clearPlayerSession();
      patch({ kicked: p });
    };

    void ensureGameSocket(role === 'host' ? 'host' : 'guest').then((sock) => {
      if (!active) return;
      s = sock;
      socketRef.current = sock;

      sock.on('game:state', onState);
      sock.on('game:roster', onRoster);
      sock.on('player:joined', onJoined);
      sock.on('player:left', onLeft);
      sock.on('question:start', onQuestion);
      sock.on('game:mode', onMode);
      sock.on('game:join-url', onJoinUrl);
      sock.on('game:outline', onOutline);
      sock.on('question:time', onTime);
      sock.on('answer:count', onCount);
      sock.on('answer:ack', onAck);
      sock.on('question:reveal', onReveal);
      sock.on('slide:show', onSlide);
      sock.on('leaderboard', onLeaderboard);
      sock.on('media:preload', onPreload);
      sock.on('game:podium', onPodium);
      sock.on('game:ended', onEnded);
      sock.on('notice', onNotice);
      sock.on('kicked', onKicked);

      // Kick — listeners déjà en place : la rafale `sendStateTo` ne peut être ratée.
      // Rejoué à chaque (re)connexion : après un redémarrage du serveur, le socket
      // revient seul mais n'est plus dans la room — sans ré-attache, l'écran se fige.
      const kick = () => {
        if (!active) return;
        if (role === 'host') {
          sock.emit('host:attach', { pin }, (res: { ok: boolean }) => {
            if (active && !res.ok) patch({ status: 'error', error: t('errors.sessionNotFound') });
          });
        } else if (role === 'spectator') {
          sock.emit('spectator:join', { pin }, (res: { ok: boolean }) => {
            if (active && !res.ok) patch({ status: 'error', error: t('errors.sessionNotFound') });
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
      s.off('game:state', onState);
      s.off('game:roster', onRoster);
      s.off('player:joined', onJoined);
      s.off('player:left', onLeft);
      s.off('question:start', onQuestion);
      s.off('game:mode', onMode);
      s.off('game:join-url', onJoinUrl);
      s.off('game:outline', onOutline);
      s.off('question:time', onTime);
      s.off('answer:count', onCount);
      s.off('answer:ack', onAck);
      s.off('question:reveal', onReveal);
      s.off('slide:show', onSlide);
      s.off('leaderboard', onLeaderboard);
      s.off('media:preload', onPreload);
      s.off('game:podium', onPodium);
      s.off('game:ended', onEnded);
      s.off('notice', onNotice);
      s.off('kicked', onKicked);
    };
  }, [pin, role, t]);

  /** Joueur : à appeler après un `player:join` réussi pour quitter `no-session`. */
  const markJoined = () => setView((prev) => ({ ...prev, status: 'ready' }));

  return { view, socket: socketRef.current, markJoined };
}
