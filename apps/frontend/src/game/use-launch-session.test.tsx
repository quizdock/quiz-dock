import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAuth } from '../auth/auth-context';
import { configureAnonymousParticipants } from '../config';
import { useLaunchSession } from './use-launch-session';

const createSession = vi.fn<(...args: unknown[]) => Promise<{ pin: string }>>(async () => ({
  pin: '482913',
}));
const navigate = vi.fn();
vi.mock('./game-client', () => ({ createSession: (...a: unknown[]) => createSession(...a) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

/** Answers the preferences calls; everything else is a 404. */
function mockApi(handlers: { method: string; path: string; body: unknown }[]) {
  const fn = vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? 'GET').toUpperCase();
    const handler = handlers.find((h) => h.method === method && url.includes(h.path));
    return new Response(handler ? JSON.stringify(handler.body) : '', {
      status: handler ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function Launcher() {
  const { launch, dialog } = useLaunchSession();
  return (
    <>
      <button type="button" onClick={() => void launch('quiz1', { fullCapture: true })}>
        Présenter
      </button>
      {dialog}
    </>
  );
}

describe('useLaunchSession (#57)', () => {
  afterEach(() => {
    configureAnonymousParticipants(false);
    configureAuth('none');
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts at once when open access is not offered', async () => {
    const api = mockApi([]);
    render(<Launcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Présenter' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledWith('quiz1', { fullCapture: true }));
    // No question asked, so no remembered choice read either.
    expect(api).not.toHaveBeenCalled();
  });

  it('asks each time when nothing is remembered, and remembers nothing unasked', async () => {
    configureAuth('oidc', true);
    configureAnonymousParticipants(true);
    const api = mockApi([{ method: 'GET', path: '/me/preferences', body: {} }]);
    render(<Launcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Présenter' }));

    // Accounts required unless the host picks otherwise.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Comptes requis/ })).toBeChecked(),
    );
    expect(screen.getByRole('checkbox', { name: /Se souvenir de mon choix/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Accès libre/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('quiz1', {
        fullCapture: true,
        participantAccess: 'open',
      }),
    );
    expect(api.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'PATCH')).toBe(
      false,
    );
    expect(navigate).toHaveBeenCalledWith({
      to: '/session/$pin/console',
      params: { pin: '482913' },
    });
  });

  it('stores the choice when asked to remember it', async () => {
    configureAuth('oidc', true);
    configureAnonymousParticipants(true);
    const api = mockApi([
      { method: 'GET', path: '/me/preferences', body: {} },
      { method: 'PATCH', path: '/me/preferences', body: { participantAccess: 'open' } },
    ]);
    render(<Launcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Présenter' }));

    fireEvent.click(await screen.findByRole('radio', { name: /Accès libre/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Se souvenir de mon choix/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));

    await waitFor(() =>
      expect(
        api.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === 'PATCH')?.[1],
      ).toMatchObject({ body: JSON.stringify({ participantAccess: 'open' }) }),
    );
    expect(createSession).toHaveBeenCalledWith('quiz1', {
      fullCapture: true,
      participantAccess: 'open',
    });
  });

  it('starts at once with a remembered choice, without asking', async () => {
    configureAuth('oidc', true);
    configureAnonymousParticipants(true);
    mockApi([{ method: 'GET', path: '/me/preferences', body: { participantAccess: 'open' } }]);
    render(<Launcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Présenter' }));

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith('quiz1', {
        fullCapture: true,
        participantAccess: 'open',
      }),
    );
    expect(screen.queryByRole('radio', { name: /Accès libre/ })).toBeNull();
  });
});
