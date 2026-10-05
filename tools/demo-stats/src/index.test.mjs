// The Worker against a real SQLite (node:sqlite), shaped as D1: its acceptance criteria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { purge } from './index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
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
