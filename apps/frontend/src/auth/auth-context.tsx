import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { hostSeatControllerClaim, hostSeatControllerRelease } from '../api/generated/auth/auth';
import { meControllerMe } from '../api/generated/me/me';
import { setAuthHeaders, setUnauthorizedHandler } from '../api/http';
import { getDemo } from '../config';
import { getOidc } from './oidc';

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
}

/**
 * Suit le cycle de vie du jeton OIDC (mode oidc, après `initOidc`) : chaque
 * renouvellement silencieux remplace l'en-tête Bearer ; une expiration sans
 * renouvellement, un 401 du backend, ou une déconnexion dans un autre onglet,
 * ramène à la page de connexion.
 */
export function bindOidcSession(): void {
  const events = getOidc().events;
  events.addUserLoaded((u) => {
    setAuthHeaders({ Authorization: `Bearer ${u.access_token}` });
    oidcAuthed = true;
  });
  const dropSession = () => {
    oidcAuthed = false;
    setAuthHeaders({});
    void getOidc().removeUser();
    if (window.location.pathname !== '/login') window.location.assign('/login');
  };
  events.addAccessTokenExpired(dropSession);
  events.addUserSignedOut(dropSession);
  setUnauthorizedHandler(dropSession);
  // The session is shared by the tabs (localStorage): signed out in one, signed
  // out in all — another tab never keeps a token its user gave back.
  window.addEventListener('storage', (e) => {
    if (!oidcAuthed || e.newValue !== null || !e.key?.startsWith('oidc.user:')) return;
    oidcAuthed = false;
    setAuthHeaders({});
    if (window.location.pathname !== '/login') window.location.assign('/login');
  });
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

/**
 * Jeton d'accès OIDC courant (mode oidc), pour le handshake WebSocket. `null` en
 * mode none (l'hôte s'y identifie par son nom local via `getLocalUser`).
 */
export async function getAccessToken(): Promise<string | null> {
  if (currentMode !== 'oidc') return null;
  const user = await getOidc().getUser();
  return user?.access_token ?? null;
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
  /** Connexion mode OIDC (redirection vers l'IdP). */
  loginOidc: () => Promise<void>;
  /** Finalise le retour de redirection OIDC (route /auth/callback). */
  completeOidcLogin: () => Promise<void>;
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
    await getOidc().signinRedirect();
  }, []);

  const completeOidcLogin = useCallback(async () => {
    const oidcUser = await getOidc().signinRedirectCallback();
    setAuthHeaders({ Authorization: `Bearer ${oidcUser.access_token}` });
    oidcAuthed = true;
    const profile = oidcUser.profile;
    setUser(profile.name ?? profile.preferred_username ?? profile.sub ?? 'Animateur');
  }, []);

  const logout = useCallback(async () => {
    if (mode === 'oidc') {
      oidcAuthed = false;
      setAuthHeaders({});
      setUser(null);
      // RP-initiated logout (end_session_endpoint) ; repli local si le
      // fournisseur n'en expose pas.
      try {
        await getOidc().signoutRedirect();
        return; // navigation en cours vers l'IdP
      } catch {
        await getOidc().removeUser();
      }
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
