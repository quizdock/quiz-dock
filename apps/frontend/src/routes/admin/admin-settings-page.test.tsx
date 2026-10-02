import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminSettingsPage } from './admin-settings-page';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const row = (value: string) => ({
  key: 'APP_NAME',
  category: 'identity',
  criticality: 'C4',
  applies: 'live',
  overridable: true,
  secret: false,
  value,
  source: value === 'QuizDock' ? 'default' : 'override',
  default: 'QuizDock',
  locked: false,
  issues: [],
});
const list = (value: string) => ({
  kind: 'result',
  result: {
    outcome: 'done',
    notes: [],
    data: {
      rows: [row(value)],
      rules: [],
      access: {
        scope: 'write',
        locks: [],
        authMode: 'oidc',
        tokenRequired: false,
        tokenSet: false,
        safeMode: false,
      },
    },
  },
});

describe('AdminSettingsPage', () => {
  it('a save reads the setting again, and still says it is saved and when it applies', async () => {
    let value = 'QuizDock';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const answer = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/admin/operations/settings.list')) return answer(list(value));
        if (url.endsWith('/admin/operations/settings.set')) {
          value = JSON.parse(String(opts?.body)).params.value;
          return answer({ kind: 'result', result: { outcome: 'done', notes: [], data: {} } });
        }
        return answer({ operations: [] });
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminSettingsPage />
      </QueryClientProvider>,
    );
    const input = await screen.findByLabelText(/Nom de l’application|APP_NAME/);
    fireEvent.change(input, { target: { value: 'Quiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    // The row read again with its new value: the message stays.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enregistré'));
    await waitFor(() => expect(value).toBe('Quiz'));
    expect(screen.getByRole('status')).toHaveTextContent('s’applique dès maintenant');
  });
});
