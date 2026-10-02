import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../test/harness';
import { UsageStep } from './usage-step';

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});
const presets = result({
  axes: [{ id: 'internet', levels: ['connected', 'offline'], standard: 'connected', settings: [] }],
  current: { internet: 'connected' },
});

function renderStep() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <UsageStep />
    </QueryClientProvider>,
  );
}

describe('UsageStep (§3.9)', () => {
  it('says so when the questions cannot be read, instead of an empty step', async () => {
    mockApi([{ method: 'POST', path: '/admin/operations/presets.list', status: 500, body: {} }]);
    renderStep();
    expect(await screen.findByText('Une erreur est survenue.')).toBeInTheDocument();
  });

  it('never applies answers whose preview is not shown yet', async () => {
    const pending: Array<() => void> = [];
    const plan = result({
      plan: {
        axes: {},
        changes: [
          { key: 'MEDIA_LIBRARY_LINKS', from: { value: [], source: 'default' }, to: 'none' },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const answer = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/presets.list')) return Promise.resolve(answer(presets));
        if (url.endsWith('/presets.plan'))
          return new Promise<Response>((resolve) => pending.push(() => resolve(answer(plan))));
        return Promise.resolve(answer({}));
      }),
    );
    renderStep();
    // The instance's own answer, previewed: it may be applied.
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]();
    expect(await screen.findByRole('button', { name: 'Appliquer' })).toBeEnabled();
    // Another answer: its preview is being read, the one shown is not its own.
    fireEvent.click(screen.getByRole('button', { name: /^Non/ }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    pending[1]();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Appliquer' })).toBeEnabled());
  });
});
