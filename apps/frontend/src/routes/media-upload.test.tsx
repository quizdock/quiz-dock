import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/harness';
import { MediaUpload } from './media-upload';

/** The smallest MP4 an iPhone could have written: one HEVC video track. */
function hevcMp4(): Uint8Array {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const box = (type: string, ...parts: number[][]): number[] => {
    const body = parts.flat();
    return [...u32(8 + body.length), ...ascii(type), ...body];
  };
  const full = (type: string, ...parts: number[][]) => box(type, [0, 0, 0, 0], ...parts);
  const stsd = full('stsd', u32(1), box('hvc1', new Array(8).fill(0)));
  const hdlr = full('hdlr', u32(0), ascii('vide'), new Array(12).fill(0));
  const trak = box('trak', box('mdia', hdlr, box('minf', box('stbl', stsd))));
  return Uint8Array.from([...box('ftyp', ascii('isom'), u32(0)), ...box('moov', trak)]);
}

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

  it('turns an HEVC film away before sending it, with the way out', async () => {
    const fetchMock = mockApi([]);
    const queryClient = new QueryClient();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MediaUpload value={null} onChange={onChange} kind="video" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: { files: [new File([hevcMp4() as BlobPart], 'IMG_0042.mp4', { type: 'video/mp4' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/HEVC.*HandBrake/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('turns away a file whose content is not what its name says', async () => {
    const fetchMock = mockApi([]);
    renderUpload(null);
    fireEvent.change(screen.getByLabelText('Fichier média'), {
      target: { files: [new File(['<svg/>'], 'photo.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Format non pris en charge/);
    expect(fetchMock).not.toHaveBeenCalled();
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
});
