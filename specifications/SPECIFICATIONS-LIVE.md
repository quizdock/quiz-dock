# QuizDock — Specification of the live game

> A **detailed** framing of running a game in real time: the presenter's multi-window
> architecture, the player screens, attaching and reconnecting, and how each game
> state binds to a screen. It goes deeper without **duplicating**: the state machine
> (technique §8), the WebSocket contract (technique §9), reconnecting (technique §11),
> anti-cheat (technique §7), scoring (technique §5/§6), wireframes (UI §3–§5).
>
> Status: **specification** (the reference for the `P3-FRONT-2/3/4` implementation
> and for the backend additions listed in §10). None of these sections is coded yet
> unless stated otherwise.

---

## 1. Purpose & motivation

The backend foundation of the live loop exists (creating a game, the lobby, the state
machine, scoring, reveal/leaderboard/podium). What is missing is **the game screens**
and **three robust behaviours** that were explicitly asked for:

1. **A multi-window presenter**: a **projected screen** (big screen / projector) *and*
   a separate **control dashboard**, each openable on its own, **possibly on two
   different computers**.
2. **Joining a game in progress**: a player arriving late must be able to come in once
   the game has already started.
3. **Browser persistence**: a game started in a browser must be **findable again while
   it is still running** after the window is closed and reopened — for the presenter
   **as well as** for the players.

Two gaps found during review are also covered here:

- **The presenter leaves** → today the players see **no error at all** (there is no
  `handleDisconnect`; the `HOST_DISCONNECTED` state is never set). To be specified (§7).
- **The "everyone answered" count** is based on the total number of players who *ever*
  connected rather than on those **still connected** → the early convergence breaks as
  soon as a player disconnects. To be fixed (§8).

---

## 2. Actors, windows and socket roles

| Window | Who | Auth | Socket | Drives `host:*`? | Content |
|---|---|---|---|---|---|
| **Control** (dashboard) | the presenter | **required** (host) | host (attached to the game) | **yes** | answer counter, distribution, leaderboard, buttons (reveal / next / pause / end / throw out) |
| **Projection** (big screen) | the presenter (or a dedicated machine) | **no** | **spectator** (read-only in the room) | no | prompt, options (no right answer), chrono, counter, leaderboard, podium |
| **Player** | a participant | optional (guest or SSO) | player | no | a minimal prompt, the answer grid, personal feedback, rank |

> **One game, several windows.** The game is identified by its **PIN** on the Redis
> side (state, technique §8). Each window is a **separate socket** that attaches to the
> `pin` room according to its role. No window is the "master" of another: they all
> converge on the server state, which is the source of truth.

---

## 3. Real-time architecture — decision: a spectator socket (option B)

**A settled decision.** The projection is a **spectator socket** joining the `pin` room
**read-only**. It receives the room events already broadcast (`game:state`,
`question:start`, `question:reveal` with no `yourResult`, `leaderboard` with no `you`,
`game:podium`, `answer:count`) — with **no extra server-side computation**, since the
reveal and the leaderboard are already emitted **per socket** (a spectator naturally
receives the version without a personal result).

**Why not the `BroadcastChannel` relay (option A, dropped).** A meant opening the
projection as a slave window of the control window, fed by `BroadcastChannel`. Dropped
because:
- **it does not cross two machines** — and the requirement is explicitly "two different
  computers";
- the control tab goes to the background when the presenter looks at the projection →
  the relay gets **throttled** (the chrono and the counter freeze);
- the projection **cannot reload or recover** on its own (a slave with no socket);
- it would exercise a brand-new relay path instead of the **WS contract already proven**.

> The backend cost of B: **one `spectator:join {pin}` handler** (~10 lines) that calls
> `socket.join(pin)` without creating a player record. Spectators **pollute nothing**:
> absent from the `players` hash, they affect neither `answer:count` nor the "everyone
> answered" convergence (§8).

A spectator **never emits** a game event; any attempt is ignored (the `host:*` events
require the host identity, `player:submit` requires a `playerId`).

---

## 4. Opening the windows from the quiz detail

### 4.1 Launching and the links

From the **quiz detail** (the editor, a `ready` quiz) the presenter:

1. clicks **"Present"** → `host:create {quizId}` creates the game and returns the
   **PIN** (the current window becomes the **control** window, attached to the room);
2. the quiz detail then shows a **running game panel** exposing **three independent
   entry points**, each **copyable and openable** (including on another machine):

| Entry point | Route | Auth | Use |
|---|---|---|---|
| **Control** | `/present/$pin/control` | required (host) | the dashboard and the controls |
| **Projection** | `/present/$pin/screen` | no | the big screen to project |
| **Join** | `/join/$pin` (+ QR) | no | the link/QR handed to the players |

