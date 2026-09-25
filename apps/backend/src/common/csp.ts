import type { NextFunction, Request, Response } from 'express';

/** The origin of a configured URL, or nothing when it is empty or unreadable. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The Content-Security-Policy of the application's pages: everything from this
 * origin, plus a logo served from another host. The OIDC provider needs no
 * exception: the backend talks to it, the browser only navigates there.
 *
 * - `'wasm-unsafe-eval'` and `worker-src blob:`: the in-browser converter encodes
 *   AAC in WebAssembly, in a worker started from a blob.
 * - `img-src https:`: an author's Markdown may show an image from the web.
 * - `style-src 'unsafe-inline'`: style attributes and the few style tags libraries
 *   insert; no script runs inline, and script is what the policy guards.
 */
export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const logo = originOf(env.APP_LOGO_URL);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...(logo ? [logo] : [])],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
    .join('; ');
}

/** Paths that are not the application's pages: the API (Swagger has its own scripts), the socket, the probe. */
const NOT_A_PAGE = /^\/(api|socket\.io|health)(\/|$)/;

/** Sends the policy with every page of the application (the SPA and its assets). */
export function cspMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const policy = contentSecurityPolicy(env);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!NOT_A_PAGE.test(req.path)) res.setHeader('Content-Security-Policy', policy);
    next();
  };
}
