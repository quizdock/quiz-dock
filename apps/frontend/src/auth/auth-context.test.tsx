import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider, getLocalUser, useAuth } from './auth-context';

function Probe() {
  const { localUser, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="who">{localUser ?? '∅'}</span>
      <button type="button" onClick={() => login('Marc')}>
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
