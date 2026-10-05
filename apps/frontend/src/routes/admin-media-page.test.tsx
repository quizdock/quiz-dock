import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, within, render, screen, waitFor } from '@testing-library/react';
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
        instanceId: null,
        instanceCredit: null,
        durationMs: null,
        peaks: [],
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
    fireEvent.click(await screen.findByRole('button', { name: /^night-market\.webp/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer night-market.webp' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer ce fichier ?' });
    expect(await within(dialog).findByText('« Discover Taiwan » (Billy)')).toBeInTheDocument();
    expect(within(dialog).getByText('3 parties archivées')).toBeInTheDocument();
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

  it('a file a room is playing cannot be deleted: the button is greyed, the reason said', async () => {
    mockApi([
      me(['admin']),
      overview,
      files,
      {
        method: 'GET',
        path: '/admin/media/files/m1/usages',
        body: { quizzes: [], archivedSessions: 0, playing: true },
      },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^night-market\.webp/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer night-market.webp' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled());
  });

  it('shows sizes, puts a file among the global media, and edits a global media credit (#62)', async () => {
    const globalFile = {
      ...files.body.items[0],
      id: 'i1',
      name: 'logo.webp',
      owners: [],
      inCatalog: true,
      instanceId: 'i1',
      instanceCredit: 'In-house',
    };
    const fetchMock = mockApi([
      me(['admin']),
      overview,
      {
        method: 'GET',
        path: /\/admin\/media\/files\?.*ownerId=global/,
        body: { total: 1, items: [globalFile] },
      },
      files,
      {
        method: 'POST',
        path: '/admin/media/files/m1/instance',
        status: 201,
        body: { mediaId: 'i2', url: '', kind: 'image' },
      },
      {
        method: 'PUT',
        path: '/admin/media/instance/i1',
        body: { id: 'i1', alt: null, credit: 'CC0', durationMs: null },
      },
    ]);
    renderPage();
    expect(await screen.findByText(/1920 × 1080/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^night-market\.webp/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ajouter night-market.webp aux médias globaux' }),
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

    // The Global view: owned by "Global", its credit editable, no alt text.
    fireEvent.click(screen.getByRole('button', { name: 'Global', pressed: false }));
    expect(await screen.findByText('logo.webp')).toBeInTheDocument();
    expect(screen.getByText(/· Global$/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Texte alternatif')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^logo\.webp/ }));
    const credit = screen.getByLabelText('Crédit');
    expect(credit).toHaveValue('In-house');
    fireEvent.change(credit, { target: { value: 'CC0' } });
    fireEvent.blur(credit);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/admin/media/instance/i1') &&
            (opts as RequestInit | undefined)?.method === 'PUT' &&
            String((opts as RequestInit | undefined)?.body).includes('CC0'),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeInTheDocument();
  });

  it('deletes the files ticked at once, leaving out one a room plays', async () => {
    const m2 = { ...files.body.items[0], id: 'm2', name: 'anthem.mp3', kind: 'audio' };
    const fetchMock = mockApi([
      me(['admin']),
      overview,
      { ...files, body: { total: 2, items: [files.body.items[0], m2] } },
      {
        method: 'GET',
        path: '/admin/media/files/m1/usages',
        body: {
          quizzes: [{ id: 'q1', title: 'Discover Taiwan', owner: 'Billy' }],
          archivedSessions: 0,
          playing: false,
        },
      },
      {
        method: 'GET',
        path: '/admin/media/files/m2/usages',
        body: { quizzes: [], archivedSessions: 0, playing: true },
      },
      { method: 'DELETE', path: '/admin/media/files/m1', status: 204 },
    ]);
    renderPage();
    await screen.findByText('anthem.mp3');
    fireEvent.click(screen.getByLabelText('Tout sélectionner'));
    expect(screen.getByText('2 sélectionnés')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer 1 fichier ?' });
    expect(await within(dialog).findByText(/anthem\.mp3/)).toBeInTheDocument();
    expect(within(dialog).getByText('« Discover Taiwan » (Billy)')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).endsWith('/admin/media/files/m1') &&
            (opts as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, opts]) =>
          String(url).endsWith('/admin/media/files/m2') &&
          (opts as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(false);
  });

  it('the global media take files dropped on their zone, and say which ones they refuse', async () => {
    mockApi([
      me(['admin']),
      overview,
      {
        method: 'GET',
        path: /\/admin\/media\/files\?.*ownerId=global/,
        body: { total: 0, items: [] },
      },
      files,
    ]);
    renderPage();
    await screen.findByText(/1920 × 1080/);
    fireEvent.click(screen.getByRole('button', { name: 'Global', pressed: false }));
    const zone = (await screen.findByText(/Déposez ici des images/)).parentElement!;
    expect(screen.getByLabelText('Choisir des fichiers')).toHaveAttribute('multiple');
    const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(zone, { dataTransfer: { files: [notes] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'notes.txt — Ni une image, ni une vidéo, ni un son.',
    );
  });

  it('switches between a list and a grid', async () => {
    mockApi([me(['admin']), overview, files]);
    renderPage();
    expect(await screen.findByText('night-market.webp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Grille' }));
    expect(screen.getByRole('button', { name: 'Grille' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('ul.grid')).not.toBeNull();
  });

  it('shows the file chosen beside the list: in full, what it is, where it is used', async () => {
    const song = {
      ...files.body.items[0],
      id: 'm2',
      url: '/api/v1/media/m2',
      kind: 'audio',
      mime: 'audio/mp4',
      name: 'jingle.m4a',
      width: null,
      height: null,
      durationMs: 83_000,
      peaks: new Array(200).fill(0.5),
    };
    mockApi([
      me(['admin']),
      overview,
      { ...files, body: { total: 2, items: [files.body.items[0], song] } },
      {
        method: 'GET',
        path: '/admin/media/files/m1/usages',
        body: {
          quizzes: [{ id: 'q1', title: 'Discover Taiwan', owner: 'Billy' }],
          archivedSessions: 0,
          playing: false,
        },
      },
      {
        method: 'GET',
        path: '/admin/media/files/m2/usages',
        body: { quizzes: [], archivedSessions: 0, playing: false },
      },
    ]);
    renderPage();
    const row = await screen.findByRole('button', { name: /^night-market\.webp/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    // Beside the list on a wide screen (a bottom sheet on a phone).
    const panel = await screen.findByRole('complementary', { name: 'night-market.webp' });
    expect(panel).toHaveTextContent('1920 × 1080');
    expect(panel).toHaveTextContent('Billy, Alice');
    expect(panel.querySelector('img')).toHaveAttribute('src', '/api/v1/media/m1');
    // Where it is used, before any deletion is asked for.
    expect(await within(panel).findByText('« Discover Taiwan » (Billy)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^jingle\.m4a/ }));
    const shown = await screen.findByRole('complementary', { name: 'jingle.m4a' });
    expect(shown).toHaveTextContent('1:23');
    // The sound plays over its waveform.
    expect(shown.querySelector('audio')).toHaveAttribute('src', '/api/v1/media/m2');
    expect(await within(shown).findByText('Rien ne l’utilise.')).toBeInTheDocument();
  });

  it('says so when the media cannot be read, instead of loading forever (audit E5)', async () => {
    mockApi([
      me(['admin']),
      { ...overview, status: 500, body: {} },
      { ...files, status: 500, body: {} },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Une erreur est survenue.')).toHaveLength(2));
  });
});
