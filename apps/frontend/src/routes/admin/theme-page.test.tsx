import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import { ThemePage } from './theme-page';

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});
const access = {
  scope: 'write',
  locks: [],
  authMode: 'oidc',
  tokenRequired: false,
  tokenSet: false,
  safeMode: false,
};

function renderPage() {
  const fetchMock = mockApi([
    { method: 'POST', path: '/admin/operations/theme.get', body: result({ theme: {} }) },
    {
      method: 'POST',
      path: '/admin/operations/settings.list',
      body: result({ rows: [], rules: [], access }),
    },
    { method: 'POST', path: '/admin/operations/theme.set', body: result({}) },
  ]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ThemePage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('ThemePage (lot 5)', () => {
  it('checks contrast as typed, and saves only a readable palette', async () => {
    const fetchMock = renderPage();
    const primary = await screen.findByLabelText(/^Couleur principale/);
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    fireEvent.change(primary, { target: { value: 'tomato' } });
    expect(save).toBeDisabled();
    fireEvent.change(primary, { target: { value: '#fde68a' } });
    expect(save).toBeDisabled();
    fireEvent.change(primary, { target: { value: '#1d4ed8' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('theme.set') &&
            JSON.parse(String((init as RequestInit).body)).params.light.primary === '#1d4ed8',
        ),
      ).toBe(true),
    );
  });
});
