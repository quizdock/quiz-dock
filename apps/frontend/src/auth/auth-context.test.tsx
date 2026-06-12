import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, getLocalUser, useAuth } from './auth-context';
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

  it('login/logout met à jour l’état et le stockage local', () => {
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
    expect(screen.getByTestId('who').textContent).toBe('∅');
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
