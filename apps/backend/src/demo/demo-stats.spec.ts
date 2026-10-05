import type { NextFunction, Request, Response } from 'express';
import {
  countsAsPageView,
  demoStatsMiddleware,
  demoStatsTarget,
  reportDemoStart,
} from './demo-stats';
import { settingsFrom } from '../admin/settings/settings.service';

const BROWSER = 'Mozilla/5.0 (Macintosh) Firefox/140.0';
const target = { url: 'https://stats.example', token: 't'.repeat(40) };

function request(over: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  return {
    method: 'GET',
    path: '/quizzes',
    socket: { remoteAddress: '10.0.0.1' },
    ...over,
    headers: { accept: 'text/html,*/*', 'user-agent': BROWSER, ...over.headers },
  } as unknown as Request;
}

describe('demo statistics', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });
  afterEach(() => fetchSpy.mockRestore());

  it('counts only in a demo with its URL and token', () => {
    const env = { DEMO_STATS_URL: 'https://stats.example/', DEMO_STATS_TOKEN: target.token };
    expect(demoStatsTarget(settingsFrom(env))).toBeNull();
    expect(demoStatsTarget(settingsFrom({ ...env, DEMO_MODE: 'true' }))).toEqual(target);
    expect(demoStatsTarget(settingsFrom({ DEMO_MODE: 'true' }))).toBeNull();
  });

  it('a page view is a browser asking for a page: not a file, a probe, the API or a robot', () => {
    expect(countsAsPageView(request())).toBe(true);
    expect(countsAsPageView(request({ method: 'HEAD' }))).toBe(false);
    expect(countsAsPageView(request({ path: '/assets/index.css' }))).toBe(false);
    expect(countsAsPageView(request({ path: '/logo.png' }))).toBe(false);
    expect(countsAsPageView(request({ path: '/api/v1/quizzes' }))).toBe(false);
    expect(countsAsPageView(request({ path: '/health' }))).toBe(false);
    expect(countsAsPageView(request({ headers: { accept: 'application/json' } }))).toBe(false);
    expect(countsAsPageView(request({ headers: { 'user-agent': 'curl/8.7' } }))).toBe(false);
    expect(countsAsPageView(request({ headers: { 'user-agent': '' } }))).toBe(false);
  });

  it('sends a hash and a country, never the IP nor the user-agent, after the response', () => {
    const next = jest.fn() as NextFunction;
    demoStatsMiddleware(target)(
      request({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2', 'cf-ipcountry': 'FR' } }),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://stats.example/hit');
    const sent = String(init.body);
    expect(JSON.parse(sent)).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      country: 'FR',
    });
    expect(sent).not.toContain('203.0.113.7');
    expect(sent).not.toContain('Firefox');
  });

  it('one visitor, one hash for the day; no country said, XX', () => {
    const run = (headers: Record<string, string>) =>
      demoStatsMiddleware(target)(request({ headers }), {} as Response, jest.fn());
    run({ 'x-forwarded-for': '203.0.113.7' });
    run({ 'x-forwarded-for': '203.0.113.7' });
    run({ 'x-forwarded-for': '198.51.100.9' });
    const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[2].hash).not.toBe(bodies[0].hash);
    expect(bodies[0].country).toBe('XX');
  });

  it('outside a counting demo: next, and nothing sent', () => {
    const next = jest.fn() as NextFunction;
    demoStatsMiddleware(null)(request(), {} as Response, next);
    reportDemoStart(null);
    expect(next).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a start is reported; the Worker away throws nothing', async () => {
    fetchSpy.mockRejectedValue(new Error('unreachable'));
    expect(() => reportDemoStart(target)).not.toThrow();
    expect(fetchSpy.mock.calls[0][0]).toBe('https://stats.example/render-started');
    await new Promise((r) => setImmediate(r)); // the rejection is caught, not left unhandled
  });
});
