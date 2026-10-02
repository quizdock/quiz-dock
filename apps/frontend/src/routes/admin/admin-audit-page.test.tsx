import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import { AuditPage } from './admin-audit-page';

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});

const entries = [
  {
    id: 'a1',
    at: new Date().toISOString(),
    via: 'api',
    actor: 'host',
    userId: 'u1',
    address: '10.0.0.2',
    operation: 'settings.set',
    params: { key: 'GAME_READ_DELAY_MS', value: '4500', before: { overrides: {} } },
    outcome: 'done',
    code: null,
    durationMs: 12,
  },
  {
    id: 'a2',
    at: new Date().toISOString(),
    via: 'api',
    actor: 'host',
    userId: 'u1',
    address: null,
    operation: 'users.set-role',
    params: { user: 'local:marc', roles: 'admin' },
    outcome: 'refused',
    code: 'scope_read',
    durationMs: 3,
  },
];

const op = (id: string, effect: string) => ({
  id,
  domain: 'instance',
  category: 'settings',
  effect,
  summary: '',
  params: {},
  dryRun: false,
  reachable: true,
});

describe('AuditPage', () => {
  it('reads each parameter by name, folds what a change replaced, filters by operation', async () => {
    const fetchMock = mockApi([
      { method: 'POST', path: '/admin/operations/audit.list', body: result({ entries }) },
      {
        method: 'GET',
        path: '/admin/operations',
        body: { operations: [op('settings.set', 'write'), op('settings.list', 'read')] },
      },
    ]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuditPage />
      </QueryClientProvider>,
    );
    const row = (await screen.findByText('GAME_READ_DELAY_MS')).closest('tr')!;
    expect(within(row).getByText('4500')).toBeInTheDocument();
    expect(within(row).getByText('Ce qui a été remplacé')).toBeInTheDocument();
    expect(within(row).queryByText('before')).toBeNull();
    const refused = screen.getByText('local:marc').closest('tr')!;
    expect(within(refused).getByText('Refusé')).toBeInTheDocument();

    // Only what changes is offered: reads are never audited.
    const select = screen.getByRole('combobox');
    expect(within(select).queryByText('settings.list')).toBeNull();
    fireEvent.change(select, { target: { value: 'settings.set' } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([url]) => String(url).endsWith('/admin/operations/audit.list'))
          .map(([, init]) => JSON.parse(String((init as RequestInit).body)).params)
          .at(-1),
      ).toMatchObject({ operation: 'settings.set' }),
    );
  });
});
