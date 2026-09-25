# Refactoring `game.gateway.spec.ts`

The integration tests of the live game: a real Nest app, real Socket.IO clients, Postgres and Redis. They are the
most valuable tests of the backend, and the one file that will not scale as it is.

**Goal: the same coverage, faster and deterministic.** Every current assertion is kept. No change to production
code: only the existing test settings (`GAME_*` variables) and the test file itself.

## 1. Where it stands (measured 2026-09-26)

| | |
|---|---|
| Size | 1,890 lines, one file, 45 tests |
| Duration alone | **41 s** (most of the backend suite's 53 s) |
| Fixed sleeps | 37 `setTimeout` waits, including **two of 6 s** and one of 1.2 s |
| Slow tests | 7 over 1.5 s |
| Inline quiz seeds | 11 `prisma.quiz.create` blocks of ~20 lines each |
| Flaky | `auto mode: a per-question revealDelayS overrides…` failed twice under load, then passed on rerun |

Why it will get worse: every game feature adds tests to this file, each with its own waits. The multi-quiz lobby
(#89) and game sounds (#93) will land here.

## 2. The causes

1. **Sleeps instead of events.** A test waits a fixed time and then checks a state, instead of awaiting the event
   that proves it. Too short, it flakes under load; long enough, it wastes time on every run.
2. **Question timers of 5 s.** Two tests let a question run out (`timeLimitS: 5`, the minimum the API accepts) and
   sleep 6 s. The engine does not clamp the limit (`endsAt = startedAt + timeLimitS × 1000`): a quiz seeded
   directly in the database may use 1 s.
3. **An assertion on the client clock.** The flaky test measures, on the client, that the podium came at least
   1,000 ms after the answer. The server schedules the next step from its own instant, and Node timers may fire a
   millisecond early: the margin is zero.
4. **No shared helpers.** Every test builds its quiz, sockets and event promises by hand, so the file is long and
   each test repeats the same plumbing slightly differently.
5. **Leftovers.** Only the main quiz is deleted after the suite; the 11 other quizzes stay in the test database.

## 3. The changes

### 3.1 A harness (`src/game/testing/game-harness.ts`)

- `bootGameApp()`: sets the `GAME_*` test variables, starts the app on a free port, seeds the host and its seat,
  returns `{ app, prisma, url, close }` (the seat is given back on close, as today).
- `seedQuiz(overrides)`: one call instead of a 20-line block; defaults to the current one-question quiz; tracks the
  quiz so `close()` deletes it.
- `connectHost()`, `connectPlayer()`, `createGame(quizId)`, `join(pin, nickname)`.
- `nextEvent(socket, name, { where?, timeoutMs? })`: resolves on the first matching event, rejects with the event
  name on timeout, so a failure says what never came.
- `settle(ms = 150)`: the only allowed fixed wait, to prove that something did **not** happen (a second reveal).

### 3.2 Events instead of sleeps

- Each fixed sleep becomes `nextEvent(...)` on the event that proves the state.
- "Exactly once" checks: await the first event, then `settle()`, then count. The two 6 s waits become ~1.3 s.
- Question timers that must expire: `seedQuiz({ timeLimitS: 1 })`, directly in the database (the API's 5..120 bounds
  are bypassed on purpose; say so in a comment).

### 3.3 The flaky test

- Compare with the **server's** schedule: the `game:mode` event carries `autoNextAt`; the podium must not arrive
  before `autoNextAt - 20 ms`, and `autoNextMs` must still be 1,000.
- Check: 50 runs in a row without a failure, before and after the split.

### 3.4 One file per domain

| File | Tests (current names) |
|---|---|
| `game.lobby.spec.ts` | ping, create + join, duplicate nickname, join URL, attach outline, access and lobby lock (#57) |
| `game.question-loop.spec.ts` | start (allowlist), submit and single reveal, full loop to the podium, all-wrong early reveal, review, live form refresh |
| `game.timing.spec.ts` | adjust time, pause, auto mode, per-question reveal delay, slides |
| `game.media.spec.ts` | sound flag on attach, media restart, credits, file names, per-device sound, remote play, audio target, readiness, position relay, waiting for devices, synchronised start, listen first, media admin (#54) |
| `game.resilience.spec.ts` | late join, spectator, host attach, player reconnect, host disconnected, host window expiry, convergence on departures (×2), live-games index |
| `game.archive.spec.ts` | full capture archive, end-of-game rating |

**Constraint:** the files share one host seat (a single row) and Redis database 1. Run them **serially** (one Jest
worker for `src/game/*.spec.ts` that need services, e.g. a dedicated Jest project with `maxWorkers: 1`), or they
will take each other's seat. The time saved comes from removing sleeps, not from parallelism.

## 4. Acceptance

- [ ] Every assertion of the current file exists in the new files: a table maps each old test name to its new place
  (in the PR description).
- [ ] The game integration tests take **under 20 s** locally (41 s today).
- [ ] No fixed wait over 300 ms remains, except `settle()`.
- [ ] The formerly flaky test passes 50 times in a row.
- [ ] No quiz is left in the test database after the suite.
- [ ] No production file changes. CI green.

## 5. Order of work

1. **Harness + flaky fix**, in the current file: small, and it removes the instability at once.
2. **Events instead of sleeps, short timers**: the speed gain.
3. **Split by domain**, with the serial Jest project: readability, and room for #89 and #93.

Each step is its own PR, with the full suite green before the next.

## 6. Not doing

- **Jest fake timers across the sockets.** The server's timers, Redis and Socket.IO I/O run in real time; faking the
  clock on one side desynchronises it from the other and hides real ordering bugs. The engine's pure logic
  (scoring, reveal, snapshot) already has fast unit tests with no clock at all.
- **Mocking Redis or the database.** These tests exist to prove the real wiring.
