import type { NextFunction, Request, Response } from 'express';
import { isCrossOrigin } from './session-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `AUTH_MODE=oidc`: the session is a cookie the browser adds by itself, so a
 * request that changes something must come from the application's own pages
 * (CSRF). `SameSite=Lax` already keeps the cookie off other sites' requests; this
 * also covers the same site's other origins (another port, a sibling subdomain)
 * and the sign-in itself.
 */
export function sameOriginMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !SAFE_METHODS.has(req.method) &&
      req.path.startsWith('/api/') &&
      isCrossOrigin(req.headers, req.host)
    ) {
      res.status(403).json({ code: 'auth.cross_origin' });
      return;
    }
    next();
  };
}
