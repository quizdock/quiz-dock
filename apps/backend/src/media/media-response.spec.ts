import { mediaHeaders } from './media-response';

describe('mediaHeaders', () => {
  it('serves a recognised type as itself, sandboxed', () => {
    expect(mediaHeaders('audio/mp4')).toEqual({
      'Content-Type': 'audio/mp4',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
  });

  it('serves anything else as a download', () => {
    for (const mime of ['image/svg+xml', 'text/html', undefined]) {
      expect(mediaHeaders(mime)).toMatchObject({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
      });
    }
  });
});
