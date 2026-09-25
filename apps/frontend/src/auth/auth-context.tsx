import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  hostSeatControllerClaim,
  hostSeatControllerRelease,
  oidcSessionControllerCallback,
  oidcSessionControllerLogin,
  oidcSessionControllerLogout,
} from '../api/generated/auth/auth';
import { meControllerMe } from '../api/generated/me/me';
import { setAuthHeaders, setSessionAuthed, setUnauthorizedHandler } from '../api/http';
import { getDemo } from '../config';

const STORAGE_KEY = 'live.localUser';
const AFTER_LOGIN_KEY = 'live.afterLogin';

export type AuthMode = 'none' | 'oidc';
export type UserRole = 'host' | 'player' | 'admin';

// État hors-React, lu par la garde de route (synchrone) et configuré au démarrage.
let currentMode: AuthMode = 'none';
let oidcAuthed = false;

/** Configure le mode + l'état OIDC restauré (appelé par main.tsx avant le rendu). */
export function configureAuth(mode: AuthMode, oidcUserAuthed = false): void {
  currentMode = mode;
  oidcAuthed = oidcUserAuthed;
  setSessionAuthed(mode === 'oidc' && oidcUserAuthed);
}

/** Tells the other tabs of this browser that the session is over. */
const SIGN_OUT_CHANNEL = 'quizdock-auth';

function broadcastSignOut(): void {
  try {
    const channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
    channel.postMessage('signed-out');
    channel.close();
  } catch {
    // No BroadcastChannel: the other tabs find out at their next request (401).
  }
}

/**
 * Suit la session OIDC (mode oidc) : le backend la tient, le navigateur n'a qu'un
 * cookie `httpOnly`. Un 401 du backend (session finie ou refusée par le
 * fournisseur) ou une déconnexion dans un autre onglet ramène à la connexion.
 */
export function bindOidcSession(): void {
  const dropSession = () => {
    oidcAuthed = false;
    setSessionAuthed(false);
    if (window.location.pathname !== '/login') window.location.assign('/login');
  };
  setUnauthorizedHandler(dropSession);
  try {
    new BroadcastChannel(SIGN_OUT_CHANNEL).onmessage = (e) => {
      if (e.data === 'signed-out' && oidcAuthed) dropSession();
    };
  } catch {
    // See broadcastSignOut.
  }
}

/**
 * Tokens an earlier version kept in this browser's storage (`oidc-client-ts`):
 * nothing reads them any more, and they must not linger — a token is exactly
 * what the move to a server-side session keeps away from scripts.
 */
export function forgetStoredTokens(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(store)) {
        if (key.startsWith('oidc.')) store.removeItem(key);
      }
    } catch {
      // Storage disabled: there is nothing in it either.
    }
  }
}

/** Identité locale (mode none) — utilisée aussi par la garde. */
export function getLocalUser(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  // A demo serves one shared account whatever the name: a name kept from before
  // would only show the wrong one in the menu.
  const demo = getDemo();
  if (stored && demo && stored !== demo.user) {
    localStorage.setItem(STORAGE_KEY, demo.user);
    return demo.user;
  }
  return stored;
}

/**
 * Page the sign-in was triggered from (a participant sent to `/login` by the
 * guard, RG-15). Kept for the round trip to the IdP only — the callback reads it
 * once and falls back to the dashboard, which is where an host lands.
 */
export function rememberAfterLogin(path: string): void {
  try {
    sessionStorage.setItem(AFTER_LOGIN_KEY, path);
  } catch {
    // Private browsing / storage disabled: the callback simply goes to its default.
  }
}

/** Same, without consuming it: the login page adapts its wording to it. */
export function peekAfterLogin(): string | null {
  try {
    return sessionStorage.getItem(AFTER_LOGIN_KEY);
  } catch {
    return null;
  }
}

