import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi } from '../../test/harness';
import type { SettingRow, SettingsList } from './settings-model';
import { SettingsPage } from './settings-page';

const row = (over: Partial<SettingRow>): SettingRow => ({
  key: 'GAME_READ_DELAY_MS',
  category: 'pace',
  criticality: 'C3',
  applies: 'live',
  overridable: true,
  secret: false,
  value: 3000,
  source: 'default',
  default: 3000,
  locked: false,
  issues: [],
  ...over,
});

const list: SettingsList = {
  rows: [
    row({ value: 1500, source: 'env' }),
    row({
      key: 'AUTH_MODE',
      category: 'access',
      criticality: 'C1',
      applies: 'restart',
      overridable: false,
      value: 'oidc',
      default: 'none',
      source: 'env',
    }),
    row({
      key: 'ADMIN_TOKEN',
      category: 'admin',
      criticality: 'C1',
      applies: 'restart',
      overridable: false,
      secret: true,
      value: false,
      default: false,
    }),
    row({
      key: 'MEDIA_MAX_VIDEO_MB',
      category: 'limits',
      criticality: 'C2',
      value: 900,
      default: 50,
      source: 'env',
      issues: [
        {
          key: 'MEDIA_MAX_VIDEO_MB',
          code: 'out-of-bounds',
          message: 'MEDIA_MAX_VIDEO_MB="900" is outside what it accepts.',
        },
      ],
    }),
  ],
  rules: [],
  access: {
    scope: 'read',
    locks: [],
    authMode: 'oidc',
    tokenRequired: false,
    tokenSet: false,
    safeMode: false,
  },
};

const answer = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.setItem('qd-admin-settings-view', 'cards');
    mockApi([
      { method: 'POST', path: '/admin/operations/settings.list', body: answer(list) },
      { method: 'POST', path: '/admin/operations/audit.list', body: answer({ entries: [] }) },
    ]);
  });

  it('shows each setting in the units of the administration, where it comes from, why it is read-only', async () => {
    renderPage();
    const reading = (
      await screen.findByRole('heading', { name: 'Temps de lecture avant le chrono' })
    ).closest('div')!.parentElement!;
    expect(within(reading).getByText('1,5 s')).toBeInTheDocument();
    expect(within(reading).getByText('Depuis .env')).toBeInTheDocument();
    expect(within(reading).getByText('Lecture seule (ADMIN_WEB_SCOPE=read)')).toBeInTheDocument();
    const auth = screen
      .getByRole('heading', { name: 'Mode d’authentification' })
      .closest('div')!.parentElement!;
    expect(within(auth).getByText('Critique : jamais depuis le web')).toBeInTheDocument();
    // A secret: whether it is set, never its value.
    const token = screen
      .getByRole('heading', { name: /ADMIN_TOKEN|jeton/i })
      .closest('div')!.parentElement!;
    expect(within(token).getAllByText('Non défini').length).toBeGreaterThan(0);
    // A problem found at start, and the help from the registry.
    expect(screen.getByText(/Hors de ce qu’il accepte/)).toBeInTheDocument();
    expect(screen.getAllByText(/Reading window shown before/).length).toBeGreaterThan(0);
    expect(screen.getByText('900 Mo')).toBeInTheDocument();
  });

  it('searches and filters', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Temps de lecture avant le chrono' });
    fireEvent.change(screen.getByPlaceholderText('Chercher un réglage'), {
      target: { value: 'chrono' },
    });
    expect(screen.queryByRole('heading', { name: 'Mode d’authentification' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Chercher un réglage'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Avec un problème' }));
    expect(screen.queryByRole('heading', { name: 'Temps de lecture avant le chrono' })).toBeNull();
    expect(screen.getByText('900 Mo')).toBeInTheDocument();
  });

  it('the table lists every variable with its value, source and default; the chosen one below', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Temps de lecture avant le chrono' });
    fireEvent.click(screen.getByRole('button', { name: 'Tableau' }));
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByText('AUTH_MODE')).toBeInTheDocument();
    fireEvent.click(within(table).getByText('AUTH_MODE'));
    expect(await screen.findByText('Jamais modifié depuis l’administration.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mode d’authentification' })).toBeInTheDocument();
    // The variables outside the application, read-only.
    expect(screen.getByText('HTTP_PORT')).toBeInTheDocument();
  });
});
