// The Worker against a real SQLite (node:sqlite), shaped as D1: its acceptance criteria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { purge, readPulls } from './index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_init.sql', '0002_docker_pulls.sql'])
    db.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
  const statement = (sql) => {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async run() {
        const { changes } = db.prepare(sql).run(...args);
        return { meta: { changes } };
      },
      async all() {
        return {
          results: db
            .prepare(sql)
            .all(...args)
            .map((row) => ({ ...row })),
        };
      },
    };
  };
  return {
    db,
    prepare: statement,
    async batch(statements) {
      for (const s of statements) await s.run();
    },
  };
}

const ORIGIN = 'https://demo.example';
const TOKEN = 't'.repeat(40);
const setup = () => {
  const DB = d1();
  return { DB, env: { DB, STATS_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN } };
};
const post = (path, { body, headers = {} } = {}) =>
  new Request(`https://stats.example${path}`, { method: 'POST', body, headers });
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const hash = 'a'.repeat(64);
const day = new Date().toISOString().slice(0, 10);

test('two page views of one visitor: two hits, one unique, in its country', async () => {
  const { DB, env } = setup();
  for (let i = 0; i < 2; i++) {
    const res = await worker.fetch(
      post('/hit', { body: JSON.stringify({ hash, country: 'FR' }), headers: auth }),
      env,
    );
    assert.equal(res.status, 204);
  }
  assert.deepEqual(
    { ...DB.db.prepare('SELECT day, country, hits, uniques FROM stats_daily').get() },
    { day, country: 'FR', hits: 2, uniques: 1 },
  );
});

test('a country unread is XX; a bad hash is refused; no token, 401', async () => {
  const { DB, env } = setup();
  await worker.fetch(
    post('/hit', { body: JSON.stringify({ hash, country: 'fr' }), headers: auth }),
    env,
  );
  assert.equal(DB.db.prepare('SELECT country FROM stats_daily').get().country, 'XX');
  const bad = await worker.fetch(
    post('/hit', { body: JSON.stringify({ hash: 'x', country: 'FR' }), headers: auth }),
    env,
  );
  assert.equal(bad.status, 400);
  const anon = await worker.fetch(post('/hit', { body: JSON.stringify({ hash }) }), env);
  assert.equal(anon.status, 401);
});

test('a start counts one more for the day', async () => {
  const { DB, env } = setup();
  await worker.fetch(post('/render-started', { headers: auth }), env);
  await worker.fetch(post('/render-started', { headers: auth }), env);
  assert.equal(DB.db.prepare('SELECT count FROM render_starts').get().count, 2);
});

test('time on page: from the demo only, capped at 30 minutes', async () => {
  const { DB, env } = setup();
  const from = (origin, s) =>
    worker.fetch(post('/duration', { body: JSON.stringify({ s }), headers: { origin } }), env);
  assert.equal((await from('https://elsewhere.example', 10)).status, 403);
  const ok = await from(ORIGIN, 10.4);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  await from(ORIGIN, 99999);
  assert.equal((await from(ORIGIN, 0)).status, 400);
  assert.deepEqual(
    { ...DB.db.prepare('SELECT total_seconds, samples FROM durations_daily').get() },
    { total_seconds: 10 + 1800, samples: 2 },
  );
});

test('other methods and routes: 404', async () => {
  const { env } = setup();
  assert.equal((await worker.fetch(new Request('https://stats.example/hit'), env)).status, 404);
  assert.equal((await worker.fetch(post('/nowhere', { headers: auth }), env)).status, 404);
});

test("the night's purge: yesterday's hashes go, today's stay", async () => {
  const { DB, env } = setup();
  DB.db.prepare('INSERT INTO visitors_today VALUES (?, ?, ?)').run('2000-01-01', 'FR', hash);
  DB.db.prepare('INSERT INTO visitors_today VALUES (?, ?, ?)').run(day, 'FR', hash);
  DB.db.prepare('INSERT INTO stats_daily VALUES (?, ?, 1, 1)').run('2000-01-01', 'FR');
  await purge(env);
  assert.deepEqual(
    DB.db
      .prepare('SELECT day FROM visitors_today')
      .all()
      .map((r) => r.day),
    [day],
  );
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM stats_daily').get().n, 0);
});

test('GET /stats: the aggregates by day for anyone, never a hash', async () => {
  const { DB, env } = setup();
  DB.db.exec(`
    INSERT INTO stats_daily VALUES ('${day}', 'FR', 3, 2), ('${day}', 'UA', 1, 1),
                                   (date('now', '-1 day'), 'FR', 2, 1),
                                   (date('now', '-40 days'), 'FR', 9, 9);
    INSERT INTO durations_daily VALUES ('${day}', 120, 2);
    INSERT INTO render_starts VALUES ('${day}', 1);
    INSERT INTO visitors_today VALUES ('${day}', 'FR', '${hash}');
  `);
  const res = await worker.fetch(new Request('https://stats.example/stats'), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  const body = await res.json();
  assert.equal(body.days, 30);
  assert.deepEqual(body.totals, { hits: 6, visitor_days: 4, mean_seconds: 60, render_starts: 1 });
  assert.equal(body.by_day.length, 2);
  assert.deepEqual(body.by_day[0], {
    day,
    hits: 4,
    uniques: 3,
    countries: { FR: 2, UA: 1 },
    mean_seconds: 60,
    duration_samples: 2,
    render_starts: 1,
    docker_pulls: null,
  });
  assert.ok(!JSON.stringify(body).includes(hash));
  const all = await (
    await worker.fetch(new Request('https://stats.example/stats?days=60'), env)
  ).json();
  assert.equal(all.by_day.length, 3);
});

test("the night's Docker Hub reading: the repository's counter, once a day", async () => {
  const { DB, env } = setup();
  env.DOCKER_REPO = 'someone/app';
  const asked = [];
  const hub = (count) => async (url) => {
    asked.push(url);
    return Response.json({ pull_count: count });
  };
  await readPulls(env, hub(7800));
  await readPulls(env, hub(7812));
  assert.equal(asked[0], 'https://hub.docker.com/v2/repositories/someone/app/');
  assert.deepEqual(
    DB.db
      .prepare('SELECT day, pull_count FROM docker_pulls')
      .all()
      .map((r) => ({ ...r })),
    [{ day, pull_count: 7812 }],
  );
  await readPulls(env, async () => new Response(null, { status: 503 }));
  const body = await (await worker.fetch(new Request('https://stats.example/stats'), env)).json();
  assert.equal(body.by_day[0].docker_pulls, 7812);
});
