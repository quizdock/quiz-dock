# QuizDock — Roadmap (milestones, tasks, phases)

> An incremental delivery plan, from **v0.1.0** to **v1.0.0**. Each milestone is a releasable, demonstrable version (`docker compose up`).
> It complements `SPECIFICATIONS.md §15` (the breakdown) and §18 (the Definition of Done). Version 1.0 — 2026-06-09.

---

## 1. Versioning

**Pre-1.0 SemVer** (`0.MINOR.PATCH`) — while we are in `0.x`, each **MINOR** is a functional milestone and the API may still move.

| Increment | When |
|-----------|-------|
| `0.x.0` (MINOR) | A new phase milestone is reached (see §3) |
| `0.x.y` (PATCH) | Fixes and adjustments, no new scope |
| `1.0.0` | **A conditional milestone** — see the eligibility criteria below |

> ⚠️ **v1.0.0 is not planned.** It is **not** a step of this roadmap. We know new features will emerge along the way: they land as further `0.x` releases (`0.8.0`, `0.9.0`, `0.10.0`, …), with no fixed destination. **v1.0.0 will only be considered the day a `0.x` version turns out to be stable and complete enough** — by eligibility, never by calendar or delivery pressure. The exact scope of that future v1 is deliberately left open here.

### Eligibility criteria (for the day v1.0.0 is considered)
The criteria below describe **what a version will have to satisfy** to *claim* `1.0.0` — they do not schedule that step. A `0.x` version would only be promoted to `1.0.0` if **all** of these hold:
1. ✅ **Completeness**: the whole "Must" scope of v1 is shipped and used in real conditions (métier §13).
2. ✅ **Stability**: no blocking or major defect open; the behaviour proven over several real sessions.
3. ✅ **Proven robustness**: the load and latency targets are met (technique §13); reconnecting and resuming are validated.
4. ✅ **Security**: a security review passed (JWT, anti-cheat, data protection) with no critical reservation.
5. ✅ **Quality**: the full regression suite green, coverage ≥ the thresholds, contracts frozen.
6. ✅ **Operability**: complete documentation and runbook, migrations and backup/purge exercised.
7. ✅ **Maturity of the scope**: the rate of new features has settled (no large project under way), and we are ready to **commit to the stability of the public API** (REST + the WS contract).

By default we **stay in `0.x`**: fixes as PATCH, features (planned or emergent) as MINOR. No deadline is set for `1.0.0`.

A git tag per milestone (`v0.1.0`, `v0.2.0`, …). The CHANGELOG is updated at every iteration (technique §18).

---

## 2. Overview of the milestones

| Version | Milestone | Goal | Depends on | Indicative effort* |
|---------|-------|----------|-----------|-------------------|
| **v0.1.0** | Foundations (a walking skeleton) | Monorepo, Docker Compose, CI, database schema, auth skeleton — an empty end-to-end that runs | — | M |
| **v0.2.0** | Builder + auth | Quiz/question CRUD (REST+OpenAPI+Orval), host OIDC auth, media upload, the builder UI | v0.1.0 | L |
| **v0.3.0** | The basic game | PIN lobby, single-choice questions, time scoring, the state machine, the leaderboard (Redis+WS), participant and projection clients | v0.2.0 | L |
| **v0.4.0** | Real-time robustness | Player and host reconnection, latency compensation, the multi-instance Redis adapter, load tests with 200 users | v0.3.0 | M |
| **v0.5.0** | Question types | Multiple answers, true/false, text input, numeric, ordering, polls | v0.3.0 | M |
| **v0.6.0** | Reporting | Podium, per-question statistics, the report plus CSV export, participant history, **full capture** | v0.5.0 | M |
| **v0.7.0** | Finishing touches | FR/EN i18n, accessibility, observability, moderation, UX polish | v0.6.0 | M |
| **v0.8.0** | Hardening & stabilisation | Security review, performance, the full regression suite, documentation and runbook | v0.7.0 | M |
| **v0.9.0 → 0.x** | *An open series* | **Emergent features** plus continuous stabilisation (not planned here) | v0.8.0 | — |
| ~~v1.0.0~~ | *(not planned)* | Considered **by eligibility** only (see §1), not by calendar | — | — |

\* Relative effort (S/M/L), **not** a duration in days (it depends on the size of the team). See §6.

---

## 3. Definition of Done for a milestone

