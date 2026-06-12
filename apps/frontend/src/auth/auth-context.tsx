import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { setAuthHeaders } from '../api/http';

const STORAGE_KEY = 'roux.localUser';

/** Applique l'identité locale aux en-têtes du client API (mode `AUTH_MODE=none`). */
function applyLocalUser(name: string | null): void {
  setAuthHeaders(name ? { 'X-Local-User': name } : {});
}

/** Lu hors React (gardes de route) : l'utilisateur est-il identifié ? */
export function getLocalUser(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

interface AuthState {
  localUser: string | null;
  login: (name: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [localUser, setLocalUser] = useState<string | null>(() => {
    const stored = getLocalUser();
    applyLocalUser(stored); // synchrone, avant tout rendu enfant
    return stored;
  });

  const login = useCallback((name: string) => {
    const trimmed = name.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    applyLocalUser(trimmed);
    setLocalUser(trimmed);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    applyLocalUser(null);
    setLocalUser(null);
  }, []);

  const value = useMemo(() => ({ localUser, login, logout }), [localUser, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  }
  return ctx;
}