> The slugs are in **English** (in step with `/login`, `/dashboard`, `/present`,
> `/join`). The panel also shows the **PIN in plain text and a QR code** (see the
> sharing already shipped, P3-FRONT-1) and a **"Share"** button.
>
> **Current state (interim)**: a single `/present/:pin` route exists (the single-window
> host lobby, P3-FRONT-1). The **control / projection** split above is the **target**,
> to be implemented (P3-FRONT-2/3); the current `/present/:pin` will become
> `/present/$pin/control`.

### 4.2 Attaching across devices

- **Control on a second computer**: the window opens on `/present/$pin/control`,
  authenticates as the host, then emits **`host:attach {pin}`**; the server checks
  `meta.hostUserId === user.id` (the anti-impersonation rule, §7) and **rebinds** that
  socket to the room. The **host identity is the key**: no secret token needs to travel
  in the URL. *(In `none` mode the host re-identifies with the same local name → the
  same `sub`. In `oidc` mode, the same account. The limits of `none` mode are
  documented in technique §1.)*
- **Projection on a third computer**: open `/present/$pin/screen` →
  `spectator:join {pin}`. No auth; the PIN is enough (a public screen, never a right
  answer, §7).

> Several control windows and several projections can coexist (two rooms, say). They
> all converge on the server state, and the control buttons stay **idempotent** (the NX
> locks are already in place: reveal-lock, advance-lock).

---

## 5. Joining a game in progress (late join)

**Requirement: a player must be able to join a game that has already started.**

`player:join {pin, nickname}` is **allowed as long as the game is not over** (states
`LOBBY`, `QUESTION_SHOW`, `ANSWERING`, `REVEAL`, `LEADERBOARD`, `PODIUM`; refused in
`ENDED`). Joining at the `PODIUM` puts the player in the room only: they play from the
room's next quiz on (SPECIFICATIONS-ROOM §6). On joining, the server **sends the current state back** so the client catches
up right away:

- the player is created (score 0, the nickname claimed atomically — unchanged);
- a targeted **`game:state`** is emitted, plus (in `ANSWERING`) the ongoing
  `question:start` with the same `startedAt`/`endsAt`, so the chrono is right, or (in
  `REVEAL`/`LEADERBOARD`) the latest `leaderboard`.

**Scoring rules for a late join:**
- A latecomer **cannot answer** a question whose window is already closed (rejected as
  `too_late` / outside the window — the timing rule is unchanged, technique §6); they
  **watch** until the next question.
- If they arrive **during** `ANSWERING` with time left, they **can** answer (the same
  server timing). Nothing is retroactively caught up for the questions they missed:
  their score starts at 0 and only counts the questions they could answer.
- The **leaderboard** places them naturally (cumulative score); no special handling.

> A late join reuses `player:joined` (to the room) → the list in the control window and
> on the projection updates live.

---

## 6. Browser persistence & reconnecting

**Requirement: a running game must be findable again after the browser is closed and
reopened**, for the presenter **and** the player. The state lives in Redis (TTL ~4 h):
the game outlives the windows. So a new socket must be **re-attached** to the existing
game.

### 6.1 On the player side
- On joining, the client **persists** `{ pin, sessionToken, playerId, nickname }` in
  `localStorage` (the `live.session` key).
- On opening, if a local session exists **and** the game is still alive, the client
  emits **`player:reconnect {sessionToken}`** (already in the contract, §9) → the server
  restores their seat and score, sets `connected=true`, and sends the **current state**
  (as for a late join). Otherwise (the game is over or expired) the `localStorage` is
  cleaned and the *Join* screen comes back.
- A **banner** — "Resume the game in progress?" — can be offered while the local session
  is still valid.

### 6.2 On the presenter side
- An authenticated presenter **needs no token**: on reopening
  `/present/$pin/control` (or through "running games" on the dashboard) the client emits
  **`host:attach {pin}`**; **ownership** (`hostUserId`) reopens the room. The controls
  come back immediately.
- The **dashboard** lists the host's **running games** (a Redis key
  `host:{userId}:games` to be introduced) so a game can be found again even without
  having kept the URL or the PIN.
- The **projection** window reconnects on its own through `spectator:join {pin}` (the
  PIN is in the URL) — which is part of the appeal of option B (§3).

> **An accepted single-instance limit (v1).** The end-of-question **timers** live in
> process memory. A **backend restart** loses the current timer: resuming is handled by
> P4 (the Redis adapter plus re-arming the timers at boot from `questionEndsAt`). Out of
> scope for this spec; not to be confused with **client** reconnection, which is in scope.

---

## 7. The presenter disconnects (`HOST_DISCONNECTED`)

**Current gap: there is no `handleDisconnect` → the players are never told.** To be
implemented.

