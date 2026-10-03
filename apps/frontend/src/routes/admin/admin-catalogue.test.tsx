import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import { setAdminToken, useCatalogue } from './admin-api';

function Reachable() {
  const { data } = useCatalogue();
  return <p>{data ? `reachable: ${String(data[0].reachable)}` : 'loading'}</p>;
}

describe('the catalogue in local mode', () => {
  afterEach(() => setAdminToken(''));

  it('is asked with the token, and again once the token is given', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/admin/operations',
        body: { operations: [{ id: 'users.set-role', reachable: false }] },
      },
    ]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Reachable />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('reachable: false')).toBeInTheDocument();
    act(() => setAdminToken('t'.repeat(32)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    expect(new Headers((init as RequestInit).headers).get('X-Admin-Token')).toBe('t'.repeat(32));
  });
});
