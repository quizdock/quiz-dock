import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { setAuthHeaders } from '../api/http';
import { getOidc } from './oidc';

const STORAGE_KEY = 'live.localUser';

export type AuthMode = 'none' | 'oidc';

// État hors-React, lu par la garde de route (synchrone) et configuré au démarrage.
let currentMode: AuthMode = 'none';
let oidcAuthed = false;

/** Configure le mode + l'état OIDC restauré (appelé par main.tsx avant le rendu). */
export function configureAuth(mode: AuthMode, oidcUserAuthed = false): void {
  currentMode = mode;
  oidcAuthed = oidcUserAuthed;
}

/** Identité locale (mode none) — utilisée aussi par la garde. */
export function getLocalUser(): string | null {
  return localStorage.getItem(STORAGE_KEY);
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

interface AuthState {
  mode: AuthMode;
  user: string | null;
  /** Connexion mode local (nom). */
  loginLocal: (name: string) => void;
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

  const loginLocal = useCallback((name: string) => {
    const trimmed = name.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    applyLocalUser(trimmed);
    setUser(trimmed);
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
      await getOidc().removeUser();
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    applyLocalUser(null);
    setUser(null);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, user, loginLocal, loginOidc, completeOidcLogin, logout }),
    [mode, user, loginLocal, loginOidc, completeOidcLogin, logout],
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