A `v0.x.0` milestone is reached when **all** of its tasks are:
1. ✅ Implemented and reviewed.
2. ✅ Covered by green unit and functional tests (technique §17).
3. ✅ The full regression suite green in CI.
4. ✅ Documented (CHANGELOG + spec/API when something changed).
5. ✅ Demonstrable through `docker compose up`.
6. ✅ Tagged `v0.x.0`.

---

## 4. Tasks per phase

> ID convention: `P{phase}-{DOMAIN}-{n}`. Domains: `INFRA`, `BACK`, `FRONT`, `DATA`, `QA`, `DOC`.
> The spec reference is in parentheses.

### Phase 1 — v0.1.0 · Foundations
**Goal**: a skeleton that starts end to end, with no domain feature.

| ID | Task |
|----|-------|
| P1-INFRA-1 | A **pnpm** workspaces monorepo: `apps/backend`, `apps/frontend`, `packages/contracts` (technique §2) |
| P1-INFRA-2 | **Docker Compose**: front, back, postgres, redis, keycloak (a profile) plus healthchecks; media on a local volume (technique §16) |
| P1-INFRA-3 | `.env.example`, the `dev`/`test`/`keycloak` Compose profiles, Makefile/scripts |
| P1-INFRA-4 | **CI on GitHub Actions**: lint, typecheck, tests, image builds (technique §17.4) |
| P1-INFRA-5 | **Husky** git hooks (pre-commit/commit-msg/pre-push) plus commitlint (technique §18) |
| P1-BACK-1 | A **NestJS** skeleton: the `/health` healthcheck, config, a structured logger |
| P1-BACK-2 | **OpenAPI** integration (`@nestjs/swagger`) served on `/api/docs` |
| P1-BACK-3 | The **`AuthProvider`** abstraction (`NoAuthProvider`/`OidcProvider`) plus `AUTH_MODE` (technique §1) |
| P1-DATA-1 | The initial **Prisma schema** plus migrations (every table, **ULID**) (données §2) |
| P1-DATA-2 | The **Redis** connection plus the Socket.IO adapter wired up (technique §2) |
| P1-FRONT-1 | A **React+Vite** skeleton, **shadcn/ui**, **TanStack Router**, a home page |
| P1-FRONT-2 | The **Orval** pipeline plugged into the OpenAPI (generation plus a drift check) (technique §2.3) |
| P1-DOC-1 | An initial CHANGELOG, the README up to date |

**Exit criterion**: `docker compose up` brings the whole stack up; `/health` is OK; the front shows the home page; CI is green; the Orval client is generated.

---

### Phase 2 — v0.2.0 · Builder + auth
**Goal**: a host signs in and builds complete quizzes.

| ID | Task |
|----|-------|
| P2-BACK-1 | **OIDC** integration: JWT validation (JWKS), the `host`/`player` roles, **Keycloak as the reference IdP** (realm import) (technique §16) |
| P2-BACK-2 | **Quiz CRUD** over REST plus DTO/OpenAPI (technique §10, RG-01/02) |
| P2-BACK-3 | **Question CRUD** plus options and reordering (RG-03) |
| P2-BACK-4 | Handling the **question types** (validation per type) (technique §4) |
| P2-BACK-5 | **Media upload** → a local volume served by the backend (`media_asset`) (données §2.6) |
| P2-BACK-6 | The quiz lifecycle `draft→ready→archived` plus its validations (RG-02) |
| P2-FRONT-1 | **Signing in** (OIDC / local mode) |
| P2-FRONT-2 | The quiz-bank **dashboard** (TanStack Table/Query) (UI §2.1) |
| P2-FRONT-3 | The **quiz editor** (TanStack Form): prompt, options with colour and shape, time, points (UI §2.2) |
| P2-FRONT-4 | Question **preview** (UI §2.3) |
| P2-QA-1 | Tests: CRUD, auth (access refused, owner isolation), per-type validation (technique §17) |

**Exit criterion**: a host signs in, builds a multi-question quiz with media, and moves it to `ready`. The REST client is 100 % generated by Orval.

---

### Phase 3 — v0.3.0 · The basic game
**Goal**: play a live session end to end with a single question type.

