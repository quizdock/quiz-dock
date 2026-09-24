import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertMedia } from '@/lib/media-convert';
import { MediaCheckError } from '@/lib/media-prepare';
import { mockApi } from '../test/harness';
import { MediaUpload } from './media-upload';

// The converter needs WebCodecs and a canvas: its decisions are tested in media-plan.
vi.mock('@/lib/media-convert', () => ({
  convertMedia: vi.fn(async (file: File) => ({ file, notices: [] })),
}));

const LIMITS = {
  method: 'GET',
  path: '/media/limits',
  body: { image: 10_485_760, video: 52_428_800, audio: 10_485_760 },
};
const posted = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.some(([, opts]) => (opts as RequestInit | undefined)?.method === 'POST');

function renderUpload(value: string | null, onChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MediaUpload value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('MediaUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploade un fichier et renvoie le mediaId', async () => {
    mockApi([
      LIMITS,
      {
        method: 'POST',
        path: '/media',
        status: 201,
        body: { mediaId: 'media-123', url: '/api/v1/media/media-123' },
      },
    ]);
    const { onChange } = renderUpload(null);
    const input = screen.getByLabelText('Fichier média');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const file = new File([png], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        'media-123',
        expect.objectContaining({ kind: 'image' }),
      ),
    );
  });

  it('turns away a video this browser cannot convert, with the way out, before sending it', async () => {
    const fetchMock = mockApi([LIMITS]);
    vi.mocked(convertMedia).mockRejectedValueOnce(
      new MediaCheckError('media.cannot_convert_video'),
    );
    const queryClient = new QueryClient();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MediaUpload value={null} onChange={onChange} kind="video" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: {
        files: [new File([new Uint8Array(8)], 'IMG_0042.mov', { type: 'video/quicktime' })],
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chrome, Edge ou Safari.*HandBrake/);
    expect(posted(fetchMock)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tells the author an animated GIF kept only its first frame', async () => {
    mockApi([
      LIMITS,
      {
        method: 'POST',
        path: '/media',
        status: 201,
        body: { mediaId: 'm-gif', url: '/api/v1/media/m-gif' },
      },
    ]);
    const webp = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
      'dance.webp',
      { type: 'image/webp' },
    );
    vi.mocked(convertMedia).mockResolvedValueOnce({
      file: webp,
      notices: ['media.notice.gifFirstFrame'],
    });
    renderUpload(null);
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: { files: [new File([new Uint8Array(8)], 'dance.gif', { type: 'image/gif' })] },
    });
    expect(await screen.findByText(/seule sa première image/)).toBeInTheDocument();
  });

  it('turns away a file whose content is not what its name says', async () => {
    const fetchMock = mockApi([LIMITS]);
    renderUpload(null);
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: { files: [new File(['<svg/>'], 'photo.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Format non pris en charge/);
    expect(posted(fetchMock)).toBe(false);
  });

  it('affiche l’aperçu et permet de retirer le média', () => {
    mockApi([]);
    const { onChange } = renderUpload('media-123');
    expect(screen.getByAltText('média de la question')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retirer le média'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('charge le texte alternatif du média et l’enregistre à la sortie du champ (#43)', async () => {
    const fetchMock = mockApi([
      { method: 'GET', path: '/media/media-123/meta', body: { id: 'media-123', alt: 'Le port' } },
      { method: 'PUT', path: '/media/media-123/alt', body: { id: 'media-123', alt: 'Rotterdam' } },
    ]);
    renderUpload('media-123');

    const field = await screen.findByLabelText(/Texte alternatif/);
    await waitFor(() => expect(field).toHaveValue('Le port'));

    fireEvent.change(field, { target: { value: 'Rotterdam' } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/media/media-123/alt') &&
            (opts as RequestInit | undefined)?.method === 'PUT' &&
            String((opts as RequestInit | undefined)?.body).includes('Rotterdam'),
        ),
      ).toBe(true),
    );
  });

  it('reuses a media from the library: a new media on the same file', async () => {
    const item = (over: object) => ({
      id: 'm-old',
      url: '/api/v1/media/m-old',
      kind: 'image',
      name: 'temple.webp',
      alt: 'Longshan temple',
      credit: null,
      durationMs: null,
      peaks: [],
      sizeBytes: 1000,
      createdAt: '2026-09-24T10:00:00.000Z',
      usedIn: 2,
      inHistory: false,
      width: 1920,
      height: 1080,
      ...over,
    });
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: /\/media\?kind=image/,
        body: [item({}), item({ id: 'm-free', name: 'free.webp', usedIn: 0 })],
      },
      {
        method: 'GET',
        path: '/media/links',
        body: [{ name: 'Openverse', url: 'https://openverse.org/', kinds: ['image'] }],
      },
      {
        method: 'POST',
        path: '/media/m-old/reuse',
        status: 201,
        body: { mediaId: 'm-new', url: '/api/v1/media/m-new', kind: 'image' },
      },
    ]);
    const { onChange } = renderUpload(null);
    fireEvent.click(screen.getByRole('button', { name: 'Mes images' }));
    const pick = await screen.findByRole('button', { name: 'Utiliser temple.webp' });
    // Only an unused media can be deleted from the library.
    expect(screen.queryByRole('button', { name: 'Supprimer temple.webp' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Supprimer free.webp' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Openverse/ })).toHaveAttribute('target', '_blank');
    fireEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('m-new', expect.objectContaining({ kind: 'image' })),
    );
    expect(posted(fetchMock)).toBe(true);
  });

  it('saves the credit of the attached media on blur (#53)', async () => {
    const fetchMock = mockApi([
      {
        method: 'GET',
        path: '/media/media-123/meta',
        body: { id: 'media-123', alt: null, credit: null, durationMs: null },
      },
      {
        method: 'PUT',
        path: '/media/media-123/credit',
        body: { id: 'media-123', alt: null, credit: 'CC0', durationMs: null },
      },
    ]);
    renderUpload('media-123');
    const field = await screen.findByLabelText(/Crédit/);
    fireEvent.change(field, { target: { value: 'Photo : Lin, CC BY 4.0' } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes('/media/media-123/credit') &&
            String((opts as RequestInit | undefined)?.body).includes('CC BY 4.0'),
        ),
      ).toBe(true),
    );
  });

  it("offers the instance's media in their own tab, reused like one's own (#62)", async () => {
    const logo = {
      id: 'm-inst',
      url: '/api/v1/media/m-inst',
      kind: 'image',
      name: 'logo.webp',
      alt: 'Logo',
      credit: 'In-house',
      durationMs: null,
      peaks: [],
      width: 512,
      height: 512,
      sizeBytes: 900,
      createdAt: '2026-09-24T10:00:00.000Z',
      usedIn: 0,
      inHistory: false,
    };
    mockApi([
      { method: 'GET', path: /\/media\?kind=image/, body: [] },
      { method: 'GET', path: /\/media\/instance\?kind=image/, body: [logo] },
      { method: 'GET', path: '/media/links', body: [] },
      {
        method: 'POST',
        path: '/media/m-inst/reuse',
        status: 201,
        body: { mediaId: 'm-copy', url: '/api/v1/media/m-copy', kind: 'image' },
      },
    ]);
    const { onChange } = renderUpload(null);
    fireEvent.click(screen.getByRole('button', { name: 'Mes images' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Médias globaux' }));
    const pick = await screen.findByRole('button', { name: 'Utiliser logo.webp' });
    expect(screen.getByText('512 × 512')).toBeInTheDocument();
    expect(screen.getByText('In-house')).toBeInTheDocument();
    // Nothing of the instance's can be deleted from here.
    expect(screen.queryByRole('button', { name: /^Supprimer/ })).toBeNull();
    fireEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('m-copy', expect.objectContaining({ kind: 'image' })),
    );
  });

  it('reuses an original uploaded before instead of converting and sending it again', async () => {
    const known = {
      id: 'm-film',
      url: '/api/v1/media/m-film',
      kind: 'video',
      name: 'scooters.mp4',
      alt: null,
      credit: 'Tze Chiang Hao, CC BY-SA 4.0',
      durationMs: 12_000,
      peaks: [],
      width: 894,
      height: 602,
      sizeBytes: 2_400_000,
      createdAt: '2026-09-24T10:00:00.000Z',
      usedIn: 1,
      inHistory: false,
    };
    const fetchMock = mockApi([
      { method: 'GET', path: /\/media\/source\/[0-9a-f]{64}\?kind=video/, body: known },
      {
        method: 'POST',
        path: '/media/m-film/reuse',
        status: 201,
        body: { mediaId: 'm-again', url: '/api/v1/media/m-again', kind: 'video' },
      },
    ]);
    vi.mocked(convertMedia).mockClear();
    const queryClient = new QueryClient();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MediaUpload value={null} onChange={onChange} kind="video" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: {
        files: [new File([new Uint8Array([1, 2, 3])], 'scooters.webm', { type: 'video/webm' })],
      },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        'm-again',
        expect.objectContaining({ kind: 'video', durationMs: 12_000 }),
      ),
    );
    expect(convertMedia).not.toHaveBeenCalled();
    // Nothing was sent but the reuse.
    const posts = fetchMock.mock.calls.filter(
      ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/media/m-film/reuse'),
    ]);
  });
});
