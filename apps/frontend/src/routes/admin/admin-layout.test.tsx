import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../test/harness';
import { AdminLayout } from './admin-layout';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  Outlet: () => <p>the page</p>,
}));

const me = (roles: string[]) => ({
  method: 'GET',
  path: /\/me$/,
  body: { id: 'u1', displayName: 'Ada', roles, locale: 'fr' },
});

function renderLayout() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminLayout />
    </QueryClientProvider>,
  );
}

describe('AdminLayout', () => {
  it('tells a host the administration is for administrators, whatever its page', async () => {
    mockApi([me(['host'])]);
    renderLayout();
    expect(await screen.findByText(/réservée aux administrateurs/)).toBeInTheDocument();
    expect(screen.queryByText('the page')).toBeNull();
  });

  it('shows an administrator its sections and the page', async () => {
    mockApi([
      me(['admin']),
      { method: 'POST', path: '/admin/operations/settings.list', status: 500, body: {} },
    ]);
    renderLayout();
    expect(await screen.findByText('the page')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
  });
});