export function takeAfterLogin(): string | null {
  try {
    const path = sessionStorage.getItem(AFTER_LOGIN_KEY);
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    // Internal paths only: never send the browser somewhere a crafted link chose.
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

/** Garde de route synchrone : l'utilisateur est-il authentifié ? */
export function isAuthenticated(): boolean {
  return currentMode === 'oidc' ? oidcAuthed : !!getLocalUser();
}

export function getAuthMode(): AuthMode {
  return currentMode;
}

function applyLocalUser(name: string | null): void {
  setAuthHeaders(name ? { 'X-Local-User': name } : {});
}

/**
 * Rôles côté backend de l'identité courante (`GET /me`), ou `null` si injoignable.
 * En mode local c'est ici que le **siège d'hôte** se décide : le premier arrivé
 * devient `host`, les autres restent participants. L'ensemble peut porter les
 * deux rôles (RG-14) ; la page de connexion ne regarde que « puis-je animer ? ».
 */
export async function fetchRole(): Promise<UserRole | null> {
  try {
    const { data } = await meControllerMe();
    const roles = (data.roles ?? []) as UserRole[];
    if (roles.includes('host')) return 'host';
    if (roles.includes('admin')) return 'admin';
    return 'player';
  } catch {
    return null;
  }
}

interface AuthState {
  mode: AuthMode;
  user: string | null;
  /**
   * Connexion mode local (nom). Résout le rôle courant : `host` = titulaire du
   * siège d'hôte, `player` = pas (encore) titulaire, `null` = backend injoignable.
   * L'identité reste posée ; la page décide (prise du siège ou `dropLocal`).
   */
  loginLocal: (name: string) => Promise<UserRole | null>;
  /** Prise **intentionnelle** du siège d'hôte (mode local), après confirmation. */
  claimHostSeat: (expiresInMinutes: number | null) => Promise<void>;
  /** Abandonne l'identité locale sans passer par le backend (siège refusé / annulé). */
  dropLocal: () => void;
  /** Connexion mode OIDC (redirection vers le fournisseur, préparée par le backend). */
  loginOidc: () => Promise<void>;
  /** Finalise le retour du fournisseur (route /auth/callback) : le backend échange le code. */
  completeOidcLogin: (params: URLSearchParams) => Promise<void>;
  logout: () => void | Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  mode = 'none',
  initialUser = null,
}: {
  children: ReactNode;
  mode?: AuthMode;
  initialUser?: string | null;
}) {
  const [user, setUser] = useState<string | null>(() => {
    if (mode === 'oidc') return initialUser;
    const stored = getLocalUser();
    applyLocalUser(stored); // synchrone, avant tout rendu enfant
    return stored;
  });

  const loginLocal = useCallback(async (name: string) => {
    const trimmed = name.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    applyLocalUser(trimmed);
    setUser(trimmed);
    return fetchRole();
  }, []);

  const claimHostSeat = useCallback(async (expiresInMinutes: number | null) => {
    await hostSeatControllerClaim({ expiresInMinutes });
  }, []);

  const dropLocal = useCallback(() => {
    // Pas d'identité conservée : sinon la garde de route et la nav la
    // traiteraient comme un hôte connecté.
    localStorage.removeItem(STORAGE_KEY);
    applyLocalUser(null);
    setUser(null);
  }, []);

  const loginOidc = useCallback(async () => {
    const { data } = await oidcSessionControllerLogin();
    if (data.url) window.location.assign(data.url);
  }, []);

  const completeOidcLogin = useCallback(async (params: URLSearchParams) => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state)
      throw new Error(params.get('error_description') ?? params.get('error') ?? 'OIDC');
    const iss = params.get('iss') ?? undefined;
    const { data } = await oidcSessionControllerCallback({ code, state, iss });
    oidcAuthed = true;
    setSessionAuthed(true);
    setUser(data && 'name' in data ? data.name : null);
  }, []);

  const logout = useCallback(async () => {
    if (mode === 'oidc') {
      oidcAuthed = false;
      setSessionAuthed(false);
      setUser(null);
      broadcastSignOut();
      // The backend ends its session, then the provider's (RP-initiated logout,
      // when it has an end-session endpoint).
      const url = await oidcSessionControllerLogout()
        .then(({ data }) => data.url)
        .catch(() => null);
      window.location.assign(url ?? '/');
      return;
    } else {
      // Rend le siège d'hôte (no-op si on ne le tenait pas) avant d'oublier l'identité.
      await hostSeatControllerRelease().catch(() => undefined);
      localStorage.removeItem(STORAGE_KEY);
    }
    applyLocalUser(null);
    setUser(null);
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      user,
      loginLocal,
      claimHostSeat,
      dropLocal,
      loginOidc,
      completeOidcLogin,
      logout,
    }),
    [mode, user, loginLocal, claimHostSeat, dropLocal, loginOidc, completeOidcLogin, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  }
  return ctx;
}