### 7.1 Detection (backend, new)
- The gateway implements `OnGatewayDisconnect`. When a socket disconnects:
  - if `socket.data.user` is the host of an active game (and **no other control window**
    of that game is connected — counting the host sockets in the room), then **after a
    short grace delay** (5 s, say, to absorb a plain reload): move the state to
    **`HOST_DISCONNECTED`**, **pause the timer** (freezing the remaining
    `questionEndsAt`), and broadcast `game:state`.
  - if `socket.data.playerId`: mark the player `connected=false` (§8).

### 7.2 Player and projection UX
- On receiving `game:state { state: HOST_DISCONNECTED }`, the players and the projection
  show **"The presenter disconnected — the game is paused"** (a non-blocking overlay;
  scores and places are kept). No answer is accepted.

### 7.3 Resuming
- If the host **comes back** within the **reconnect window** (technique §11, **120 s** by
  default) through `host:attach {pin}`, the game picks up where it stood: back to
  `ANSWERING` with a recomputed `questionEndsAt` (the frozen remaining time), or the
  current screen is kept (`REVEAL`/`LEADERBOARD`). A `game:state` is broadcast on resume.
- If the host **does not come back** within that window, the game **ends** and the
  results are persisted as they stand (technique §11); `game:ended` is broadcast.
  *(The ~4 h Redis TTL remains the absolute safety net for an orphaned game.)*

---

## 8. A player disconnects & counting the connected ones

- When a player socket disconnects: `connected=false` in the `players` hash (their seat
  and score are **kept** — they can come back through `player:reconnect`). Broadcast
  `player:left { playerId, playerCount }`, where `playerCount` counts the **connected**
  players.
- **A convergence fix (a bug).** "Everyone answered → early REVEAL" must compare the
  number of answers with the **number of connected players**, not with everyone who ever
  joined. Otherwise one departure hangs the question until the timer.
  → the condition becomes `answered ≥ count(players where connected)`.
- `answer:count` broadcasts `{ answered, total }` with `total` = the **connected** players,
  at most every 100 ms per room (`ANSWER_COUNT_EVERY_MS`): the answers within that window
  go out in one count at its end, the last one always, and a count still waiting goes out
  before the reveal.

---

## 9. State → screen matrix (per role)

Each `GameState` (technique §8) binds to a rendering and to the events that drive it.
The wireframes (UI §3–§5) give the *look*; this matrix gives the *binding*.

