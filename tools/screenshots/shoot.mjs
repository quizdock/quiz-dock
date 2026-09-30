#!/usr/bin/env node
/**
 * Every screenshot of docs/screenshots and the frames of the demo GIF, taken on
 * the dev stack (local mode) by run.sh; assemble.mjs then puts the phones side by
 * side and makes the GIF.
 *
 *   node shoot.mjs setup   the host takes the seat (the account exists after it)
 *   node shoot.mjs shoot   the rest: an administrator host by then (run.sh grants it)
 *
 * The content is the shipped sample quizzes, taken from the template catalogue into
 * the bank of a host of its own (Mei), emptied first; the seat is let go at the end.
 * A game is played for real: the host drives it through its own socket, a few
 * simulated players answer, two phones join through the page. Each shot waits for
 * the page to settle (network idle, pictures decoded), so a run gives the same
 * pictures from one release to the next, give or take a clock.
 */
/* global document -- in page.evaluate, the page's own */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? '/out';
const HOST = 'Mei';
const BOTS = ['Ana', 'Ben', 'Chloé', 'Dev', 'Emre', 'Farah'];
/** GAME_READ_DELAY_MS of the stack: a question's options come after it. */
const READ_DELAY_MS = Number(process.env.READ_DELAY_MS ?? 3000);
const DESKTOP = { width: 1400, height: 860 };
const SCREEN = { width: 1400, height: 788 };
const PHONE = { width: 390, height: 780 };
/** Pieces for assemble.mjs: the phones to put side by side, the GIF's frames. */
const WORK = `${OUT}/.work`;
const FRAMES = `${WORK}/frames`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(method, path, body) {
  const res = await fetch(`${URL}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-local-user': HOST },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** Network idle, every picture decoded, fonts ready, then a beat for transitions. */
async function settle(page, ms = 600) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
      await Promise.all(
        [...document.images].map((img) =>
          img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
        ),
      );
    })
    .catch(() => undefined);
  await sleep(ms);
}

const failed = [];
/** A step that may fail without stopping the others: it is reported at the end. */
async function attempt(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed.push(name);
    log('FAILED', name, String(err).split('\n')[0]);
  }
}
async function shot(page, name, { locator, settleMs, piece = false } = {}) {
  try {
    await settle(page, settleMs);
    const path = `${piece ? WORK : OUT}/${name}.png`;
    if (locator) await locator.screenshot({ path });
    else await page.screenshot({ path });
    log('shot', name);
    return path;
  } catch (err) {
    failed.push(name);
    log('FAILED', name, String(err).split('\n')[0]);
    return null;
  }
}

/** Phones to put side by side (assemble.mjs): the pieces are kept under .work/. */
const composites = [];
function beside(name, ...paths) {
  if (paths.some((p) => !p)) return failed.push(name);
  composites.push({ name, parts: paths });
}

// ── The room ────────────────────────────────────────────────────────────────

function socket(auth) {
  return io(`${URL}/game`, { transports: ['websocket'], auth, forceNew: true });
}

/** The host's own control, beside its console: drives the game step by step. */
function hostControl(pin) {
  const s = socket({ localUser: HOST });
  let state = null;
  const waiters = [];
  s.on('game:state', (p) => {
    state = p;
    for (const w of [...waiters]) {
      if (!w.test(p)) continue;
      waiters.splice(waiters.indexOf(w), 1);
      w.done(p);
    }
  });
  s.on('connect', () => s.emit('host:attach', { pin }));
  return {
    state: () => state,
    emit: (event) => s.emit(event, { pin }),
    emitWith: (event, payload) => s.emit(event, { pin, ...payload }),
    until: (test, timeoutMs = 60_000) =>
      state && test(state)
        ? Promise.resolve(state)
        : new Promise((done, fail) => {
            const w = { test, done };
            waiters.push(w);
            setTimeout(
              () => fail(new Error(`state not reached (now ${JSON.stringify(state)})`)),
              timeoutMs,
            );
          }),
    close: () => s.disconnect(),
  };
}

/** Simulated players: they join, say they are ready, and answer each question. */
async function bots(pin) {
  const all = [];
  for (const [i, nickname] of BOTS.entries()) {
    const s = socket({});
    await new Promise((r) => s.on('connect', r));
    await s.emitWithAck('player:join', { pin, nickname, presence: 'room' });
    await s.emitWithAck('player:ready', { pin, ready: true });
    s.on('question:start', (q) => {
      const delay = Math.max(0, q.startedAt - Date.now()) + 1500 + i * 700;
      setTimeout(
        () =>
          s.emit('player:submit', { pin, questionIndex: q.questionIndex, answer: answerTo(q, i) }),
        delay,
      );
    });
    all.push(s);
  }
  return () => all.forEach((s) => s.disconnect());
}

/** A plausible answer: mostly right-looking, never all the same. */
function answerTo(q, i) {
  const ids = (q.options ?? []).map((o) => o.id);
  switch (q.type) {
    case 'numeric':
      return [330, 324, 300, 350, 5137, 5000, 101][i % 7];
    case 'text_input':
      return ['Cannes', 'cannes', 'Nice', 'Cannes', 'Taroko', 'İstanbul'][i % 6];
    case 'multiple_choice':
      return ids.filter((_, k) => (k + i) % 3 !== 1);
    case 'ordering':
      return [...ids].sort(() => ((i * 7919) % 3) - 1);
    default:
      return ids[(i * 5 + 1) % ids.length];
  }
}

// ── Phases ──────────────────────────────────────────────────────────────────

async function setup() {
  // A run cut short leaves the seat with Mei: holding it already is fine.
  await api('POST', '/auth/host-seat/claim', { expiresInMinutes: null }).catch((err) => {
    if (!String(err).includes('already_host')) throw err;
  });
  log('seat held by', HOST);
}

async function takeSamples() {
  // A run cut short may leave its room open, which holds its quiz.
  for (const game of await api('GET', '/games/mine')) {
    await api('POST', `/games/${game.pin}/end`).catch(() => undefined);
  }
  for (const quiz of await api('GET', '/quizzes')) {
    if (quiz.status === 'ready')
      await api('PATCH', `/quizzes/${quiz.id}/status`, { status: 'draft' }).catch(() => undefined);
    await api('DELETE', `/quizzes/${quiz.id}`);
  }
  const entries = await api('GET', '/store');
  const quizzes = {};
  for (const e of [...entries].sort((a, b) => a.sharedAt.localeCompare(b.sharedAt))) {
    const quiz = await api('POST', `/store/${e.id}/take`);
    await api('PATCH', `/quizzes/${quiz.id}/status`, { status: 'ready' });
    quizzes[
      e.title.includes('Türkiye') ? 'turkiye' : e.title.includes('France') ? 'france' : 'taiwan'
    ] = quiz.id;
  }
  log('quizzes', JSON.stringify(quizzes));
  return quizzes;
}

async function authoring(browser, quizzes) {
  const context = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' });
  await context.addInitScript((user) => localStorage.setItem('live.localUser', user), HOST);
  const page = await context.newPage();

  await page.goto(`${URL}/quizzes`);
  await shot(page, 'my-quizzes');
  await page.goto(`${URL}/templates`);
  await shot(page, 'templates');

  await page.goto(`${URL}/quizzes/${quizzes.france}`);
  await page.getByText('How tall is the Eiffel Tower', { exact: false }).first().click();
  await shot(page, 'editor');
  // The library opens from a question without a picture yet.
  await attempt('media-library', async () => {
    await page.getByText('France shares a land border', { exact: false }).first().click();
    await page
      .getByText(/^Question media/)
      .first()
      .click();
    await page.getByRole('button', { name: 'My images' }).first().click();
    await shot(page, 'media-library');
    await page.getByRole('tab', { name: 'Global media' }).click();
    await shot(page, 'media-library-global');
    await page.keyboard.press('Escape');
  });

  await attempt('editor-image-choice', async () => {
    await page.getByText('Which of these is the Mont-Saint-Michel?').first().click();
    await shot(page, 'editor-image-choice');
  });
  await attempt('editor-slide', async () => {
    await page.getByText('Lavender season').first().click();
    await shot(page, 'editor-slide');
  });

  await page.goto(`${URL}/profile`);
  await shot(page, 'preferences');
  await page.goto(`${URL}/admin/media`);
  await shot(page, 'admin-media');
  await attempt('admin-media-preview', async () => {
    await page
      .getByRole('button', { name: /Preview marseillaise/ })
      .first()
      .click();
    await shot(page, 'admin-media-preview');
  });
  await page.keyboard.press('Escape');

  // Every question type and slide, as the big screen shows them (the preview).
  await page.setViewportSize({ width: 1760, height: 1240 });
  await page.goto(`${URL}/quizzes/${quizzes.france}/preview`);
  const stage = page.locator('div.aspect-video').first();
  const types = [
    ['types/slide-intro', 'Discover France', false],
    ['types/single-choice', 'What is the capital of France?', false],
    ['types/true-false', 'France shares a land border', false],
    ['types/multiple-choice', 'Which of these rivers', false],
    ['types/reveal-multiple-choice', 'Which of these rivers', true],
    ['types/numeric', 'How tall is the Eiffel Tower', false],
    ['types/reveal-numeric', 'How tall is the Eiffel Tower', true],
    ['types/image-choice', 'Which of these is the Mont-Saint-Michel?', false],
    ['types/reveal-image-choice', 'Which of these is the Mont-Saint-Michel?', true],
    ['types/text-input', 'film festival', false],
    ['types/slide-gradient', 'Lavender season', false],
    ['types/ordering', 'Order these French cities', false],
    ['types/reveal-ordering', 'Order these French cities', true],
    ['types/single-choice-sound', 'Which anthem is this?', false],
    ['types/poll', 'Which French region', false],
  ];
  const answer = page.getByRole('switch', { name: 'Show the answer' });
  for (const [name, step, reveal] of types) {
    try {
      await page
        .getByRole('button', { name: new RegExp(step) })
        .first()
        .click();
      if ((await answer.count()) && (await answer.isChecked()) !== reveal) await answer.click();
      await shot(page, name, { locator: (await stage.count()) ? stage : undefined });
    } catch (err) {
      failed.push(name);
      log('FAILED', name, String(err).split('\n')[0]);
    }
  }
  await context.close();
}

async function live(browser, quizzes) {
  const desk = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' });
  await desk.addInitScript((user) => localStorage.setItem('live.localUser', user), HOST);
  const consolePage = await desk.newPage();

  // Present: the access dialog, open access, then the console.
  await consolePage.goto(`${URL}/quizzes/${quizzes.france}`);
  await consolePage.getByRole('button', { name: 'Present' }).first().click();
  const open = consolePage.getByRole('radio', { name: /Open access/ });
  if (await open.count()) {
    await open.click();
    await shot(consolePage, 'participant-access', { locator: consolePage.getByRole('dialog') });
    await consolePage.getByRole('button', { name: 'Start' }).click();
  }
  await consolePage.waitForURL(/\/session\/\d{6}\/console/);
  const pin = consolePage.url().match(/session\/(\d{6})/)[1];
  log('room', pin);

  const screenContext = await browser.newContext({ viewport: SCREEN, locale: 'en-US' });
  await screenContext.addInitScript((user) => localStorage.setItem('live.localUser', user), HOST);
  const screen = await screenContext.newPage();
  await screen.goto(`${URL}/session/${pin}/projection`);
  // The browser keeps the sound off until a click: the room's one click.
  await settle(screen);
  await screen.mouse.click(SCREEN.width / 2, SCREEN.height / 2);

  const host = hostControl(pin);
  const stopBots = await bots(pin);

  // Two phones: one in the room, one remote (the big screen comes to it).
  const phone = async (nickname, presence) => {
    const ctx = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
    });
    const p = await ctx.newPage();
    await p.goto(`${URL}/join/${pin}`);
    await p.getByLabel('Nickname').fill(nickname);
    await p
      .getByRole('radio', { name: presence })
      .click()
      .catch(() => undefined);
    return p;
  };
  const lea = await phone('Léa', /In the room/);
  const joinForm = await shot(lea, 'join-form', { piece: true });
  await lea.getByRole('button', { name: 'Join the room' }).click();
  await lea.getByRole('button', { name: "I'm ready" }).click();
  const joinLobby = await shot(lea, 'join-lobby', { piece: true });
  beside('join', joinForm, joinLobby);
  const tom = await phone('Tom', /Remote/);
  await tom.getByRole('button', { name: 'Join the room' }).click();
  await tom.getByRole('button', { name: "I'm ready" }).click();

  await shot(consolePage, 'console-lobby');
  await shot(screen, 'projection-lobby');
  host.emitWith('host:lock', { locked: true });
  await shot(consolePage, 'console-lobby-access');
  host.emitWith('host:lock', { locked: false });

  // The GIF: the projection, a frame every 400 ms while it records.
  let recording = false;
  let frame = 0;
  const record = async () => {
    while (recording) {
      await screen
        .screenshot({ path: `${FRAMES}/${String(frame++).padStart(4, '0')}.png` })
        .catch(() => undefined);
      await sleep(400);
    }
  };

  // Step by step: the intro slide, then each question to its reveal.
  const next = async (test) => {
    host.emit('host:next');
    const s = await host.until(test).catch(async () => {
      host.emit('host:next'); // a media wait the host may skip
      return host.until(test);
    });
    return s;
  };
  host.emit('host:start');
  await host.until((s) => s.state === 'SLIDE_SHOW');
  recording = true;
  const recorder = record();
  await sleep(2500);
  await shot(screen, 'projection-slide');
  await shot(consolePage, 'console-slide');

  const question = (i) => (s) => s.questionIndex === i && s.state === 'ANSWERING';
  const reveal = (i) => (s) => s.questionIndex === i && s.state === 'REVEAL';

  // Q1: the capital, with its picture.
  await next(question(0));
  await lea
    .locator('.qd-answer')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await sleep(1200);
  await shot(screen, 'projection-media');
  const leaQuestion = await shot(lea, 'player-question', { piece: true });
  await shot(tom, 'player-big-screen');
  await lea
    .locator('.qd-answer')
    .nth(1)
    .click()
    .catch(() => undefined);
  await tom
    .locator('.qd-answer')
    .nth(0)
    .click()
    .catch(() => undefined);
  // Everyone answered: the room reveals by itself.
  await host.until(reveal(0), 20_000).catch(() => host.emit('host:reveal'));
  await host.until(reveal(0));
  await sleep(2500);
  await shot(screen, 'projection-reveal');
  await shot(consolePage, 'console-reveal');
  const leaReveal = await shot(lea, 'player-reveal', { piece: true });
  beside('player-play', leaQuestion, leaReveal);

  // Through to the image choice (Q5), the multiple choice shown on the console on the way.
  for (let i = 1; i <= 4; i++) {
    await next(question(i));
    if (i === 2) {
      await sleep(1200);
      await shot(screen, 'projection-question');
      await shot(consolePage, 'console-question');
    }
    if (i === 4) {
      await lea
        .locator('.qd-answer')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => undefined);
      await sleep(1500);
      const pick = await shot(lea, 'player-image-pick', { piece: true });
      await lea
        .locator('.qd-answer')
        .nth(1)
        .click()
        .catch(() => undefined);
      await tom
        .locator('.qd-answer')
        .nth(2)
        .click()
        .catch(() => undefined);
      await host.until(reveal(i), 20_000).catch(() => host.emit('host:reveal'));
      await host.until(reveal(i));
      await sleep(1500);
      beside('player-image-choice', pick, await shot(lea, 'player-image-reveal', { piece: true }));
      // The GIF ends on this reveal.
      await sleep(1500);
      recording = false;
      await recorder;
      continue;
    }
    await sleep(READ_DELAY_MS + 2500); // a few answers come in first
    host.emit('host:reveal');
    await host.until(reveal(i));
    await sleep(1500);
  }

  // The rest, the ordering on the phone, then the podium and the rating.
  let ordering = null;
  for (let i = 5; ; i++) {
    const s = await next(
      (st) => st.state === 'PODIUM' || (st.questionIndex === i && st.state === 'ANSWERING'),
    ).catch(() => null);
    if (!s || s.state === 'PODIUM') break;
    if (i === 7 && !ordering) {
      await sleep(READ_DELAY_MS + 1000); // the phone shows the options once the reading time is over
      ordering = await shot(lea, 'player-ordering', { piece: true });
    }
    host.emit('host:reveal');
    await host.until(reveal(i)).catch(() => undefined);
  }
  if (host.state()?.state !== 'PODIUM') await next((s) => s.state === 'PODIUM');
  await sleep(4000);
  await shot(screen, 'projection-podium');
  beside('player-end', ordering, await shot(lea, 'player-rate', { piece: true }));

  host.emit('host:end');
  await sleep(500);
  host.close();
  stopBots();
  await desk.close();
  await screenContext.close();
  return frame;
}

// ── Main ────────────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === 'setup') {
  await setup();
} else if (mode === 'shoot') {
  mkdirSync(`${OUT}/types`, { recursive: true });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const quizzes = await takeSamples();
  const browser = await chromium.launch();
  try {
    await authoring(browser, quizzes);
    const frames = await live(browser, quizzes);
    writeFileSync(`${WORK}/assemble.json`, JSON.stringify({ composites, frames }, null, 2));
  } finally {
    await browser.close();
    await api('POST', '/auth/host-seat/release').catch(() => undefined);
  }
  if (failed.length) {
    console.error(`Not taken: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
} else {
  console.error('usage: shoot.mjs setup|shoot');
  process.exitCode = 2;
}
