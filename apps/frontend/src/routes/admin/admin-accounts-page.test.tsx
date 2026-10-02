import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import { AccountsPage } from './admin-accounts-page';

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});

const page = (localMode = false) => ({
  total: 2,
  items: [
    {
      id: 'u1',
      name: 'Claire',
      subject: 'local:claire',
      email: 'claire@example.test',
      roles: ['host'],
      granted: ['host'],
      quizzes: 5,
      games: 3,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'u2',
      name: 'Marc',
      subject: 'local:marc',
      email: null,
      roles: [],
      granted: [],
      quizzes: 0,
      games: 0,
      createdAt: new Date().toISOString(),
    },
  ],
  seat: localMode
    ? {
        holder: 'Claire',
        subject: 'local:claire',
        since: new Date().toISOString(),
        expiresAt: null,
      }
    : null,
  localMode,
});

const catalogue = (reachable: boolean) => ({
  operations: [
    {
      id: 'users.set-role',
      domain: 'instance',
      category: 'users',
      effect: 'write',
      summary: '',
      params: {},
      dryRun: false,
      reachable,
      ...(reachable ? {} : { refusal: 'scope_read' }),
    },
  ],
});

function renderPage({ reachable = true, localMode = false } = {}) {
  const fetchMock = mockApi([
    { method: 'POST', path: '/admin/operations/users.search', body: result(page(localMode)) },
    { method: 'GET', path: '/admin/operations', body: catalogue(reachable) },
    { method: 'POST', path: '/admin/operations/users.set-role', body: result({ output: [] }) },
  ]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccountsPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, id: string) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(`/admin/operations/${id}`))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).params);

describe('AccountsPage', () => {
  it('lists the accounts with their roles, quizzes and games; a participant says so', async () => {
    renderPage();
    const claire = (await screen.findByText('Claire')).closest('tr')!;
    expect(within(claire).getByText('Animateur')).toBeInTheDocument();
    expect(within(claire).getByText('claire@example.test')).toBeInTheDocument();
    const marc = screen.getByText('Marc').closest('tr')!;
    expect(within(marc).getByText('Participant')).toBeInTheDocument();
    expect(screen.getByText('2 comptes')).toBeInTheDocument();
  });

  it('searches on the server', async () => {
    const fetchMock = renderPage();
    await screen.findByText('Claire');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cla' } });
    await waitFor(() =>
      expect(calls(fetchMock, 'users.search').at(-1)).toMatchObject({ q: 'cla', offset: 0 }),
    );
  });

  it('grants a role from the row: the ticked roles, as one value', async () => {
    const fetchMock = renderPage();
    await screen.findByText('Marc');
    fireEvent.click(screen.getByRole('button', { name: 'Actions pour Marc' }));
    fireEvent.click(await screen.findByRole('button', { name: /Accorder ou retirer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Animateur/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Administrateur/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(calls(fetchMock, 'users.set-role')).toEqual([
        { user: 'local:marc', roles: 'host,admin' },
      ]),
    );
  });

  it('says why roles cannot be changed from the web, and shows the seat in local mode', async () => {
    renderPage({ reachable: false, localMode: true });
    expect(await screen.findByText(/Tenue par Claire/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions pour Marc' }));
    expect(await screen.findByRole('button', { name: /Accorder ou retirer/ })).toBeDisabled();
  });
});
