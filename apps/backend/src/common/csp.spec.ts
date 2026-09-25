import type { NextFunction, Request, Response } from 'express';
import { contentSecurityPolicy, cspMiddleware } from './csp';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe('contentSecurityPolicy', () => {
  it('keeps everything to this origin in local mode', () => {
    const policy = contentSecurityPolicy({ AUTH_MODE: 'none' });
    expect(directive(policy, 'default-src')).toBe("'self'");
    expect(directive(policy, 'script-src')).toBe("'self' 'wasm-unsafe-eval'");
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(directive(policy, 'frame-src')).toBe("'none'");
    expect(directive(policy, 'object-src')).toBe("'none'");
  });

  it('needs no exception for the OIDC provider: the backend talks to it, the browser navigates', () => {
    const policy = contentSecurityPolicy({
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://sso.example.org/realms/quiz-dock',
    });
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(directive(policy, 'frame-src')).toBe("'none'");
  });

  it('lets a logo served from another host in, even over plain http', () => {
    const policy = contentSecurityPolicy({ APP_LOGO_URL: 'http://cdn.example.org/logo.svg' });
    expect(directive(policy, 'img-src')).toContain('http://cdn.example.org');
  });

  it('ignores a configured URL it cannot read', () => {
    const policy = contentSecurityPolicy({ APP_LOGO_URL: 'not a url' });
    expect(directive(policy, 'img-src')).toBe("'self' data: blob: https:");
  });
});

describe('cspMiddleware', () => {
  const run = (path: string) => {
    const setHeader = jest.fn();
    const next = jest.fn() as NextFunction;
    cspMiddleware({ AUTH_MODE: 'none' })(
      { path } as Request,
      { setHeader } as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalled();
    return setHeader;
  };

  it('sends the policy with the pages and their assets', () => {
    for (const path of ['/', '/quizzes/01ABC/preview', '/assets/index.js', '/config.js']) {
      expect(run(path)).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    }
  });

  it('leaves the API, the socket and the probe alone', () => {
    for (const path of ['/api/v1/me', '/api/docs', '/socket.io/', '/health']) {
      expect(run(path)).not.toHaveBeenCalled();
    }
  });
});