| ID | Task |
|----|-------|
| P3-BACK-1 | The Socket.IO **WS gateway** `/game` plus the shared `@quiz-dock/contracts` (technique §9) |
| P3-BACK-2 | **Creating a session** plus generating a unique PIN (RG-04) (séquences §2) |
| P3-BACK-3 | **Joining** as a guest or signed in, the lobby, the `sessionToken` (séquences §2) |
| P3-BACK-4 | The **state machine** LOBBY→…→PODIUM (technique §8) |
| P3-BACK-5 | **Running a question**: `question:start` without the right answer (anti-cheat §7) |
| P3-BACK-6 | **Submission plus server timing** and locking (technique §6, RG-06) |
| P3-BACK-7 | **Scoring** on time and streak (technique §5) — *fully tested* |
| P3-BACK-8 | The Redis **leaderboard** (a ZSet) plus the `reveal`/`leaderboard` events |
| P3-FRONT-1 | The **participant mobile client**: join, wait, answer, feedback (UI §5) |
| P3-FRONT-2 | The **projected screen**: lobby plus question (UI §4) |
| P3-FRONT-3 | The **host console**: lobby, driving the game, answer counter, leaderboard (UI §3) |
| P3-FRONT-4 | A visual chrono derived from the **server timestamps** (UI §5.3) |
| P3-QA-1 | Golden tests for the scoring plus an end-to-end test of the full flow (1 host + N players) (technique §17.3) |

**Exit criterion**: a full demo — create, launch, 10+ players join, answer multiple-choice questions, and see scores, leaderboard and podium.

---

### Phase 4 — v0.4.0 · Real-time robustness
**Goal**: hold up under load and network trouble.

| ID | Task |
|----|-------|
| P4-BACK-1 | **Participant reconnection** (`player:reconnect`, seat and score) (séquences §4, technique §11) |
| P4-BACK-2 | **The host disconnects** → `HOST_DISCONNECTED` pause → resume or end (séquences §5) |
| P4-BACK-3 | **Latency compensation** (ping/pong, `latencyMs/2`) (technique §6) |
| P4-BACK-4 | The **multi-instance Redis adapter** validated (rooms in sync) (technique §2) |
| P4-BACK-5 | TTL and expiry for the games plus cleaning up `pin:index` |
| P4-QA-1 | **Load tests** with k6/Artillery: 200 players per game, a submission spike, the latency targets of §13 |
| P4-QA-2 | Integration tests for player and host reconnection |

**Exit criterion**: a game survives an instance restart; 200 players stay within the latency targets; reconnecting works.

---

### Phase 5 — v0.5.0 · Question types
**Goal**: cover every assessment format.

| ID | Task |
|----|-------|
| P5-BACK-1 | **True/false** (backend plus validation) |
| P5-BACK-2 | **Multiple-answer choice** (all or nothing, scoring) (technique §5) |
| P5-BACK-3 | **Text input**: normalisation plus `accepted_answer` (données §2.5, RG-06) |
| P5-BACK-4 | **Numeric**: a value plus a tolerance (données §2.3) |
| P5-BACK-5 | **Ordering**: the correct sequence (données §2.4) |
| P5-BACK-6 | **Polls** (0 points) |
| P5-FRONT-1 | Answer components per type (text field, slider, drag to order) (UI §5.3) |
| P5-FRONT-2 | The builder: type-specific editing (UI §2.2) |
| P5-QA-1 | Unit tests for scoring and validation per type, plus end to end |

**Exit criterion**: all 7 types playable end to end, with the builder, the gameplay and the scoring correct.

---

### Phase 6 — v0.6.0 · Reporting
**Goal**: report and record the results (central to a session).

| ID | Task |
|----|-------|
| P6-BACK-1 | **Consolidation** at the end of a session, Redis→PG (`game_session_log` plus the quiz snapshot) (séquences §6, données §2.7) |
| P6-BACK-2 | **`player_result_log`** plus the final leaderboard and tie-breaking (RG-08/09) |
| P6-BACK-3 | **`question_result_stat`** (rate, distribution, time) (données §2.9) |
| P6-BACK-4 | **CSV export** of the results (technique §10) |
| P6-BACK-5 | **History for a signed-in participant** (`/me/history`) |
| P6-BACK-6 | **Full-capture mode**: `full_capture`, `answer_log`, the `notice` event (données §2.10, RG-13) |
| P6-FRONT-1 | The **podium** (participant plus projection) (UI §5.5) |
| P6-FRONT-2 | The host **report**: a summary plus the per-question analysis (UI §6) |
| P6-FRONT-3 | The **full-capture notice** plus the checkbox at launch (UI §3.1, §5.2 bis) |
| P6-FRONT-4 | **Participant history** (UI §7) |
| P6-QA-1 | Tests for the consolidation, the export and full capture (the presence or absence of `answer_log`) |

