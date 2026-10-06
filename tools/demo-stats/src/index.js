// The public demo's audience counter (GDPR: no cookie, no personal data kept).
// The demo's server sends a day-salted hash and a country per page view, and its
// starts; the demo's pages send their time on page. Nothing about a request is
// logged. The day is always the Worker's (UTC), never the caller's. GET /stats
// gives the aggregates to anyone; the hashes of the day never leave the database.

const HASH = /^[a-f0-9]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;
/** Thirty minutes: a tab left open longer says nothing about reading. */
const MAX_SECONDS = 1800;
/** GET /stats: 30 days unless ?days= says otherwise, 400 at most (13 months kept). */
const STATS_DAYS = 30;
const STATS_MAX_DAYS = 400;
/** Five minutes in caches: a public page does not read the database at each view. */
const STATS_MAX_AGE = 300;

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

/**
 * The public figures, per UTC day, newest first: page views, unique visitors of the
 * day (one visitor two days running counts twice: `visitor_days` in the totals),
 * by country, the mean time on page and the demo's starts.
 */
async function stats(request, env) {
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = Number.isInteger(asked) && asked > 0 ? Math.min(asked, STATS_MAX_DAYS) : STATS_DAYS;
  const since = `-${days - 1} days`;
  const [views, durations, starts] = await Promise.all(
    [
      "SELECT day, country, hits, uniques FROM stats_daily WHERE day >= date('now', ?)",
      "SELECT day, total_seconds, samples FROM durations_daily WHERE day >= date('now', ?)",
      "SELECT day, count FROM render_starts WHERE day >= date('now', ?)",
    ].map((sql) =>
      env.DB.prepare(sql)
        .bind(since)
        .all()
        .then((r) => r.results ?? []),
    ),
  );
  const byDay = new Map();
  const at = (day) => {
    if (!byDay.has(day))
      byDay.set(day, {
        day,
        hits: 0,
        uniques: 0,
        countries: {},
        mean_seconds: null,
        duration_samples: 0,
        render_starts: 0,
      });
    return byDay.get(day);
  };
  for (const v of views) {
    const d = at(v.day);
    d.hits += v.hits;
    d.uniques += v.uniques;
    d.countries[v.country] = v.uniques;
  }
  let seconds = 0;
  let samples = 0;
  for (const v of durations) {
    const d = at(v.day);
    d.mean_seconds = v.samples ? Math.round(v.total_seconds / v.samples) : null;
    d.duration_samples = v.samples;
    seconds += v.total_seconds;
    samples += v.samples;
  }
  for (const v of starts) at(v.day).render_starts = v.count;
  const list = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  const sum = (key) => list.reduce((n, d) => n + d[key], 0);
  return Response.json(
    {
      days,
      to: today(),
      totals: {
        hits: sum('hits'),
        visitor_days: sum('uniques'),
        mean_seconds: samples ? Math.round(seconds / samples) : null,
        render_starts: sum('render_starts'),
      },
      by_day: list,
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': `public, max-age=${STATS_MAX_AGE}`,
      },
    },
  );
}

/** Through the edge cache when there is one (not in the tests). */
async function cachedStats(request, env, ctx) {
  const cache = globalThis.caches?.default;
  if (!cache) return stats(request, env);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await stats(request, env);
  ctx?.waitUntil(cache.put(request, res.clone()));
  return res;
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
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/stats' && request.method === 'GET')
        return await cachedStats(request, env, ctx);
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
