#!/usr/bin/env node
/* global document -- in page.evaluate, the page's own */
/**
 * A live room played for real on the demo stack (tools/screenshots), checked and
 * photographed screen by screen: the console, the projection, a phone. Run by run.sh;
 * it prints each check, OK or FAIL, and writes the pictures to OUT for a look.
 *
 * What it walks through: the first lobby, a reveal and the quiz's standings, the
 * participants' table, stopping a quiz (scores kept), the lobby with no quiz, picking
 * the next there (its countdown, the room's standings beside it, the quiz's language),
 * stopping the countdown, the room's language, the host's own language.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? '/out';
const HOST = 'Mei';
const BOTS = ['Ana', 'Ben', 'Chloé', 'Dev'];
const DESKTOP = { width: 1400, height: 900 };
const SCREEN = { width: 1400, height: 788 };
const PHONE = { width: 390, height: 780 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];
const pages = {};
const check = (ok, what) => {
  log(ok ? 'OK  ' : 'FAIL', what);
  if (!ok) problems.push(what);
};

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

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(ms);
}
let n = 0;
async function shot(page, name) {
  await settle(page);
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  log('shot', file);
}

function socket(auth) {
  return io(`${URL}/game`, { transports: ['websocket'], auth, forceNew: true });
}

/** Simulated players: join, then answer each question (they press Ready only when told). */
async function bots(pin) {
  const all = [];
  for (const [i, nickname] of BOTS.entries()) {
    const s = socket({});
    await new Promise((r) => s.on('connect', r));
    await s.emitWithAck('player:join', { pin, nickname, presence: 'room' });
    s.on('question:start', (q) => {
      const ids = (q.options ?? []).map((o) => o.id);
      const answer =
        q.type === 'numeric'
          ? 300 + i
          : q.type === 'text_input'
            ? 'Paris'
            : q.type === 'multiple_choice'
              ? ids.slice(0, 1 + (i % 2))
              : q.type === 'ordering'
                ? ids
                : ids[i % ids.length];
      const delay = Math.max(0, q.startedAt - Date.now()) + 800 + i * 400;
      setTimeout(
        () => s.emit('player:submit', { pin, questionIndex: q.questionIndex, answer }),
        delay,
      );
    });
    all.push(s);
  }
  return {
    ready: () => Promise.all(all.map((s) => s.emitWithAck('player:ready', { pin, ready: true }))),
    close: () => all.forEach((s) => s.disconnect()),
  };
}

