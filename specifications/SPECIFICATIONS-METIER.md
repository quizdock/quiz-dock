# QuizDock — Business specification (functional)

> The **domain / functional** view of the application. It complements `SPECIFICATIONS.md` (technical).
> Context chosen: **a company, a session**. v1 mode: **classic, individual**. Quizzes are **private**.
> Version 1.0 — 2026-06-09.

---

## 1. Context & business goals

QuizDock is a tool for **real-time interactive quizzes**: a host runs a live session, the participants answer from their own device, and both speed and correctness are rewarded. The goal is to **liven the session up**, **measure what people learned** and **hand the host and the organisation results they can act on**.

### Business goals
- **Engage** the participants (gamification, leaderboard, pace).
- **Assess** knowledge formatively (before, during or after a session).
- **Record** attendance and performance (HR / session reporting).
- **Reuse** content easily (the host's quiz bank).

### Expected benefits
| Stakeholder | Benefit |
|-----------------|----------|
| Host | Runs the session, assesses live, spots what was not understood |
| Participant | Active learning, immediate feedback, friendly competition |
| Session manager | Proof of attendance, learning indicators, traceability |

---

## 2. Actors & personas

| Actor | Description | Auth |
|--------|-------------|------|
| **Host** (creator/host) | Designs the quizzes and runs the sessions. The main actor. | OIDC (role `host`) or local mode |
| **Guest participant** | Joins a session with a PIN and a nickname, with no account. | None |
| **Signed-in participant** | An identified participant (company SSO): their history is kept. | OIDC (role `player`) |
| **Session administrator** | (v1.1) Oversees the hosts, reads the aggregated reports. | OIDC (role `admin`) |

> The roles `host`/`player`/`admin` come from the roles in the OIDC token (a configurable claim, `realm_access.roles` by default for Keycloak compatibility).

### Personas
- **Claire, an internal host** — runs onboarding sessions for 20–40 people; wants to create quickly, project the screen, and get back who took part and what they scored.
- **Marc, an onboarding participant** — joins through a link or PIN on his phone, without creating an account; wants a smooth, playful experience.
- **Sophie, head of L&D** *(v1.1)* — wants learning indicators per session and per topic.

---

## 3. Domain glossary

| Term | Definition |
|-------|------------|
| **Quiz** | An ordered set of questions, owned by a host. |
| **Question** | A timed prompt with one or more answer types (see technique §4). |
| **Session (game)** | One live run of a quiz, identified by a PIN, run by a host. |
| **Participant / player** | Someone taking part in a session. |
| **Score** | A participant's points over a session (correctness + speed). |
| **Leaderboard** | The participants ordered by score, updated between questions. |
| **Report** | The end-of-session report (attendance, scores, answers per question). |
| **Quiz bank** | All of a host's private quizzes. |

---

## 4. Functional scope of v1

### Included
- Creating and editing private quizzes (the host's personal bank).
- Every question type (see technique §4) plus polls (no points).
- Running a live session in **individual mode**: lobby, the run itself, leaderboard, podium.
- Taking part as a **guest** (PIN + nickname) or **signed in** (SSO).
- Scoring on answer time plus streaks (see technique §5).
- An end-of-session report plus CSV export.
- History for a signed-in participant.
- **Full-capture mode** (optional, per session): every individual answer is kept for audit or
  certification, with a notice to the participants.

### Excluded from v1 (backlog)
- **Team** mode → v1.1.
- **Asynchronous / homework** mode → v1.2.
- **Sharing** quizzes between hosts, a public library → later (v1 is private only).
- An aggregated **administrator** dashboard → v1.1.
- AI question generation, importing external banks.
- An **avatar generator** (multiavatar): a deterministic avatar derived from the nickname, shown in the lobby, the leaderboard and the podium — cosmetic, client-side, with no effect on the live contract.

---

## 5. Lifecycle of the domain objects

### 5.1 Quiz
```
DRAFT ──(complete & valid)──▶ READY ──(played in a session)──▶ READY (reusable)
   │                             │
   └────────── ARCHIVED ◀────────┘   (the host archives it; it is not deleted, just out of the active lists)
```
- A **DRAFT** quiz cannot be launched (validation: ≥ 1 valid question).
- **Archiving** keeps the history of the sessions already played.
- **Deletion** is permanent and refused when reports must be kept (see §10, retention).

### 5.2 Session
```
SCHEDULED/IMMEDIATE → LOBBY → RUNNING → FINISHED → ARCHIVED
```
(the real-time states in detail: technique §8). A **FINISHED** session produces a frozen **report**.

---

## 6. User journeys

### 6.1 Host — creating a quiz
1. Signs in (or uses local mode).
2. "New quiz" → title, description, language, artwork.
3. Adds questions (type, prompt, media, options, **time limit**, **points**).
4. Reorders them, previews.
5. The quiz becomes **READY** once it is valid. It is saved in their private bank.

### 6.2 Host — running a session
1. Picks a **READY** quiz → "Start a session".
2. The system generates a **PIN**; the host projects the lobby screen.
3. The participants join (PIN + nickname, or SSO); their nicknames appear.
4. "Start" → question by question (prompt → answers → right answer → leaderboard).
5. After the last question → the **podium**.
6. Reads the **report**, exports it if needed, ends the session.

### 6.3 Participant — taking part
1. Enters the **PIN** and a **nickname** (or signs in through SSO).
2. Waits in the lobby.
3. On each question: reads the prompt, picks an answer **before the chrono runs out**.
4. Gets **immediate feedback** (right or wrong, points earned, rank).
5. Sees the final **podium** and their place on it.
6. *(signed in)* finds the session again in their **history**.

---

## 7. User stories (epics)

### Epic A — Designing a quiz
- As a **host**, I want to **create a quiz** with several questions so I can prepare my session.
- … **choose the question type** (multiple choice, true/false, text, numeric, ordering, poll) so the assessment fits.
- … **set the time limit and the points** per question so I can calibrate the difficulty.
- … **add an image or a sound** so a question is illustrated.
- … **reorder and preview** so I can check how it runs.
- … **duplicate a quiz** so a variant takes less time.
- … **archive** an obsolete quiz so my bank stays tidy.

### Epic B — Running a session
- As a **host**, I want to **start a session and get a PIN** so the participants can join.
- … **see who joined** (nicknames, count) so I know when to start.
- … **drive the pace** (start, reveal, next question, pause) so I can adapt to the group.
- … **throw a participant out** (an inappropriate nickname) so the session stays professional.
- … **see how many have answered, live**, so I know when to move on.
- … **end the session** and get the report.

### Epic C — Taking part
- As a **participant**, I want to **join with a PIN and no account** so there is no friction.
- … **answer quickly** so I score more points.
- … **see whether I was right and what I earned** so the feedback is immediate.
- … **see my place** so I know where I stand.
- … *(signed in)* **find my history** so I can follow my progress.

### Epic D — Reporting & follow-up
- As a **host**, I want a **session report** (attendance, scores, success per question) so I can spot what needs revisiting.
- … **export the results (CSV)** so they feed the session follow-up.
- *(v1.1)* As a **session manager**, I want **aggregated indicators** so I can measure how effective the sessions are.

---

## 8. Business rules

### 8.1 Quizzes & the bank
- A quiz belongs to **one host**; it is **private** (only they see it) in v1.
- A quiz must hold **≥ 1 valid question** to be **READY** and launchable.
- Bounds: `time limit` 5–120 s; **2 to 6 options** depending on the type; **≥ 1 right answer** (except polls).
- Duplicating creates an independent copy as a **DRAFT**.

### 8.2 Sessions
- A session hangs off **one quiz** and **one host**.
- A unique 6-digit **PIN**, used once, invalidated when the session ends.
- A session left in the **LOBBY** without starting expires (30 min) so the PIN is freed.
- Capacity: **10 to 200** participants per session.
- **Individual mode** only: one score per participant, no grouping.

### 8.3 Taking part
- A **nickname** must be unique within a session; it is filtered (length, a blocklist of terms).
- A participant answers **once** per question; no changing their mind.
- A **late answer scores nothing** (see technique §6).
- A participant who was **thrown out** cannot rejoin the same session under the same nickname.

### 8.3 bis Who may host — the roles

Three roles, three scopes:

| Role | Scope | How it is granted |
|---|---|---|
| `player` | The floor: reach the service and take part in sessions. | Every account has it. |
| `host` | Create, edit and present quizzes. | **Assigned** — by the operator (CLI) or by the identity provider (a claim). In local mode the host seat also grants it to the first comer, as a zero-configuration convenience. |
| `admin` | Everything, including administering the instance. | Assigned by the operator only. Not a role to hand out: it is the equivalent of root. |

The effective role is the highest of the two on every request: an operator grant
therefore survives an expired seat or claims that stop carrying the role, and never
blocks a promotion coming from the context. Revoking the grant (`player`) hands the
role back to the context.

### 8.3 ter Taking part under OIDC

Two independent barriers, and the second one is unchanged:

- **the token** grants access to the application (being authenticated, role `player`);
- **the PIN** grants access to one session, the one a host is running.

So under `AUTH_MODE=oidc` everyone authenticates, participants included: a valid account
opens no one else's session, and a PIN opens nothing without an account. Under
`AUTH_MODE=none` nothing changes — the PIN stays the only barrier, which is the point of
that mode.

The **display name** comes from the account (the `preferred_username` claim, or whichever
claim the deployment points at). The host may allow participants to **pick their own
display name** for the session; it changes what the podium and the leaderboard show,
nothing else — the results stay attached to the account. *(That per-session switch is
the one piece not implemented yet.)*

### 8.3 quater Tracing the answers (full-capture mode)
- By default, only the **aggregated data** per question is kept (success rate, distribution) — data minimisation.
- The host may turn on **full-capture mode** **when creating the session**: every individual answer (who, what, when, points) is then kept for audit or certification.
- When that mode is on, **the participants are told through a notice shown at the start of the session**, before anything is collected (transparency and consent).
- Retention follows the same deadline as the report *(RG-11)*.

**Personalised tracking** is a separate, per-session switch. On (the default under OIDC),
the results are attached to the account: the archived leaderboard, each participant's
sheet and their history. Off, **no individual result is recorded at all** — only the
per-question aggregates and the session summary. The live game is unaffected: the
leaderboard and the podium still run, they are simply not archived. Choosing a display
name changes none of this, and the notice shown to the participants must say which of the
three cases applies:

| Personalised tracking | Full capture | What the notice says |
|---|---|---|
| on | no | Your taking part and your score are recorded under your account. |
| on | yes | …and every one of your answers is kept. |
| off | — | Your individual results are not recorded — only the group's overall results are. |

### 8.4 Scoring (from the business side)
- Points = correctness **and** speed (the formula is in technique §5); a poll scores 0.
- A **streak** of right answers in a row earns a bonus, rewarding consistency.
- Ties are broken by cumulative answer time (see technique §5).
- The score is **not an academic grade**: it is a formative, playful indicator. *(The "success" threshold as a share of right answers is a reporting notion, see §9.)*

---

## 9. Assessment & reporting (central to a session)

### 9.1 The session report (generated at the end)
Available to the host, **frozen**:
- **Attendance**: how many participants, the list of nicknames (plus their identity when signed in).
- **Final leaderboard**: rank, nickname, score, number of right answers, mean time.
- **Per-question analysis**: share of right answers, answer distribution, mean time → points at **what was not understood**.
- The session's **overall success rate** (configurable: the mean share of right answers).
- **CSV export** (to feed the session follow-up or the HR system).

### 9.2 Participant history (signed in)
- A list of their sessions, score, rank, date.
- A simple view of progress over time.

### 9.3 Aggregated indicators *(v1.1)*
- Per host, per quiz, per topic: success rate, attendance, trend.
- Meant for the **session manager**.

---

## 10. Compliance & quality (business side)

- **Data protection**: guests' nicknames are not identifying; signed-in participants are personal data → they must be informed, with the right to access and to erasure (reports are anonymised when an account is deleted, see technique §13).
- **Retention**: session reports are kept for a configurable duration (24 months by default in a session context); deleting a quiz is refused when a retention rule requires it.
- **Full capture**: individual answers are only collected when the host turns it on; a **notice to the participants at the start of the session is mandatory** before anything is collected; the same retention as the report. Reserved for audit and certification needs (proportionality).
- **Content moderation**: nicknames are filtered and the host can throw someone out; the quiz content is the host's responsibility (it is private).
- **Accessibility**: colour **and** shape for the answers, contrast, keyboard (see technique §13) — it matters in an inclusive professional setting.
- **Language**: FR/EN from v1; the language is set on the quiz.

---

## 11. Success indicators (business KPIs)

| KPI | Indicative target |
|-----|------------------|
| Time to build a 10-question quiz | < 15 min |
| Share of participants joining a session once started | > 90 % |
| Session completion rate (still there at the podium) | > 85 % |
| Sessions whose report gets exported | tracked (reporting adoption) |
| Participant satisfaction (after the session, v1.1) | > 4/5 |

---

## 12. Business rules — summary (quick reference)

| # | Rule |
|---|-------|
| RG-01 | A quiz is private and belongs to a single host (v1). |
| RG-02 | A launchable quiz has ≥ 1 valid question (state READY). |
| RG-03 | Time limit per question ∈ [5, 120] s; 2–6 options; ≥ 1 right answer (polls aside). |
| RG-04 | A unique 6-digit PIN, used once, expiring (30 min in the lobby). |
| RG-05 | 10–200 participants per session; individual mode. |
| RG-06 | One nickname per session, filtered; one answer per question; no changing their mind. |
| RG-07 | A late answer scores 0; a poll scores 0. |
| RG-08 | Points = correctness + speed + streak bonus. |
| RG-09 | Ties are broken by cumulative answer time. |
| RG-10 | A finished session produces a frozen report plus a CSV export. |
| RG-11 | Reports are kept for a configurable duration (24 months by default). |
| RG-12 | A participant thrown out is not readmitted under the same nickname. |
| RG-13 | Full capture is optional, chosen when the session is created; a notice to the participants at the start of the session is mandatory before anything is collected. |
| RG-14 | `host` is an assignable role (operator or identity provider); `admin` is not handed out; `player` is the floor. The host seat grants `host` in local mode only, as a convenience. |
| RG-15 | Under `AUTH_MODE=oidc`, every participant is authenticated: the token opens the application, the PIN opens one session. |
| RG-16 | Personalised tracking is a per-session switch. Off, no individual result is recorded — aggregates only. A chosen display name is never anonymity, and the notice states which case applies. |

---

## 13. Prioritisation (MoSCoW) for v1

- **Must**: creating private quizzes, every question type, an individual live session (lobby→podium), joining as guest or through SSO, time-and-streak scoring, report plus CSV export.
- **Should**: history for signed-in participants, archiving quizzes, host pause and exclusion, colour-and-shape accessibility, FR/EN i18n.
- **Could**: duplicating quizzes, a configurable success rate, richer per-question statistics, **full-capture mode** (audit and certification).
- **Won't (v1)**: team mode, asynchronous mode, sharing and a public library, an aggregated admin dashboard, AI generation.
