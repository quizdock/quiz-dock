import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import { SettingEditor } from './setting-editor';
import type { SettingRow } from './settings-model';

const row: SettingRow = {
  key: 'MEDIA_MAX_VIDEO_MB',
  category: 'limits',
  criticality: 'C2',
  applies: 'live',
  overridable: true,
  secret: false,
  value: 50,
  source: 'default',
  default: 50,
  locked: false,
  issues: [],
};
const access = {
  scope: 'write' as const,
  locks: [],
  authMode: 'oidc' as const,
  tokenRequired: false,
  tokenSet: false,
  safeMode: false,
};

function renderEditor(over: Partial<SettingRow> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingEditor row={{ ...row, ...over }} access={access} />
    </QueryClientProvider>,
  );
}

const bodies = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/admin/operations/'))
    .map(([url, init]) => [
      String(url).split('/').pop(),
      JSON.parse(String((init as RequestInit).body)),
    ]);

describe('SettingEditor', () => {
  it('saves explicitly, in the variable own unit; a level C2 change is confirmed first', async () => {
    const fetchMock = mockApi([
      {
        method: 'POST',
        path: '/admin/operations/settings.set',
        body: {
          kind: 'confirm',
          token: 'tok-tok-tok-tok-tok-tok',
          summary: 'Change MEDIA_MAX_VIDEO_MB to "80".',
        },
      },
    ]);
    renderEditor();
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '800' } });
    // Out of range: said as typed, not sent.
    expect(screen.getByText(/1 to 500/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '80' } });
    fireEvent.click(save);
    expect(await screen.findByText('Change MEDIA_MAX_VIDEO_MB to "80".')).toBeInTheDocument();
    mockApi([
      {
        method: 'POST',
        path: '/admin/operations/settings.set',
        body: { kind: 'result', result: { outcome: 'done', notes: [] } },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(bodies(fetchMock)).toEqual([
      ['settings.set', { params: { key: 'MEDIA_MAX_VIDEO_MB', value: '80' } }],
    ]);
  });

  it('goes back to .env when it was changed here', async () => {
    const fetchMock = mockApi([
      {
        method: 'POST',
        path: '/admin/operations/settings.reset',
        body: { kind: 'result', result: { outcome: 'done', notes: [] } },
      },
    ]);
    renderEditor({ source: 'override', value: 80, envValue: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à .env' }));
    await waitFor(() =>
      expect(bodies(fetchMock)).toEqual([
        ['settings.reset', { params: { key: 'MEDIA_MAX_VIDEO_MB' } }],
      ]),
    );
  });
});
