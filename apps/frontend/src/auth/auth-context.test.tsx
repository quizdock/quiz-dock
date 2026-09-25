import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthProvider,
  bindOidcSession,
  configureAuth,
  forgetStoredTokens,
  getLocalUser,
  isAuthenticated,
  useAuth,
} from './auth-context';
import { customFetch } from '../api/http';

/** A fetch answering the auth endpoints of the backend (BFF). */
function authBackend(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (...[url]: [string, RequestInit?]) => {
    const [status, body] = routes[url] ?? [404, { code: 'not_found' }];
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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
      <button
        type="button"
        onClick={() =>
          void completeOidcLogin(new URLSearchParams('code=c1&state=s1&iss=https://idp'))
        }
      >
        cb
      </button>
    </div>
  );
}

describe('AuthProvider (mode oidc)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureAuth('none');
  });

  it('loginOidc goes where the backend says; the callback hands the code to the backend', async () => {
    const fetchMock = authBackend({
      '/api/v1/auth/login': [200, { url: 'https://idp/auth?state=s1' }],
      '/api/v1/auth/callback': [200, { name: 'Marie' }],
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/login', assign });
    configureAuth('oidc', false);

    render(
      <AuthProvider mode="oidc">
        <OidcProbe />
      </AuthProvider>,
    );
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(assign).toHaveBeenCalledWith('https://idp/auth?state=s1');

    await act(async () => {
      screen.getByText('cb').click();
    });
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/auth/callback')!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      code: 'c1',
      state: 's1',
      iss: 'https://idp',
    });
    expect(screen.getByTestId('who').textContent).toBe('Marie');
    expect(isAuthenticated()).toBe(true);
  });
});

describe('OIDC session lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureAuth('none');
  });

  it('holds no token: the cookie authenticates, a 401 ends the session', async () => {
    const fetchMock = authBackend({ '/api/v1/me': [401, { code: 'auth.required' }] });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/dashboard', assign });
    configureAuth('oidc', true);
    bindOidcSession();

    await expect(customFetch('/api/v1/me', {})).rejects.toThrow('HTTP 401');
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(assign).toHaveBeenCalledWith('/login');
    expect(isAuthenticated()).toBe(false);
  });

  it('keeps the session alive while signed in, hidden tab or not', async () => {
    vi.useFakeTimers();
    const fetchMock = authBackend({ '/api/v1/me': [200, { displayName: 'Marie' }] });
    configureAuth('oidc', true);
    bindOidcSession();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/me', expect.anything());
    configureAuth('oidc', false);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('forgets the tokens an earlier version kept in the browser', () => {
    localStorage.setItem('oidc.user:https://idp:quiz-dock-frontend', '{"access_token":"x"}');
    sessionStorage.setItem('oidc.8f2e', '{}');
    localStorage.setItem('live.localUser', 'Marc');
    forgetStoredTokens();
    expect(localStorage.getItem('oidc.user:https://idp:quiz-dock-frontend')).toBeNull();
    expect(sessionStorage.getItem('oidc.8f2e')).toBeNull();
    expect(localStorage.getItem('live.localUser')).toBe('Marc');
    localStorage.clear();
  });

  it('logout ends the session on the backend, then at the provider', async () => {
    authBackend({ '/api/v1/auth/logout': [200, { url: 'https://idp/logout?id_token_hint=x' }] });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/quizzes', assign });
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
    expect(assign).toHaveBeenCalledWith('https://idp/logout?id_token_hint=x');
    expect(screen.getByText('∅')).toBeInTheDocument();
  });
});
