import type { ClientToServerEvents, ServerToClientEvents } from '@roux-quizz/contracts';
import i18next from 'i18next';
import { type Socket, io } from 'socket.io-client';
import { errorText } from '../api/error-text';
import { getAccessToken, getLocalUser } from '../auth/auth-context';

/** Socket typé bout-en-bout (écoute serveur→client, émet client→serveur). */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 8_000;

// Singleton (comme getOidc) : le socket survit aux navigations entre lobby et
// écrans de jeu, et n'est jamais recréé par un effet de montage.
let socket: GameSocket | null = null;
// Connexion en vol : dédoublonne les appels concurrents (double-montage StrictMode)
// pour ne jamais créer deux sockets `forceNew` dont le premier fuirait.
let connecting: Promise<GameSocket> | null = null;

/** Le socket courant (ou `null` si non connecté). */
export function getGameSocket(): GameSocket | null {
  return socket;
}

/** Ferme et oublie le socket courant. */
export function disconnectGame(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Garantit un socket unique : réutilise le singleton s'il existe (navigation /
 * arrivée depuis `host:create` ou `player:join`), sinon connecte selon le rôle
 * (`host` = authentifié ; `guest` = spectateur/joueur). Les appels concurrents
 * partagent la même promesse → un seul socket.
 */
export function ensureGameSocket(role: 'host' | 'guest'): Promise<GameSocket> {
  if (socket) return Promise.resolve(socket);
  if (connecting) return connecting;
  connecting = (role === 'host' ? connectHost() : Promise.resolve(connectPlayer())).then((s) => {
    connecting = null;
    return s;
  });
  return connecting;
}

/** Session joueur persistée pour la reconnexion (§6.1, clé `roux.session`). */
export interface PlayerSession {
  pin: string;
  sessionToken: string;
  playerId: string;
  nickname: string;
}

const SESSION_KEY = 'roux.session';

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
 * Connexion **hôte** : auth dérivée du contexte (mode oidc → `token` = access
 * token ; mode none → `localUser`). Asynchrone car le token OIDC l'est.
 */
export async function connectHost(): Promise<GameSocket> {
  const token = await getAccessToken();
  const auth = token ? { token } : { localUser: getLocalUser() ?? i18next.t('live:fallbackHost') };
  socket = io('/game', { auth, forceNew: true });
  return socket;
}

/** Connexion **joueur** : aucune auth (invité — le backend l'accepte tel quel). */
export function connectPlayer(): GameSocket {
  socket = io('/game', { forceNew: true });
  return socket;
}

/**
 * Émet un event à accusé de réception, mais **rejette dès l'event `error`** typé
 * du serveur (sur échec, le backend émet `error` et n'appelle jamais l'ack → sans
 * cette course, l'appelant resterait bloqué indéfiniment).
 */
export function emitWithAckOrError<T>(
  s: GameSocket,
  event: keyof ClientToServerEvents,
  payload: unknown,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      s.off('error', onError);
    };
    const onError = (e: { code: string; params?: Record<string, string | number> }) => {
      cleanup();
      reject(new Error(errorText(e.code, e.params)));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(i18next.t('live:errors.noResponse')));
    }, timeoutMs);

    s.once('error', onError);
    (s.emit as (e: string, p: unknown, ack: (res: T) => void) => void)(event, payload, (res) => {
      cleanup();
      resolve(res);
    });
  });
}

/** Hôte : ouvre une partie pour `quizId`, renvoie le PIN. */
export async function createSession(quizId: string, fullCapture = false): Promise<{ pin: string }> {
  const s = await connectHost();
  return emitWithAckOrError<{ pin: string }>(s, 'host:create', { quizId, fullCapture });
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
): Promise<{ sessionToken: string; playerId: string }> {
  const s = await ensureGameSocket('guest');
  const res = await emitWithAckOrError<{ sessionToken: string; playerId: string }>(
    s,
    'player:join',
    { pin, nickname, avatar },
  );
  savePlayerSession({ pin, nickname, ...res }); // reprise après fermeture (§6.1)
  return res;
}

/**
 * Graine d'avatar persistée **séparément** de la session (clé propre) : un ban
 * efface la session mais pas l'avatar, qui est ainsi réinjecté dans les parties
 * suivantes. Cosmétique côté client (METIER §79).
 */
const AVATAR_KEY = 'roux.avatar';

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