| State | Control (host) | Projection (spectator; a participant's copy follows it, #104) | Player | Triggering events |
|---|---|---|---|---|
| `LOBBY` | the player list + the session options (full capture, personalised tracking, chosen display name) + **Start**; in a room (#89) also **Change quiz** and the room's standings; one *Ready* count (#104) | PIN/QR + the player list (UI §4.1); in a room, the next quiz's title and the room's standings | "You are in the game" (UI §5.2); in a room, their rank in it, "Waiting for the next quiz", the last quiz still to rate, **Enable sound** when the next quiz has some; **Ready!** and *Share the projection* (#104) | `player:joined`/`left`, `room:standings`, `game:media` |
| `QUESTION_SHOW`* | question number + prompt | prompt + media, **answers hidden** | a minimal prompt, the grid **locked** | `question:start` (the reading window, `startedAt` in the future) |
| `ANSWERING` | the `x/total` counter, **Reveal**/**Pause** | prompt + options (no right answer) + chrono + counter (UI §4.2) | the grid is live, then "Answer recorded ✓" (UI §5.3) | `question:start`, `answer:count`, `answer:ack` |
| `REVEAL` | the right answer + distribution + leaderboard (UI §3.3) | the right answer + distribution | **personal** feedback: right or wrong, points, streak, rank (UI §5.4) | `question:reveal` (per socket), `leaderboard` |
| `LEADERBOARD`† | the leaderboard + **Next question** | the leaderboard | "your rank" | `leaderboard` |
| `PODIUM` | the podium, then the room's standings (from its second quiz) + **Next quiz** + the end | the podium (UI §5.5), then the room's standings | the podium + your rank (+ your rank in the room) + the rating of a quiz they played | `game:podium`, `room:standings` |
| `HOST_DISCONNECTED` | (the host is gone) | "The game is paused" | "The presenter disconnected — paused" | `game:state` (§7) |
| `ENDED` | back to the report | an ending screen; a room of several quizzes closes on its own podium | "Thank you!" | `game:ended`, `room:standings` |

> \* On the server side, `QUESTION_SHOW` is the **reading window** built into
> `question:start` (`startedAt` in the future). The client unlocks the grid at
> `startedAt`. *(Implemented: the server state goes straight to `ANSWERING` with
> `startedAt = now + delay`, as the current engine does.)*
> † In v1, `LEADERBOARD` is **merged into `REVEAL`** (the server emits `question:reveal`
> then `leaderboard` in the same step — a decision shipped in P3-BACK-7). The column
> stays for the screen mapping (the control window and the projection show the
> leaderboard after the reveal).

---

## 10. Extensions needed (to implement after this spec)

### 10.1 The WebSocket contract (technique §9 + the `@quiz-dock/contracts` package)
New events to add (typed end to end):

| Event | Direction | Payload | Effect |
|---|---|---|---|
| `host:attach` | C→S | `{ pin }` (ack `{ ok }`) | rebinds an authenticated owning host to their game (reconnect / control window) |
| `spectator:join` | C→S | `{ pin }` (ack `{ ok }`) | joins the room read-only (the projection window) |

Adjustments to existing events:
- `player:join`: allowed **outside the LOBBY** (except `ENDED`) plus the **current state**
  in return (§5).
- `player:reconnect`: the **current state** in return (§6.1) — already in the contract.
- `game:state`: add the `HOST_DISCONNECTED` usage (already in the enum).
- `answer:count` / `player:left`: `total`/`playerCount` count the **connected** players (§8).

### 10.2 Backend
- `OnGatewayDisconnect` (detecting host or player, the grace delay, pausing the timer) — §7.
- `spectator:join` / `host:attach` (ownership) — §3/§4.
- Late join: the state in return plus allowing it outside the LOBBY — §5.
- Convergence over the **connected** players plus the `connected` flag — §8.
- The Redis index `host:{userId}:games` (listing a host's running games) — §6.2.

### 10.3 Frontend (`P3-FRONT-2/3/4`)
- Routes: `/present/$pin/control`, `/present/$pin/screen`, the player screens per state.
- A client state-machine hook (subscribes to `game:state` and the events, renders per §9).
- Resuming: `localStorage live.session` (player); a "running games" panel (host).
- Avatars (cosmetic, §12) in the lobby, the leaderboard and the podium.

---

## 11. Standings during the game (#198)

The presenter always sees the standings; the audience sees them at set moments. Only
points already awarded count: showing the standings never reveals a question's answer.

### 11.1 The presenter's list

The console's participant list becomes the live standings: one row per player, in
**fixed columns** — rank, avatar and nickname, one slot per indicator (ready, media
loading, remote; always in the same place, empty when it does not apply), the score in
the quiz and the room's total (the quizzes played plus this one so far), right-aligned.
Ranked by the quiz once a score exists, in arrival order before; a click on a column's
header sorts by it, a second click reverses. The backend sends the host every player's
scores and ranks (`game:scores`) after each reveal and as the console (re)attaches.

### 11.2 The quiz's standings after each reveal

`LEADERBOARD` becomes a step of its own again (it is merged into `REVEAL` today, †):
reveal, then the current quiz's standings on the projection, then the next question.
The projection's screen for it exists (`screen-page`, the top ten).

### 11.3 The room's standings on the projection

The room's standings (#89, `room:standings`: the quizzes played so far) appear on the
projection at the podium, from the room's second quiz (as today), and **in the lobby of
the next quiz**, which every quiz of a room goes through (today only the consoles and the
players show them there). No button shows them on demand: the standings after each
reveal (§11.2) keep the competition going, and in a room's first quiz the room's
standings are the quiz's.

### 11.4 The next quiz's lobby

The lobby of a room's next quiz (not its first: players are still joining there) starts
on its own.

- **The way back**: a quiz ends at its podium, or the host stops it on the way with
  **Stop the quiz…** (« Arrêter le quiz… »), the only way to give one up. Either way the
  room goes back to its lobby **with no quiz chosen**, and the next quiz is picked **in
  the lobby** (`host:back-to-lobby`, then `host:next-quiz` there); the stop dialog asks
  whether to keep what was played (archived as interrupted, counted in the room's
  standings), the podium's whether to keep the results.
- **A 30 s countdown** runs once the lobby has its quiz; at zero, the quiz starts. Only a
  missing quiz holds it: *Ready!* never blocks (#104).
- **Everyone ready**: when every player in the lobby has pressed *Ready!* and the quiz is
  chosen, it starts at once, without waiting for zero.
- **The host** still has **Start** (at once), and can stop the countdown to take the
  floor; **Start** then launches it.
- **The projection**, in two columns: on the left the lobby (PIN/QR, the next quiz's
  title, the *Ready!* count, the countdown), on the right the room's standings (§11.3).

---

## 12. Out of scope for this spec / later

- **Resuming after a backend restart** (re-arming the timers, the Redis adapter) → **P4**.
- **Team mode**, asynchronous mode → the backlog (métier §13).
- An **avatar generator** (multiavatar): a **deterministic** avatar derived from the
  nickname or seed, shown in the lobby, the leaderboard and the podium. **Purely
  cosmetic, client-side → it alters neither the live contract nor the scoring.** On the
  backlog (roadmap §7, métier §13).
