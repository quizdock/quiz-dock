import type {
  GameMode,
  GameModePayload,
  GameOutlinePayload,
  GameState,
  LeaderboardPayload,
  OutlineQuestion,
  PersonalResult,
  PodiumPayload,
  QuestionRevealPayload,
  QuestionStartPayload,
  QuestionTimePayload,
} from '@roux-quizz/contracts';
import { useEffect, useRef, useState } from 'react';
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
  answerCount: { answered: number; total: number } | null;
  reveal: QuestionRevealPayload | null;
  result: PersonalResult | null;
  leaderboard: LeaderboardPayload | null;
  podium: PodiumPayload | null;
  players: RosterPlayer[];
  answerAccepted: boolean | null;
  fullCapture: boolean;
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
  /** Description du quiz (récap console hôte), `null` si absente. */
  quizDescription: string | null;
  /** Sommaire des questions (console hôte uniquement). */
  outline: OutlineQuestion[];
}

const INITIAL: GameView = {
  status: 'connecting',
  error: null,
  state: null,
  questionIndex: -1,
  totalQuestions: 0,
  question: null,
  answerCount: null,
  reveal: null,
  result: null,
  leaderboard: null,
  podium: null,
  players: [],
  answerAccepted: null,
  fullCapture: false,
  kicked: null,
  mode: 'manual',
  paused: false,
  pausedRemainingMs: null,
  autoNextAt: null,
  autoNextMs: null,
  quizTitle: null,
  quizDescription: null,
  outline: [],
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
  const [view, setView] = useState<GameView>(INITIAL);
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    let active = true;
    let s: GameSocket | null = null;

    const patch = (p: Partial<GameView>) => setView((prev) => ({ ...prev, ...p }));

    const onState = (p: { state: GameState; questionIndex: number; totalQuestions: number }) =>
      patch({
        status: 'ready',
        state: p.state,
        questionIndex: p.questionIndex,
        totalQuestions: p.totalQuestions,
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
    const onMode = (p: GameModePayload) =>
      patch({
        mode: p.mode,
        paused: p.paused,
        pausedRemainingMs: p.remainingMs ?? null,
        autoNextAt: p.autoNextAt ?? null,
        autoNextMs: p.autoNextMs ?? null,
      });
    const onOutline = (p: GameOutlinePayload) =>
      patch({ quizTitle: p.title, quizDescription: p.description, outline: p.questions });
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
    const onReveal = (p: QuestionRevealPayload) =>
      patch({ reveal: p, result: p.yourResult ?? null });
    const onLeaderboard = (p: LeaderboardPayload) => patch({ leaderboard: p });
    const onPodium = (p: PodiumPayload) => patch({ podium: p, state: 'PODIUM' as GameState });
    const onEnded = () => patch({ state: 'ENDED' as GameState });
    const onNotice = (p: { fullCapture: boolean }) => patch({ fullCapture: p.fullCapture });
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
      sock.on('game:outline', onOutline);
      sock.on('question:time', onTime);
      sock.on('answer:count', onCount);
      sock.on('answer:ack', onAck);
      sock.on('question:reveal', onReveal);
      sock.on('leaderboard', onLeaderboard);
      sock.on('game:podium', onPodium);
      sock.on('game:ended', onEnded);
      sock.on('notice', onNotice);
      sock.on('kicked', onKicked);

      // Kick — listeners déjà en place : la rafale `sendStateTo` ne peut être ratée.
      if (role === 'host') {
        sock.emit('host:attach', { pin }, (res: { ok: boolean }) => {
          if (active && !res.ok)
            patch({ status: 'error', error: 'Partie introuvable ou terminée.' });
        });
      } else if (role === 'spectator') {
        sock.emit('spectator:join', { pin }, (res: { ok: boolean }) => {
          if (active && !res.ok)
            patch({ status: 'error', error: 'Partie introuvable ou terminée.' });
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
    });

    return () => {
      active = false;
      if (!s) return;
      s.off('game:state', onState);
      s.off('game:roster', onRoster);
      s.off('player:joined', onJoined);
      s.off('player:left', onLeft);
      s.off('question:start', onQuestion);
      s.off('game:mode', onMode);
      s.off('game:outline', onOutline);
      s.off('question:time', onTime);
      s.off('answer:count', onCount);
      s.off('answer:ack', onAck);
      s.off('question:reveal', onReveal);
      s.off('leaderboard', onLeaderboard);
      s.off('game:podium', onPodium);
      s.off('game:ended', onEnded);
      s.off('notice', onNotice);
      s.off('kicked', onKicked);
    };
  }, [pin, role]);

  /** Joueur : à appeler après un `player:join` réussi pour quitter `no-session`. */
  const markJoined = () => setView((prev) => ({ ...prev, status: 'ready' }));

  return { view, socket: socketRef.current, markJoined };
}