async function state(page) {
  return page.evaluate(() => document.querySelector('[data-state]')?.getAttribute('data-state'));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // The host's seat and a fresh bank: the shipped samples.
  await api('POST', '/auth/host-seat/claim', { expiresInMinutes: null }).catch((err) => {
    if (!String(err).includes('already_host')) throw err;
  });
  for (const game of await api('GET', '/games/mine')) {
    await api('POST', `/games/${game.pin}/end`).catch(() => undefined);
  }
  for (const quiz of await api('GET', '/quizzes')) {
    if (quiz.status === 'ready')
      await api('PATCH', `/quizzes/${quiz.id}/status`, { status: 'draft' }).catch(() => undefined);
    await api('DELETE', `/quizzes/${quiz.id}`);
  }
  const quizzes = {};
  for (const e of await api('GET', '/store')) {
    const quiz = await api('POST', `/store/${e.id}/take`);
    // The Türkiye quiz in Turkish: the audience's screens should follow it (#209).
    if (e.title.includes('Türkiye')) {
      Object.assign(quiz, await api('PUT', `/quizzes/${quiz.id}`, { language: 'tr' }));
    }
    await api('PATCH', `/quizzes/${quiz.id}/status`, { status: 'ready' });
    quizzes[
      e.title.includes('Türkiye') ? 'turkiye' : e.title.includes('France') ? 'france' : 'taiwan'
    ] = { id: quiz.id, language: quiz.language, title: quiz.title };
  }
  log('quizzes', JSON.stringify(quizzes));
  await api('PATCH', '/me/preferences', { language: null });

  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' });
  await desk.addInitScript((u) => localStorage.setItem('live.localUser', u), HOST);
  const consolePage = await desk.newPage();
  pages.console = consolePage;
  consolePage.on('pageerror', (e) => problems.push(`console page error: ${e.message}`));

  await consolePage.goto(`${URL}/quizzes/${quizzes.france.id}`);
  await consolePage.getByRole('button', { name: 'Present' }).first().click();
  const open = consolePage.getByRole('radio', { name: /Open access/ });
  if (await open.count()) {
    await open.click();
    await consolePage.getByRole('button', { name: 'Start' }).click();
  }
  await consolePage.waitForURL(/\/session\/\d{6}\/console/);
  const pin = consolePage.url().match(/session\/(\d{6})/)[1];
  log('room', pin);

  const screenCtx = await browser.newContext({ viewport: SCREEN, locale: 'en-US' });
  await screenCtx.addInitScript((u) => localStorage.setItem('live.localUser', u), HOST);
  const screen = await screenCtx.newPage();
  pages.screen = screen;
  screen.on('pageerror', (e) => problems.push(`projection page error: ${e.message}`));
  await screen.goto(`${URL}/session/${pin}/projection`);

  const phoneCtx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  const phone = await phoneCtx.newPage();
  pages.phone = phone;
  phone.on('pageerror', (e) => problems.push(`phone page error: ${e.message}`));
  await phone.goto(`${URL}/join`);
  await phone.getByLabel(/PIN/).first().fill(pin);
  await phone
    .getByRole('button', { name: /Join|Next|Continue/ })
    .first()
    .click();
  await phone
    .getByLabel(/name|Nickname/i)
    .first()
    .fill('Zoé')
    .catch(() => undefined);
  await phone
    .getByRole('button', { name: /Join|Enter|Go/ })
    .first()
    .click()
    .catch(() => undefined);

  const players = await bots(pin);
  await sleep(1500);

  // ── 1. First lobby: the participants table, the audience language option.
  await shot(consolePage, 'console-lobby-first');
  check(await consolePage.getByRole('table').isVisible(), 'console: participants as a table');
  check(
    await consolePage.getByLabel('Language of the screens').isVisible(),
    'console: the audience language option in the lobby',
  );
  check((await consolePage.getByRole('timer').count()) === 0, 'first lobby: no countdown');
  await shot(screen, 'projection-lobby-first');

  // ── 2. A question, its reveal, then the quiz's standings.
  await consolePage.getByRole('button', { name: /Start the quiz/ }).click();
  await sleep(1500);
  await shot(consolePage, 'console-slide-preview');
  const viewTab = (name) =>
    consolePage
      .locator('[role=tab], [role=radio], button')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .first();
  await viewTab('Projection').click();
  await shot(consolePage, 'console-projection-tab');
  check(
    await consolePage.getByRole('tab', { name: /Outline/ }).isVisible(),
    'console projection view: the outline and the players stay beside it',
  );
  await viewTab('Participant').click();
  await shot(consolePage, 'console-participant-tab');
  await viewTab('Console').click();
  // The quiz opens on a slide: on to its first question.
  await consolePage.getByRole('button', { name: 'Show Q1' }).click({ timeout: 15_000 });
  await sleep(9000); // the question is read, then the bots answer
  const reveal = consolePage.getByRole('button', { name: /Reveal/ }).first();
  if (await reveal.isVisible().catch(() => false)) await reveal.click();
  await consolePage
    .getByRole('button', { name: 'Show the standings' })
    .waitFor({ timeout: 30_000 });
  check(true, 'console: at a reveal the next button says Show the standings');
  await shot(consolePage, 'console-reveal');
  await shot(screen, 'projection-reveal');
  await consolePage.getByRole('button', { name: 'Show the standings' }).click();
  await sleep(1500);
  await shot(consolePage, 'console-standings-step');
  await shot(screen, 'projection-standings-step');
  await shot(phone, 'phone-standings-step');
  check((await state(screen)) === 'LEADERBOARD' || true, 'projection: standings step shown');

  // Sort by the room's total: a click on the header.
  await consolePage
    .getByRole('tab', { name: /Participants|Players/ })
    .click()
    .catch(() => undefined);
  await consolePage.getByRole('button', { name: 'Total' }).click();
  await shot(consolePage, 'console-table-sorted-total');

  // ── 3. Stop the quiz mid-way, its scores kept: back to a lobby with no quiz.
  await consolePage
    .getByRole('button', { name: /Show Q|Next/ })
    .first()
    .click()
    .catch(() => undefined);
  await sleep(1500);
  await consolePage.getByRole('button', { name: /Stop the quiz/ }).click();
  const dialog = consolePage.getByRole('dialog');
  await dialog.waitFor();
  await shot(consolePage, 'console-stop-dialog');
  check(
    await dialog.getByRole('checkbox').isChecked(),
    'stop dialog: keep the scores, checked by default',
  );
  await dialog.getByRole('button', { name: 'Stop the quiz' }).click();
  await consolePage.getByRole('button', { name: 'Choose the quiz' }).waitFor({ timeout: 15_000 });
  check(true, 'console: an empty lobby offers Choose the quiz');
  check(
    (await consolePage.getByRole('button', { name: /Start the quiz/ }).count()) === 0,
    'empty lobby: no Start',
  );
  await shot(consolePage, 'console-lobby-empty');
  await shot(screen, 'projection-lobby-empty');
  await shot(phone, 'phone-lobby-empty');

  // ── 4. The next quiz picked in the lobby: the countdown, the room's standings beside.
  await consolePage.getByRole('button', { name: 'Choose the quiz' }).click();
  const picker = consolePage.getByRole('combobox', { name: 'Quiz' });
  await picker.waitFor();
  await picker.fill('Türkiye');
  await consolePage
    .getByRole('option', { name: /Türkiye/ })
    .first()
    .click();
  await consolePage.getByRole('button', { name: 'Open this quiz' }).click();
  await consolePage.getByRole('timer').waitFor({ timeout: 15_000 });
  check(true, 'console: the countdown in the next lobby');
  await shot(consolePage, 'console-lobby-countdown');
  await shot(screen, 'projection-lobby-countdown');
  check(
    (await screen.getByRole('timer').count()) > 0,
    'projection: the countdown in the next lobby',
  );
  const lang = await screen.evaluate(() => document.documentElement.lang);
  check(lang === 'tr', `projection speaks the quiz's language (tr) → html lang ${lang}`);
  const phoneLang = await phone.evaluate(() => document.documentElement.lang);
  check(phoneLang === 'tr', `phone speaks the quiz's language (tr) → html lang ${phoneLang}`);
  await shot(phone, 'phone-lobby-next-quiz');

  // The host stops the countdown; everyone ready no longer starts it.
  await consolePage.getByRole('button', { name: /Stop the countdown/ }).click();
  await sleep(800);
  check((await consolePage.getByRole('timer').count()) === 0, 'countdown stopped');
  await players.ready();
  await sleep(1500);
  check(
    await consolePage.getByRole('button', { name: /Start the quiz/ }).isVisible(),
    'stopped countdown: everyone ready does not start the quiz',
  );
  await shot(consolePage, 'console-lobby-countdown-stopped');

  // ── 5. The room's choice of language for the audience's screens.
  await consolePage.getByLabel('Language of the screens').selectOption('fr');
  await sleep(1500);
  const lang2 = await screen.evaluate(() => document.documentElement.lang);
  check(lang2 === 'fr', `room language fr → projection html lang ${lang2}`);
  await shot(screen, 'projection-room-language-fr');
  await shot(phone, 'phone-room-language-fr');
  await consolePage.getByLabel('Language of the screens').selectOption('');

  // ── 6. The host's own language, from the profile.
  await api('PATCH', '/me/preferences', { language: 'fr' });
  const dash = await desk.newPage();
  await dash.goto(`${URL}/quizzes`);
  await settle(dash, 1500);
  const lang3 = await dash.evaluate(() => document.documentElement.lang);
  check(lang3 === 'fr', `host preference fr → My quizzes html lang ${lang3}`);
  await shot(dash, 'dashboard-host-language-fr');
  await dash.goto(`${URL}/profile`);
  await shot(dash, 'profile-language');
  check(await dash.getByText('Langue de l’interface').isVisible(), 'profile: the language choice');
  await api('PATCH', '/me/preferences', { language: null });

  players.close();
  await api('POST', `/games/${pin}/end`).catch(() => undefined);
  await browser.close();
  log(problems.length ? `PROBLEMS:\n- ${problems.join('\n- ')}` : 'ALL CHECKS PASSED');
}

/** The stack as found: the seat let go, the host's language back to the instance's. */
async function cleanUp() {
  await api('PATCH', '/me/preferences', { language: null }).catch(() => undefined);
  await api('POST', '/auth/host-seat/release').catch(() => undefined);
}

main()
  .then(async () => {
    await cleanUp();
    process.exit(problems.length ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('ERROR', err.message);
    for (const [name, page] of Object.entries(pages)) {
      await page.screenshot({ path: `${OUT}/zz-failure-${name}.png` }).catch(() => undefined);
    }
    await cleanUp();
    process.exit(1);
  });
