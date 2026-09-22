import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/harness';
import { MediaUpload } from './media-upload';

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
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('media-123'));
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
