import type { NextFunction, Request, Response } from 'express';
import { sameOriginMiddleware } from './same-origin.middleware';
import { isCrossOrigin, readCookie, serializeCookie } from './session-cookie';

describe('cookies', () => {
  it('reads one cookie among others', () => {
    expect(readCookie('a=1; qd_session=abc%2Fd; b=2', 'qd_session')).toBe('abc/d');
    expect(readCookie('xqd_session=1', 'qd_session')).toBeNull();
    expect(readCookie(undefined, 'qd_session')).toBeNull();
  });

  it('writes an httpOnly, SameSite=Lax cookie, Secure over HTTPS only', () => {
    expect(serializeCookie('qd_session', 'v', { secure: false })).toBe(
      'qd_session=v; Path=/; HttpOnly; SameSite=Lax',
    );
    expect(
      serializeCookie('qd_login', 'v', { secure: true, path: '/api/v1/auth', maxAgeS: 0 }),
    ).toBe('qd_login=v; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
  });
});

describe('isCrossOrigin', () => {
  it('believes Sec-Fetch-Site when the browser sends it', () => {
    expect(isCrossOrigin({ 'sec-fetch-site': 'same-origin' }, 'other:1')).toBe(false);
    expect(isCrossOrigin({ 'sec-fetch-site': 'same-site' }, 'app')).toBe(true);
    expect(isCrossOrigin({ 'sec-fetch-site': 'cross-site' }, 'app')).toBe(true);
  });

  it('otherwise compares the Origin with the host', () => {
    expect(isCrossOrigin({ origin: 'https://quiz.example.org' }, 'quiz.example.org')).toBe(false);
    expect(isCrossOrigin({ origin: 'http://localhost:9999' }, 'localhost:15173')).toBe(true);
    expect(isCrossOrigin({ origin: 'null' }, 'app')).toBe(true);
  });

  it('lets a client that is no browser through (no Origin, nothing ambient)', () => {
    expect(isCrossOrigin({}, 'app')).toBe(false);
  });
});

describe('sameOriginMiddleware', () => {
  const run = (method: string, path: string, headers: Record<string, string>) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn() as NextFunction;
    sameOriginMiddleware()(
      { method, path, headers, host: 'app.example.org' } as unknown as Request,
      res as unknown as Response,
      next,
    );
    return { res, next };
  };

  it('refuses a change requested by another origin', () => {
    const { res, next } = run('POST', '/api/v1/quizzes', { 'sec-fetch-site': 'same-site' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 'auth.cross_origin' });
  });

  it('lets reads, the pages and our own requests through', () => {
    expect(run('GET', '/api/v1/me', { 'sec-fetch-site': 'cross-site' }).next).toHaveBeenCalled();
    expect(
      run('POST', '/api/v1/auth/login', { 'sec-fetch-site': 'same-origin' }).next,
    ).toHaveBeenCalled();
    expect(run('POST', '/somewhere', { 'sec-fetch-site': 'cross-site' }).next).toHaveBeenCalled();
  });
});
