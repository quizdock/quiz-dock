// The public demo's audience counter (GDPR: no cookie, no personal data kept).
// The demo's server sends a day-salted hash and a country per page view, and its
// starts; the demo's pages send their time on page. Nothing about a request is
// logged. The day is always the Worker's (UTC), never the caller's.

const HASH = /^[a-f0-9]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;
/** Thirty minutes: a tab left open longer says nothing about reading. */
const MAX_SECONDS = 1800;

const today = () => new Date().toISOString().slice(0, 10);
const empty = (status, headers = {}) => new Response(null, { status, headers });

/** The demo's server, by its token (compared in constant time). */
function authorised(request, env) {
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.STATS_TOKEN ?? ''}`;
  if (!env.STATS_TOKEN || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function hit(request, env) {
  if (!authorised(request, env)) return empty(401);
  let body;
  try {
    body = await request.json();
  } catch {
    return empty(400);
  }
  if (typeof body?.hash !== 'string' || !HASH.test(body.hash)) return empty(400);
  const country =
    typeof body.country === 'string' && COUNTRY.test(body.country) ? body.country : 'XX';
  const day = today();
  const seen = await env.DB.prepare(
    'INSERT OR IGNORE INTO visitors_today (day, country, hash) VALUES (?, ?, ?)',
  )
    .bind(day, country, body.hash)
    .run();
  const fresh = seen.meta?.changes ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO stats_daily (day, country, hits, uniques) VALUES (?, ?, 1, ?)
     ON CONFLICT(day, country) DO UPDATE SET hits = hits + 1, uniques = uniques + excluded.uniques`,
  )
    .bind(day, country, fresh)
    .run();
  return empty(204);
}

async function started(request, env) {
  if (!authorised(request, env)) return empty(401);
  await env.DB.prepare(
    `INSERT INTO render_starts (day, count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1`,
  )
    .bind(today())
    .run();
  return empty(204);
}

async function duration(request, env) {
  const cors = { 'access-control-allow-origin': env.ALLOWED_ORIGIN };
  if (request.headers.get('origin') !== env.ALLOWED_ORIGIN) return empty(403);
  let s;
  try {
    // Plain text, as the page sends it: no preflight.
    s = JSON.parse(await request.text())?.s;
  } catch {
    return empty(400, cors);
  }
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 1) return empty(400, cors);
  const seconds = Math.min(Math.round(s), MAX_SECONDS);
  await env.DB.prepare(
    `INSERT INTO durations_daily (day, total_seconds, samples) VALUES (?, ?, 1)
     ON CONFLICT(day) DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds,
                                    samples = samples + 1`,
  )
    .bind(today(), seconds)
    .run();
  return empty(204, cors);
}

/** Every night: yesterday's hashes go, aggregates past 13 months go. */
export async function purge(env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM visitors_today WHERE day < date('now')"),
    env.DB.prepare("DELETE FROM stats_daily WHERE day < date('now', '-13 months')"),
    env.DB.prepare("DELETE FROM durations_daily WHERE day < date('now', '-13 months')"),
    env.DB.prepare("DELETE FROM render_starts WHERE day < date('now', '-13 months')"),
  ]);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/duration' && request.method === 'OPTIONS') {
        return empty(204, {
          'access-control-allow-origin': env.ALLOWED_ORIGIN,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
        });
      }
      if (request.method !== 'POST') return empty(404);
      if (pathname === '/hit') return await hit(request, env);
      if (pathname === '/render-started') return await started(request, env);
      if (pathname === '/duration') return await duration(request, env);
      return empty(404);
    } catch {
      // A database error: no detail, nothing logged.
      return empty(500);
    }
  },
  async scheduled(_controller, env) {
    await purge(env);
  },
};
