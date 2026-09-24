import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthProvider,
  bindOidcSession,
  configureAuth,
  getLocalUser,
  isAuthenticated,
  useAuth,
} from './auth-context';
import { customFetch, setAuthHeaders } from '../api/http';
import { getOidc } from './oidc';

vi.mock('./oidc', () => ({ getOidc: vi.fn() }));

function Probe() {
  const { user, loginLocal, logout } = useAuth();
  return (
    <div>
      <span data-testid="who">{user ?? '∅'}</span>
      <button type="button" onClick={() => loginLocal('Marc')}>
        in
      </button>
      <button type="button" onClick={logout}>
        out
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  afterEach(() => localStorage.clear());

  it('login/logout met à jour l’état et le stockage local', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('who').textContent).toBe('∅');

    act(() => screen.getByText('in').click());
    expect(screen.getByTestId('who').textContent).toBe('Marc');
    expect(getLocalUser()).toBe('Marc');

    act(() => screen.getByText('out').click());
    // La déconnexion locale rend d'abord le siège d'hôte (asynchrone).
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('∅'));
    expect(getLocalUser()).toBeNull();
  });
});

function OidcProbe() {
  const { user, loginOidc, completeOidcLogin } = useAuth();
  return (
    <div>
      <span data-testid="who">{user ?? '∅'}</span>
      <button type="button" onClick={() => void loginOidc()}>
        go
      </button>
      <button type="button" onClick={() => void completeOidcLogin()}>
        cb
      </button>
    </div>
  );
}

describe('AuthProvider (mode oidc)', () => {
  it('loginOidc redirige et completeOidcLogin établit l’utilisateur', async () => {
    const signinRedirect = vi.fn().mockResolvedValue(undefined);
    const signinRedirectCallback = vi.fn().mockResolvedValue({
      access_token: 'tok-123',
      profile: { name: 'Marie', sub: 's' },
    });
    vi.mocked(getOidc).mockReturnValue({
      signinRedirect,
      signinRedirectCallback,
    } as unknown as ReturnType<typeof getOidc>);

    render(
      <AuthProvider mode="oidc">
        <OidcProbe />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('go').click();
    });
    expect(signinRedirect).toHaveBeenCalled();

    await act(async () => {
      screen.getByText('cb').click();
    });
    expect(signinRedirectCallback).toHaveBeenCalled();
    expect(screen.getByTestId('who').textContent).toBe('Marie');
  });
});

describe('OIDC session lifecycle', () => {
  it('replaces the Bearer header on silent renew and drops the session on 401', async () => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const removeUser = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getOidc).mockReturnValue({
      removeUser,
      events: {
        addUserLoaded: (cb: (u: unknown) => void) => (handlers.userLoaded = cb),
        addAccessTokenExpired: (cb: () => void) => (handlers.expired = cb),
        addUserSignedOut: (cb: () => void) => (handlers.signedOut = cb),
      },
    } as unknown as ReturnType<typeof getOidc>);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/dashboard', assign });
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      const auth = (opts?.headers as Record<string, string>)?.Authorization;
      return new Response(auth === 'Bearer fresh' ? '{}' : '{"code":"auth.required"}', {
        status: auth === 'Bearer fresh' ? 200 : 401,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    bindOidcSession();
    handlers.userLoaded?.({ access_token: 'fresh' });
    await expect(customFetch('/api/v1/me', {})).resolves.toMatchObject({ status: 200 });

    // Le backend rejette le jeton → session abandonnée, retour à /login.
    setAuthHeaders({ Authorization: 'Bearer stale' });
    await expect(customFetch('/api/v1/me', {})).rejects.toThrow('HTTP 401');
    expect(removeUser).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/login');

    vi.unstubAllGlobals();
    setAuthHeaders({});
  });

  it('follows a sign-out from another tab, which shares the session', () => {
    vi.mocked(getOidc).mockReturnValue({
      removeUser: vi.fn(),
      events: { addUserLoaded: vi.fn(), addAccessTokenExpired: vi.fn(), addUserSignedOut: vi.fn() },
    } as unknown as ReturnType<typeof getOidc>);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/quizzes', assign });
    configureAuth('oidc', true);
    bindOidcSession();

    // Another tab renewing the token is no sign-out.
    window.dispatchEvent(new StorageEvent('storage', { key: 'oidc.user:x:y', newValue: '{}' }));
    expect(assign).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: 'oidc.user:x:y', newValue: null }));
    expect(assign).toHaveBeenCalledWith('/login');
    expect(isAuthenticated()).toBe(false);

    vi.unstubAllGlobals();
    configureAuth('none');
  });

  it('logout in oidc mode is RP-initiated (signoutRedirect), with a local fallback', async () => {
    const signoutRedirect = vi.fn().mockRejectedValue(new Error('No end session endpoint'));
    const removeUser = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getOidc).mockReturnValue({ signoutRedirect, removeUser } as unknown as ReturnType<
      typeof getOidc
    >);
    function Out() {
      const { user, logout } = useAuth();
      return (
        <button type="button" onClick={() => void logout()}>
          {user ?? '∅'}
        </button>
      );
    }
    render(
      <AuthProvider mode="oidc" initialUser="Marie">
        <Out />
      </AuthProvider>,
    );
    await act(async () => {
      screen.getByText('Marie').click();
    });
    expect(signoutRedirect).toHaveBeenCalled();
    expect(removeUser).toHaveBeenCalled(); // repli : le fournisseur n'a pas d'end_session_endpoint
    expect(screen.getByText('∅')).toBeInTheDocument();
  });
});
