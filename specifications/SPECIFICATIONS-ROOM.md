# QuizDock — Multi-quiz room (the room brief)

> The plan for the multi-quiz room ([#89](https://github.com/quizdock/quiz-dock/issues/89)): one room, a series of
> quizzes, players join once. The model, the decisions taken, how the live state splits between the room and each
> game, and the ordered pull requests that deliver it.

Status: **in progress.** Steps 1 to 3 are delivered on the server; the screens come with step 5.

---

## 1. The model

- **Every session is a room.** "Start a quiz" creates a room and starts its first quiz in it. There is a single code
  path: a room that only ever runs one quiz behaves exactly like today's game, with the same screens, archive and
  flow.
- **The room** holds the PIN, the QR code, the players (nicknames, avatars, reconnection tokens, bans), the room
  settings and the cumulative scores and stats.
- **A game** is one quiz played in the room. Each keeps what a game has today: its own frozen snapshot, its state
  machine, its per-quiz leaderboard and its archive. The game engine changes little.
- Games run **one after another**, never two at once in the same room.

## 2. Decisions taken

- **Always a room** (§1), not an option next to a "simple game".
- **Picking quizzes on the fly**: the host console has a quiz picker (their `ready` quizzes) to choose the next quiz
  at any point. A list prepared beforehand is not part of the room: it belongs to the *Programme* (§7).
- **Moving on is the host's call**: after a quiz, the room shows the results, and the host starts the next one when
  ready.
- **Cumulative scores and stats** across the series, next to each quiz's own: total score, rank, correct answers,
  average answer time, streaks. The final podium is the series'.
- **A player who leaves stays ranked.** Their points stay in the cumulative ranking (shown as disconnected); coming
  back with their token, they take their place again.
- **Late joiners** wait in the room and play from the next quiz on (see §6, PR 2, for how this meets today's late join
  into a running quiz).
- **One archive per quiz**, as today, linked to their room.

## 3. The live state: room or game

Today every Redis key hangs off the PIN, because a PIN is one game. With several games under one PIN, a game's
keys must not outlive it: `reveal-lock`, `advance-lock` and `media-wait-lock` are set once per `(pin, index)` for the
whole TTL, so a second quiz on the same PIN would find question 0 already locked and silently never reveal it.

The split, keyed by the PIN for the room and by the game id (`meta.id`, already random) for a game:

| Level | Keys |
|-------|------|
| **Room** (PIN) | PIN allocation, room hash (host, current game, what the players were told), players, nicknames, bans, session tokens, the host's open rooms, cumulative totals and ranking |
| **Game** (game id) | game hash (state machine, current index, timings, mode, pause), snapshot, scores, answers, media readiness, reveal / advance / media-wait locks |

- The session token stays `{ pin, playerId }`: it already belongs to the room.
- A player record keeps who they are (nickname, avatar, account, presence, connection). The score and streak of the
  quiz being played live with the game (`game:{id}:scores`, whose keys are who plays it); the totals live with the
  room.
- Whatever runs after a wait or on a timer carries the game it was started for, and does nothing once the room plays
  another: a step of one game never writes into the next.
- The key-by-key layout is in [SPECIFICATIONS-DONNEES.md §4](./SPECIFICATIONS-DONNEES.md).
- Keys are renamed in one go. A game running on the old keys while the server is upgraded is lost: upgrade between
  games (to say in the release notes).

## 4. Lifecycle

- **Ending a quiz** leads to its podium; from there the host opens the next quiz (`host:next-quiz`), whose lobby is
  the room's, or closes the room (`host:end`: the PIN is freed, the phones are told). The intermission screens (that
  quiz's podium, then the cumulative one) come with steps 3 and 5.
- **Lifetime**: the room lives while it is used. Each question and each quiz opened refresh its TTL, so an evening of
  quizzes outlives the current ~4 h. An idle room expires after the TTL; the host can close it explicitly.
- **Host disconnection** (§7.1 of LIVE) applies to the game in progress; in the room lobby, the room simply waits for
  the host within its TTL.

## 5. Archives and history

- `GameSessionLog` gains a nullable `roomId`. A small room summary table (host, PIN, started / ended, quizzes played,
  cumulative podium) links the per-quiz archives.
- *History* keeps listing per quiz. A room with more than one quiz also shows its summary; a room of one quiz reads as
  today.
- The room summary follows the session's personal tracking choice (RG-16): no per-participant totals when it is off.

## 6. Pull requests, in order

Each step keeps the single-quiz flow green. New game tests go in `apps/backend/test/game/<domain>.ts`; coverage does
not drop.

1. **The room layer and per-game keys.** No visible change: the room hash, the key split of §3, the player record
   without its per-quiz score, the engine reading its game through the room. Proves the split by running two games
   in a row in a test.
2. **The next quiz in the room.** `host:next-quiz { pin, quizId, archive? }` opens the next quiz in its lobby; the
   players stay in, at 0, and every screen is sent the new lobby (the consoles its outline). `host:end` closes the
   room. Settled:
   - **When**: from the lobby (the quiz picked is replaced, nothing was played) or from the podium (`archive` keeps
     the results of the quiz just played, as `host:end` does). Mid-quiz it is refused
     (`session.next_quiz_unavailable`): the host plays it to the end first. A double click opens one quiz.
   - **Late joiners**: a player joining while a quiz is played enters it, as a late join does today (LIVE §5). One
     joining at the podium is in the room, not in the quiz that is over, and plays from the next one. Joining and a
     quiz opening are each one atomic step, so nobody lands in neither.
   - **The host's choices carry over**: capture, tracking, the lock and the invitation address (the room's), the pace
     and the audio target (from the previous quiz). All stay changeable in the lobby of the next quiz, and the players
     see the notice again when it changes.
   - **Lifetime**: each question and each quiz opened refresh the TTL of the room, its players' session tokens
     (`room:{pin}:tokens`) and its current game; an idle room expires. The quiz left behind is marked ended, so it no
     longer counts as being played.
   - **Ratings**: one per player and per quiz of the room (`quiz_feedback` unique on PIN, player and quiz).
3. **Cumulative scores and stats.** Each game that started is recorded when it is over (its podium, `host:end`, the
   host gone for good): what each of its players did in it (`room:{pin}:played`). The standings are the sum, read when
   needed: total score, rank, correct and answered, average answer time, longest run in any one quiz, quizzes played.
   They go out as `room:standings` (top 10, each player's own line on their socket) at a podium, in the next lobby and
   when the room closes; the series podium is their top 3. Settled:
   - A quiz ended mid-way counts for what was played; one that never started (replaced or closed in its lobby) does
     not.
   - A quiz closed without archiving still counts: the standings are live, not kept. Keeping them is step 4, under
     RG-16.
   - Ranked: the room's players, those who left included, banned ones not; ties by total score, then arrival in the
     room. A player who joined at a podium is ranked on the quizzes they played.
4. **Archives.** `roomId`, the room summary table and its migration, *History*.
5. **Screens.** The console's quiz picker, the room projection (room name, QR code, players, the next quiz once
   picked, the cumulative leaderboard), the phone's "waiting for the next quiz" with nickname and series rank, the
   intermission. The room lobby leaves room for #104 (the "Ready!" button and the projection link).
   - To fix here: a player still rating the quiz just played when the host opens the next one is refused
     (`player:rate` accepts only a game at its podium or ended); accept the rating for the previous game, or have the
     console wait.
   - To fix here: the phones are never told whether the next quiz plays sound (`game:media` goes to the screens
     only); a remote player who came in on a silent quiz must be asked to enable sound when the next one has some.
   - To settle here: a player joining at the podium sees the rating panel of a quiz they did not play.

The playlist first planned as a step 6 is left to the *Programme* (§7), which prepares a series instead of
improvising it.

To settle along the way, each in the PR it touches: the number of quizzes per room, and what the picker does with a
quiz edited or deleted between two games (each game freezes its snapshot at start, so a game in progress is never
affected).

## 7. What comes after

- [#104](https://github.com/quizdock/quiz-dock/issues/104) — the shared projection and "Ready!", grafted on the room
  lobby.
- [#93](https://github.com/quizdock/quiz-dock/issues/93) — game sounds, as room settings.
- **Programme** (later, SPECIFICATIONS-ROADMAP §7): the room is the live, improvised series; a Programme prepares it.
  A named, saved, replayable list of quizzes with its settings; each run of it a durable record with its results
  (a table then makes sense, unlike §5), archiving decided once for the run, runs compared with one another.
