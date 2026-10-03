import type {
  ClientToServerEvents,
  ParticipantAccess,
  PlayerPeek,
  PlayerPresence,
  ServerToClientEvents,
} from '@quiz-dock/contracts';
import i18next from 'i18next';
import { type Socket, io } from 'socket.io-client';
import { errorText } from '../api/error-text';
import { calibrateClock } from './clock';
import { getAuthMode, getLocalUser } from '../auth/auth-context';

/** Socket typé bout-en-bout (écoute serveur→client, émet client→serveur). */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 8_000;

// Singleton : le socket survit aux navigations entre lobby et
// écrans de jeu, et n'est jamais recréé par un effet de montage.
let socket: GameSocket | null = null;
/** The room the socket serves, once a live page took it: one socket, one room. */
let socketPin: string | null = null;
// Connexion en vol : dédoublonne les appels concurrents (double-montage StrictMode)
// pour ne jamais créer deux sockets `forceNew` dont le premier fuirait.
let connecting: Promise<GameSocket> | null = null;

/** Ferme et oublie le socket courant. */
export function disconnectGame(): void {
  socket?.disconnect();
  socket = null;
  socketPin = null;
}

/**
 * Garantit un socket unique : réutilise le singleton s'il existe (navigation /
 * arrivée depuis `host:create` ou `player:join`), sinon connecte selon le rôle
 * (`host` = authentifié ; `guest` = spectateur/joueur). Les appels concurrents
 * partagent la même promesse → un seul socket.
 */
export function ensureGameSocket(role: 'host' | 'guest', pin?: string): Promise<GameSocket> {
  // Another room's page: the socket of the previous one goes, or it would keep
  // receiving that room's events (the server leaves it there).
  if (socket && pin && socketPin && socketPin !== pin) disconnectGame();
  if (socket) {
    if (pin) socketPin = pin;
    return Promise.resolve(socket);
  }
  if (connecting) return connecting;
  connecting = (role === 'host' ? connectHost() : Promise.resolve(connectPlayer())).then((s) => {
    connecting = null;
    if (pin) socketPin = pin;
    return s;
  });
  return connecting;
}

/** Session joueur persistée pour la reconnexion (§6.1, clé `live.session`). */
export interface PlayerSession {
  pin: string;
  sessionToken: string;
  playerId: string;
  nickname: string;
}

const SESSION_KEY = 'live.session';

export function savePlayerSession(s: PlayerSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // stockage indisponible (mode privé strict) : la reconnexion ne sera pas offerte.
  }
}

export function loadPlayerSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PlayerSession) : null;
  } catch {
    return null;
  }
}

export function clearPlayerSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Connexion **hôte** : en mode oidc, le cookie de session suffit (le navigateur le
 * joint au handshake) ; en mode none, le nom local.
 */
export async function connectHost(): Promise<GameSocket> {
  // A host opening another game from the dashboard: the previous socket goes.
  disconnectGame();
  socket = io('/game', {
    // Re-read at every (re)connection.
    auth: (cb) =>
      cb(
        getAuthMode() === 'oidc'
          ? {}
          : { localUser: getLocalUser() ?? i18next.t('live:fallbackHost') },
      ),
    forceNew: true,
  });
  calibrateClock(socket);
  return socket;
}

/**
 * Connexion **joueur** : sous `AUTH_MODE=oidc`, le cookie de session quand il y en
 * a un — une partie qui exige un compte le lit au handshake (RG-15) —, sinon
 * invité (le backend l'accepte tel quel). Jamais de nom local : il réclamerait le
 * siège d'hôte.
 */
export function connectPlayer(): GameSocket {
  disconnectGame();
  socket = io('/game', { forceNew: true });
  calibrateClock(socket);
  return socket;
}

/**
 * Emits and waits for the server's answer. A refusal comes back as that answer
 * (`{ ok: false, error }`, see the backend's `WsExceptionFilter`) and rejects,
 * with its text and its code; no answer in time rejects too (a lost answer would
 * otherwise leave the caller waiting forever).
 */
