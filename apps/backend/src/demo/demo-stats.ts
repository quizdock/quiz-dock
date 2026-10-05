import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings, type SettingsService } from '../admin/settings/settings.service';

/**
 * The public demo's audience, counted by the Worker of `tools/demo-stats` (Cloudflare
 * D1): page views and unique visitors per day and country, the server's starts, the
 * time on page. GDPR first: no cookie; the IP and the user-agent never leave this
 * process, nor are they logged — they make a hash, salted with bytes drawn at start
 * and at each new UTC day, kept in memory only. Outside a demo, or without its URL
 * and token, nothing is counted and nothing leaves (the image makes no outgoing
 * request of its own accord).
 */
export interface DemoStatsTarget {
  url: string;
  token: string;
}

export function demoStatsTarget(from: SettingsService = settings): DemoStatsTarget | null {
  const url = from.get(SETTINGS.DEMO_STATS_URL);
  const token = from.get(SETTINGS.DEMO_STATS_TOKEN);
  if (!from.get(SETTINGS.DEMO_MODE) || !url || !token) return null;
  return { url, token };
}

let saltDay = '';
let salt = Buffer.alloc(0);

/** Today's salt (UTC): drawn again at the first request of each day, never kept. */
function todaysSalt(now = new Date()): Buffer {
  const day = now.toISOString().slice(0, 10);
  if (day !== saltDay) {
    salt = randomBytes(32);
    saltDay = day;
  }
  return salt;
}

const STATIC_FILE =
  /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|txt|xml|json|webmanifest)$/i;
/** Not a page: the API, the socket, the probe, the runtime configuration. */
const NOT_A_PAGE = /^\/(api|socket\.io|health|branding|config\.js)(\/|$)/;
const ROBOT =
  /bot|crawl|spider|slurp|preview|monitor|uptime|headless|curl|wget|python|java\/|go-http|axios|node-fetch/i;

/** A page view worth counting: a browser asking for a page, not a file, a probe or a robot. */
export function countsAsPageView(req: Pick<Request, 'method' | 'path' | 'headers'>): boolean {
  if (req.method !== 'GET') return false;
  if (!String(req.headers.accept ?? '').includes('text/html')) return false;
  if (STATIC_FILE.test(req.path) || NOT_A_PAGE.test(req.path)) return false;
  const agent = String(req.headers['user-agent'] ?? '');
  return agent !== '' && !ROBOT.test(agent);
}

/** The country the edge in front of the demo says (`CF-IPCountry`), else `XX`. */
function countryOf(req: Pick<Request, 'headers'>): string {
  const code = String(req.headers['cf-ipcountry'] ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : 'XX';
}

/** Sent and forgotten: the Worker away never slows a page nor throws. */
function send(target: DemoStatsTarget, path: string, body: unknown, timeoutMs: number): void {
  void fetch(`${target.url}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined);
}

/** Counts each page view, after the response is on its way. */
export function demoStatsMiddleware(target: DemoStatsTarget | null = demoStatsTarget()) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next();
    if (!target || !countsAsPageView(req)) return;
    // The client the proxy in front speaks for (Render sets it), else the socket's peer.
    // A count, not a right: a forged header only skews a statistic.
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      ?.trim();
    const ip = forwarded || req.socket.remoteAddress || '';
    const agent = String(req.headers['user-agent'] ?? '');
    const hash = createHash('sha256').update(todaysSalt()).update(`${ip}|${agent}`).digest('hex');
    send(target, '/hit', { hash, country: countryOf(req) }, 3000);
  };
}

/** One more start of the demo's server (a wake-up from sleep, a redeploy). */
export function reportDemoStart(target: DemoStatsTarget | null = demoStatsTarget()): void {
  if (target) send(target, '/render-started', undefined, 5000);
}
