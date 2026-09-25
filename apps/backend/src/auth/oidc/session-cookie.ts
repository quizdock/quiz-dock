import type { IncomingHttpHeaders } from 'node:http';

/** The session cookie: a random id, unreadable by scripts (`httpOnly`). */
export const SESSION_COOKIE = 'qd_session';
/** Ties a sign-in's return to the browser that started it (login CSRF). */
export const LOGIN_COOKIE = 'qd_login';
/** The login cookie only travels to the auth endpoints. */
export const LOGIN_COOKIE_PATH = '/api/v1/auth';

/** One cookie of a `Cookie` header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * A `Set-Cookie` value. `SameSite=Lax`: sent when the provider sends the browser
 * back (a top-level navigation), never with a request another site makes.
 * `Secure` over HTTPS, as the request (through a trusted proxy) says.
 */
export function serializeCookie(
  name: string,
  value: string,
  opts: { secure: boolean; path?: string; maxAgeS?: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeS !== undefined) parts.push(`Max-Age=${opts.maxAgeS}`);
  return parts.join('; ');
}

/**
 * Whether a request comes from another site's page. The browser says so in
 * `Sec-Fetch-Site`; without it, the `Origin` is compared with the host the
 * request was sent to. No header at all: not a browser acting for a page (a
 * script, the CLI), nothing ambient to abuse.
 */
export function isCrossOrigin(headers: IncomingHttpHeaders, host: string | undefined): boolean {
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string') return site !== 'same-origin';
  const origin = headers.origin;
  if (typeof origin !== 'string') return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
