import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/harness';
import { AdminMediaPage } from './admin-media-page';

const me = (roles: string[]) => ({
  method: 'GET',
  path: /\/me$/,
  body: { id: 'u1', displayName: 'Ada', roles, locale: 'fr' },
});

const overview = {
  method: 'GET',
  path: '/admin/media/overview',
  body: {
    files: 3,
    bytes: 12_400_000,
    byKind: [
      { kind: 'image', files: 2, bytes: 2_400_000 },
      { kind: 'video', files: 1, bytes: 10_000_000 },
    ],
    byOwner: [{ ownerId: 'u2', displayName: 'Billy', files: 3, bytes: 12_400_000 }],
    legacy: { files: 1, bytes: 400_000, mimes: ['image/png'] },
    cleanup: {
      orphans: { count: 2, bytes: 800_000, waiting: 1 },
      strayFiles: { count: 0, bytes: 0 },
      guard: 'database_older',
      lastRun: null,
    },
  },
};

const files = {
  method: 'GET',
  path: /\/admin\/media\/files\?/,
  body: {
    total: 1,
    items: [
      {
        id: 'm1',
        url: '/api/v1/media/m1',
        kind: 'image',
        mime: 'image/webp',
        name: 'night-market.webp',
        sizeBytes: 2_400_000,
        owners: ['Billy', 'Alice'],
        mediaCount: 2,
        quizCount: 2,
        inHistory: true,
        legacy: false,
        width: 1920,
        height: 1080,
        inCatalog: false,
        createdAt: '2026-09-24T10:00:00.000Z',
      },
    ],
  },
};

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminMediaPage />
    </QueryClientProvider>,
  );
}

describe('AdminMediaPage', () => {
  it("shows the volume, the clean-up and what holds it back, and the instance's files", async () => {
    mockApi([me(['admin']), overview, files]);
    renderPage();
    expect(await screen.findByText(/3 fichiers/)).toBeInTheDocument();
    // The matcher folds the narrow no-break space French puts before a unit.
    expect(screen.getByText(/Billy 12 Mo/)).toBeInTheDocument();
    expect(screen.getByText(/1 fichier dans un ancien format \(PNG\)/)).toBeInTheDocument();
    expect(screen.getByText(/plus ancienne que le volume médias/)).toBeInTheDocument();
    expect(await screen.findByText('night-market.webp')).toBeInTheDocument();
    expect(screen.getByText(/Billy, Alice/)).toBeInTheDocument();
    expect(screen.getByText('dans 2 quiz')).toBeInTheDocument();
  });

  it('lists what deleting a file breaks before deleting it', async () => {
    const fetchMock = mockApi([
      me(['admin']),
      overview,
      files,
      {
        method: 'GET',
        path: '/admin/media/files/m1/usages',
        body: {
          quizzes: [{ id: 'q1', title: 'Discover Taiwan', owner: 'Billy' }],
          archivedSessions: 3,
          playing: false,
        },
      },
      { method: 'DELETE', path: '/admin/media/files/m1', status: 204 },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer night-market.webp' }));
    expect(await screen.findByText('« Discover Taiwan » (Billy)')).toBeInTheDocument();
    expect(screen.getByText('3 parties archivées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/admin/media/files/m1') &&
            (opts as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });

  it('tells a host the page is for administrators', async () => {
    mockApi([me(['host']), overview, files]);
    renderPage();
    expect(await screen.findByText(/réservée aux administrateurs/)).toBeInTheDocument();
  });

  it('shows sizes, lists the instance media and adds a file to them (#62)', async () => {
    const fetchMock = mockApi([
      me(['admin']),
      overview,
      files,
      {
        method: 'GET',
        path: /\/media\/instance$/,
        body: [
          {
            id: 'i1',
            url: '/api/v1/media/i1',
            kind: 'image',
            name: 'logo.webp',
            alt: 'Logo',
            credit: null,
            durationMs: null,
            peaks: [],
            width: 512,
            height: 512,
            sizeBytes: 900,
            createdAt: '2026-09-24T10:00:00.000Z',
            usedIn: 0,
            inHistory: false,
          },
        ],
      },
      {
        method: 'POST',
        path: '/admin/media/files/m1/instance',
        status: 201,
        body: { mediaId: 'i2', url: '', kind: 'image' },
      },
    ]);
    renderPage();
    expect(await screen.findByText('logo.webp')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Logo')).toBeInTheDocument();
    expect(await screen.findByText(/1920 × 1080/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Ajouter night-market.webp aux médias de l’instance' }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/admin/media/files/m1/instance') &&
            (opts as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
