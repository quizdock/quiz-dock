# QuizDock — Multi-quiz room (the room brief)

> The plan for the multi-quiz room ([#89](https://github.com/quizdock/quiz-dock/issues/89)): one room, a series of
> quizzes, players join once. The model, the decisions taken, how the live state splits between the room and each
> game, and the ordered pull requests that deliver it.

Status: **in progress.** Step 1 (the room layer and per-game keys) is delivered; nothing is visible yet.

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
  at any point. A playlist prepared beforehand is optional; when there is one, the picker proposes its next quiz first.
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

- **Ending a quiz** leads to the intermission (that quiz's podium, then the cumulative one), then back to the room
  lobby. Today's `host:end` splits in two: *end this quiz* (archive it, back to the room) and *close the room* (the PIN
  is freed, the phones are told).
- **Lifetime**: the room lives while it is used. Every game start, answer and host action refreshes its TTL, so an
  evening of quizzes outlives the current ~4 h. An idle room expires after the TTL; the host can close it explicitly.
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
2. **The next quiz in the room.** The host picks a quiz, the podium leads back to the room instead of ending, *end
   this quiz* / *close the room*, the TTL refresh, late joiners.
   - To settle here: today a player can join a quiz in progress (LIVE §5). Recommendation: keep it for the quiz
     running when they join, since the room never turns anyone away; "wait for the next quiz" then only applies to a
     player joining during the intermission.
   - To fix here: a player's rating is kept once per PIN and player (`quiz_feedback`), so rating the second quiz
     would overwrite the first. Its unique key must include the game or the quiz (a migration).
   - To settle here: whether the host can change a room setting between two quizzes. Recommendation: yes, in the room
     lobby only, never during a game.
   - To settle here: which settings belong to the room (automatic mode, audio target, full answer capture, open
     access, personal tracking) and which to each quiz (feedback, the quiz's own defaults). Recommendation: capture and
     tracking are the room's (the players were told once), the audio target and the mode default from the room and
     can be changed per quiz.
3. **Cumulative scores and stats.** Totals per player, the cumulative leaderboard, the series podium.
4. **Archives.** `roomId`, the room summary table and its migration, *History*.
5. **Screens.** The console's quiz picker, the room projection (room name, QR code, players, the next quiz once
   picked, the cumulative leaderboard), the phone's "waiting for the next quiz" with nickname and series rank, the
   intermission. The room lobby leaves room for #104 (the "Ready!" button and the projection link).
6. **Playlist** (optional): a list prepared beforehand, proposed first by the picker.

To settle along the way, each in the PR it touches: the number of quizzes per room, and what the picker does with a
quiz edited or deleted between two games (each game freezes its snapshot at start, so a game in progress is never
affected).

## 7. What comes after

- [#104](https://github.com/quizdock/quiz-dock/issues/104) — the shared projection and "Ready!", grafted on the room
  lobby.
- [#93](https://github.com/quizdock/quiz-dock/issues/93) — game sounds, as room settings.
