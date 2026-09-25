import { ApiError, getAuthHeaders } from './http';

/**
 * Downloads an authenticated binary endpoint (the generated client only speaks
 * JSON): fetch with the auth headers, then hand the blob to the browser under
 * the server's filename. A plain `<a href>` would not carry the headers.
 */
export async function downloadFile(
  url: string,
  fallbackName: string,
  /** A POST with a JSON body, when the download needs parameters. */
  body?: unknown,
): Promise<void> {
  const res = await fetch(
    url,
    body === undefined
      ? { headers: getAuthHeaders() }
      : {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (!res.ok) {
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, data);
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