export function emitWithAckOrError<T>(
  s: GameSocket,
  event: keyof ClientToServerEvents,
  payload: unknown,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(i18next.t('live:errors.noResponse')));
    }, timeoutMs);
    (s.emit as (e: string, p: unknown, ack: (res: T) => void) => void)(event, payload, (res) => {
      clearTimeout(timer);
      const refusal = refusalOf(res);
      if (refusal) reject(refusalError(refusal));
      else resolve(res);
    });
  });
}

/** A request's refusal, as the server answers it. */
export interface WsRefusal {
  ok: false;
  error: { code: string; params?: Record<string, string | number> };
}

/** The refusal an answer carries, if it is one. */
export function refusalOf(res: unknown): WsRefusal['error'] | null {
  const r = res as Partial<WsRefusal> | null;
  return r && typeof r === 'object' && r.ok === false && r.error ? r.error : null;
}

/** An error to show: its text for whoever shows it, its code for whoever decides on it. */
export function refusalError(e: WsRefusal['error']): Error & { code: string } {
  return Object.assign(new Error(errorText(e.code, e.params)), { code: e.code });
}

/** Options de session choisies au lancement (RG-15, RG-16). */
export interface SessionOptions {
  fullCapture?: boolean;
  personalTracking?: boolean;
  pickOwnName?: boolean;
  /** How participants get in, fixed for the whole game (#57). */
  participantAccess?: ParticipantAccess;
}

/** Hôte : ouvre une partie pour `quizId`, renvoie le PIN. */
export async function createSession(
  quizId: string,
  options: SessionOptions = {},
): Promise<{ pin: string }> {
  const s = await connectHost();
  return emitWithAckOrError<{ pin: string }>(s, 'host:create', { quizId, ...options });
}

/**
 * Joueur : rejoint la partie `pin`, renvoie le jeton de session + playerId.
 * **Réutilise le socket existant** (`ensureGameSocket`) — celui sur lequel le hook
 * a posé ses listeners : sinon le `player:join` partirait sur un 2ᵉ socket et la
 * rafale d'état (roster, `question:start`) + les `player:submit` seraient perdus.
 */
export async function joinSession(
  pin: string,
  nickname: string,
  avatar?: string,
  presence?: PlayerPresence,
): Promise<{ sessionToken: string; playerId: string; nickname: string }> {
  const s = await ensureGameSocket('guest', pin);
  const res = await emitWithAckOrError<{
    sessionToken: string;
    playerId: string;
    nickname: string;
  }>(s, 'player:join', { pin, nickname, avatar, presence });
  // Le serveur peut avoir retenu un autre nom (nom du compte, homonyme suffixé) :
  // c'est le sien qu'on garde, sinon l'écran du participant contredirait la salle.
  const retained = res.nickname || nickname;
  savePlayerSession({ pin, ...res, nickname: retained }); // reprise après fermeture (§6.1)
  saveNickname(retained);
  return res;
}

/** What a player learns before joining (#57): the contract's peek. */
export type SessionPeek = PlayerPeek;

export async function peekSession(pin: string): Promise<SessionPeek> {
  const s = await ensureGameSocket('guest');
  return emitWithAckOrError<SessionPeek>(s, 'player:peek', { pin });
}

/**
 * Graine d'avatar persistée **séparément** de la session (clé propre) : un ban
 * efface la session mais pas l'avatar, qui est ainsi réinjecté dans les parties
 * suivantes. Cosmétique côté client (METIER §79).
 */
const AVATAR_KEY = 'live.avatar';

export function loadAvatarSeed(): string | null {
  try {
    return localStorage.getItem(AVATAR_KEY);
  } catch {
    return null;
  }
}

export function saveAvatarSeed(seed: string): void {
  try {
    localStorage.setItem(AVATAR_KEY, seed);
  } catch {
    /* stockage indisponible : l'avatar ne sera pas mémorisé */
  }
}

/**
 * Last nickname used, kept across games (the session record is purged at the end
 * of a game, the name should not be). Only the player changes it.
 */
const NICKNAME_KEY = 'live.nickname';

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    /* storage unavailable: the nickname is not remembered */
  }
}
