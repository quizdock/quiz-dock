import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../test/harness';
import { SetupPage } from './setup-page';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});
const list = {
  rows: [
    {
      key: 'APP_NAME',
      category: 'identity',
      criticality: 'C4',
      applies: 'live',
      overridable: true,
      secret: false,
      value: 'QuizDock',
      source: 'default',
      default: 'QuizDock',
      locked: false,
      issues: [],
    },
  ],
  rules: [],
  access: {
    scope: 'read',
    locks: [],
    authMode: 'none',
    tokenRequired: true,
    tokenSet: false,
    safeMode: false,
  },
};

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SetupPage />
    </QueryClientProvider>,
  );
}

describe('SetupPage (§3.8)', () => {
  beforeEach(() => sessionStorage.clear());

  it('asks for the setup token, then runs the steps through the setup session', async () => {
    const fetchMock = mockApi([
      { path: '/setup/status', body: { open: true, authMode: 'none', signedIn: true } },
      { method: 'POST', path: '/setup/session', body: { session: 'sess-sess-sess-sess-sess' } },
      { method: 'POST', path: '/setup/operations/settings.list', body: result(list) },
      {
        method: 'POST',
        path: '/setup/operations/health.doctor',
        body: result({ output: [{ level: 'ok', text: 'PostgreSQL reachable' }] }),
      },
    ]);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Jeton'), { target: { value: 'tok3n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    expect(await screen.findByText('PostgreSQL reachable')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/setup/operations/health.doctor'),
    );
    expect(new Headers((call![1] as RequestInit).headers).get('X-Setup-Session')).toBe(
      'sess-sess-sess-sess-sess',
    );
    // Identity: the settings, editable whatever ADMIN_WEB_SCOPE says.
    fireEvent.click(screen.getByRole('button', { name: /Identité/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument(),
    );
  });

  it('a set-up instance keeps the wizard closed', async () => {
    mockApi([{ path: '/setup/status', body: { open: false, authMode: 'none', signedIn: true } }]);
    renderPage();
    expect(await screen.findByText(/le\s+wizard|l’assistant|fermé/i)).toBeInTheDocument();
  });
});