**Exit criterion**: the end of a session yields a usable report plus a CSV export; full capture works, with its notice.

---

### Phase 7 — v0.7.0 · Finishing touches
**Goal**: product quality and operability.

| ID | Task |
|----|-------|
| P7-FRONT-1 | **i18n** FR/EN (the labels externalised) (technique §13) |
| P7-FRONT-2 | **Accessibility**: AA contrast, keyboard, touch target sizes, colour and shape checked |
| P7-BACK-1 | **Observability**: metrics (active games, sockets, latency), traces, logs |
| P7-BACK-2 | **Moderation**: a nickname filter, throwing someone out (`host:kick`) (RG-06/12) |
| P7-ALL-1 | UX polish, error and empty states, cross-cutting messages (UI §8) |
| P7-QA-1 | Accessibility and i18n tests |

**Exit criterion**: a bilingual, accessible, observable, moderatable application.

---

### Phase 8 — v0.8.0 · Hardening & stabilisation
**Goal**: make the base solid and operable (without aiming at a frozen "v1 release").

| ID | Task |
|----|-------|
| P8-QA-1 | A **security review** (JWT, CORS, rate limiting, anti-cheat, data protection) (technique §13) |
| P8-QA-2 | **The full regression suite** plus coverage ≥ the thresholds; frozen contract tests |
| P8-INFRA-1 | **Production** image builds (multi-stage), a production-like `docker-compose.yml`, secrets |
| P8-INFRA-2 | A **migration** strategy plus backup and purge (retention, RG-11) |
| P8-DOC-1 | Operational documentation: a runbook, the published OpenAPI, a host guide |
| P8-QA-3 | An overall acceptance pass across every journey (métier §6) |

**Exit criterion**: a hardened, audited, documented base, tagged **v0.8.0**.

---

### Beyond — v0.9.0 → 0.x · An open series
**Goal**: take in the **emergent features** (found along the way) and keep stabilising, **with no planned release milestone**.

- Each new feature is a `0.x` MINOR with its own tasks, tests and documentation (the same DoD, §3).
- The known backlog (§7) and whatever needs turn up feed those versions as they come.
- **v1.0.0 stays out of the plan**: it will only be considered if and when a `0.x` version satisfies **every** eligibility criterion (§1).

---

## 5. Dependencies & critical path

```
v0.1.0 ─▶ v0.2.0 ─▶ v0.3.0 ─┬─▶ v0.4.0 ─┐
                             │           ├─▶ v0.6.0 ─▶ v0.7.0 ─▶ v0.8.0 ─▶ 0.9.0 → 0.x …
                             └─▶ v0.5.0 ─┘                                  (an open series)

                                   (v1.0.0: out of plan, by eligibility only — §1)
```

- **The critical path**: Foundations → Builder → The basic game (everything depends on it).
- **Parallelisable** after v0.3.0: Robustness (v0.4.0) and Question types (v0.5.0) can advance side by side if the team allows; v0.6.0 waits for both.
- **An open series** after v0.8.0: the `0.x` releases follow one another as features emerge; there is no fixed arrival point.
- **Cross-cutting** (present in every phase, not a separate milestone): tests, documentation, basic accessibility.

---

## 6. Scheduling in calendar time

The effort is given relatively (S/M/L) **because the dates depend on the team's capacity**. To turn this into a dated plan, settle:
- the size and composition of the team (back/front/devops);
- the capacity per sprint (two-week sprints, say);
- public holidays and time off.

> A reference assumption (to be confirmed): one MINOR milestone ≈ 1 to 3 sprints depending on S/M/L, with a team of 2–3 developers. A **dated plan** (Gantt or sprints) can be produced as soon as those parameters are fixed.

---

## 7. Backlog of candidate features (recap)

It feeds the `0.x` releases to come (the "open series" section), following the priorities and whatever emerges — **without being tied to a release milestone**:

**Team** mode · **asynchronous / homework** mode · **sharing** and a public library · an aggregated **admin dashboard** · **AsyncAPI** for the WS · AI question generation · an **avatar generator** (multiavatar: a deterministic avatar derived from the nickname, shown in the lobby, the leaderboard and the podium — cosmetic and client-side, with no effect on the live contract) · **microphone recording** of a question's sound (in-browser capture over HTTPS, auto-trim of the silences, MP3 encoded client-side — set aside from the media brief, its phase 2, until its value is clearer). Details: métier §4 / §13.

> This list is not exhaustive: new features will appear during development and will join it.
