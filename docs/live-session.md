# Live session

What a running session guarantees (`apps/backend/src/game/`).

## Snapshot, substance and form

A session is created from a **snapshot** of the quiz. The **substance** — the
questions, their order, type, prompt, media, options, right answers, scoring
and timing — stays as launched, so statistics remain consistent. The **form**
follows the editor at every step change: backgrounds, text contrast, answer
explanations, reveal delays, the quiz's feedback flag, and the slides in full
(blocks, backgrounds, timing, insertions, removals). A question deleted
meanwhile keeps its frozen version.

## States

`LOBBY → (SLIDE_SHOW | [MEDIA_LOADING →] ANSWERING → REVEAL)* → PODIUM → ENDED`,
plus `HOST_DISCONNECTED` (chrono frozen, 2 min to come back). `MEDIA_LOADING`
only happens before a question whose sound or video a device has not loaded
(see below). The host paces by
hand or in automatic mode (per-slide display time, per-question reveal delay,
engine defaults `GAME_AUTO_ADVANCE_MS` / `GAME_READ_DELAY_MS`), and can pause.

## Looking back

From a reveal, a slide or the podium, the host can show any **played step**
again (`host:review`): a question comes back with its archived reveal and each
participant's own result, a slide as it was. Nothing is replayed or rescored;
answers are refused; `host:next` (*Back to live*) returns every screen to the
live position. `game:state.nav` carries what is reachable.

## Restarts and reconnections

Timers live in the server process: at boot the engine re-arms them from Redis
(question deadlines, automatic pace). A socket that reconnects on its own
re-attaches (host, projection, participant) and catches up on the current
state — including the question when attaching at a reveal.

## Media on every device (experimental)

The media brief (`specifications/SPECIFICATIONS-MEDIA.md` §5) as built:

- **Presence** — a participant joins *in the room* or *remote*
  (`player:peek` tells the join form whether the quiz plays sound; `presence`
  on `player:join`, kept on the player record).
- **Audio target** — which devices play a question's sound: the question's own,
  else the host's lobby choice (`host:options.audioTarget`, stored on the
  session), else the quiz's. Resolved into `question:start` and
  `media:preload`; the screens get the session default in `game:media`.
- **Preload** — `media:preload` goes to every device with only what it will
  show or play (`preload.ts`): the first question from the lobby, then the next
  one with each reveal, plus the images of the slides before it. Phones load
  into the two elements the Join click started (iOS).
- **Readiness** — a device sends `media:ready` once what it fetched can play
  through; the server counts the projection windows and the participants whose
  device plays a sound or a video (`game:{id}:ready:{q}`), and tells the screens
  (`media:readiness`). The console's embedded tabs share the host socket and are
  not counted.
- **Wait** — `beginQuestion` enters `MEDIA_LOADING` when a counted device is not
  ready; it ends when all are, on `host:next`, or after `GAME_MEDIA_WAIT_S`
  (`media:wait` carries the deadline). One way out per question
  (`media-wait-lock`); re-armed after a restart; a host coming back starts the
  question.
- **Clock** — every client estimates its offset to the server's clock from
  `ping`/`pong` (shortest round trip wins, `clock.ts`); countdowns and media starts
  compare server times with `serverNow()`.
- **Common start** — `question:start` / `question:time` carry `mediaStartAt`, a
  moment ahead of the question's opening; the engine keeps it as a distance from
  `questionStartedAt` (`mediaLeadMs`), so pauses, a host coming back and restarts
  move it with the timer. Devices wait for it, or seek to it when late.
- **Listen first** — `timerAfterMedia` (frozen in the snapshot): `startedAt` is the
  media's end, the time limit is not stretched, answers before it are refused;
  `listenFirst` tells the screens to count the listening down.
- **Position** — the projection reports where it is in the media
  (`media:position`, about once a second and on play / pause / seek); the server
  relays it. Screens showing a sound without playing it move their playhead with
  it; a device starting late jumps there.

## Invitation address

The QR code and join link point at the base URL the host picked in the lobby
(`host:join-url`): the instance's public URL, a LAN address of the machine,
the page's own origin, or anything typed. It is stored on the session, sent to
every screen, frozen once the session starts, and remembered by the host's
browser. See the self-hosting guide for what each setup offers.
