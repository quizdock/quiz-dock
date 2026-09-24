# QuizDock — Audio & video in questions (the media brief)

> The plan for a question's video and sound, phase by phase. What is **delivered** is described for operators in
> [docs/self-hosting/audio-video.md](../docs/self-hosting/audio-video.md); this document keeps the **decisions** and
> the **requirements of the phases still to come**, so they live with the code rather than in anyone's notes.

Working rules for every phase: one phase at a time, one commit per step, the acceptance criteria checked, every
string in the five locales, nothing assumed (read the code first).

---

## 1. The model

A question has two media slots: a **visual** (an image, or an MP4 video in H.264/AAC) and a **sound** (an MP3).
A video brings its own sound, so it excludes the sound slot.

| Phase | Subject | Status |
|---|---|---|
| 1 | Upload, playback in the room (projection) | **Delivered** — PR #44 |
| 2 | Recording a sound with the microphone | **Idea box** — set aside, its value is not settled (§3) |
| 3 | YouTube / Vimeo embeds | **Idea box** — set aside, it goes against the no-tracking, self-hosted promise (§4) |
| 4 | Remote players, preloading and readiness | **Built** on `feat/media-remote` (§5); two error messages in the idea box (§5.5) |
| 5 | Synchronisation and fairness | **Built** on `feat/media-sync` (§6) |

---

## 2. Phase 1 — the decisions it settled

- **Old audio**: the foreign keys are nulled and the rows deleted; the files stay on disk (purged by the hourly clean-up
  job since #50).
- **Orphans**: a media file no reference holds any more is deleted server-side after a 24 h grace period
  (duplicating a quiz shares its media ids); a running game and an archived session protect its media. An hourly
  job does it since #50.
- **Playback**: the media starts with `question:start` and follows the host's pause. Autoplay happens in the
  **projection window only**; phones show the image alone. Peer-to-peer delivery is ruled out (same Wi-Fi access point).
- **Length**: a question lasts at least as long as its media plus a tail (`media_tail_s`, 3 s by default).
- **Loudness**: measured (ITU-R BS.1770) in the browser at upload, corrected by a Web Audio gain at playback, capped by
  the peak — never re-encoded. Each quiz picks a level: loud −14 / balanced −16 (default) / quiet −23 LUFS.
- **Interruption**: playback resumes one second before the point reached; the console can restart the media.
- **Refused**: SVG images. **Bundle**: version 3 carries video and sound. The Quiz Store is out of scope.
- **Known gap**: not yet tested on Safari iOS.

---

## 3. Phase 2 — microphone recording (idea box)

Set aside on 2026-09-23: the need is not proven. Kept here so it can be picked up as it was specified.

- Offered only when `window.isSecureContext`; otherwise the button is hidden and a message says the microphone needs HTTPS.
- `getUserMedia` + `MediaRecorder` (WebM/Opus on Chromium), **60 s** at most.
- A **music mode** checkbox turns off `echoCancellation`, `noiseSuppression` and `autoGainControl` (on by default, for the voice).
- **Auto-trim** with Web Audio: the noise floor measured on the first 100 ms; a relative threshold on the RMS of short
  windows; the start moved back ~10 ms with a 3–5 ms fade-in; the end found the same way with a 30–50 ms fade-out;
  peak normalisation to −1 dBFS.
- A **preview** with start/end handles to adjust before accepting.
- **MP3 encoding in the browser** (a maintained JS library, licence to check), 192 kbit/s, the original sample rate and channels.
- The same processing is **offered** on an uploaded MP3; an uploaded MP3 left untouched is **never** re-encoded.
- Stored with `origin: 'recording'` (the `audioOrigin` column exists; loudness and peak measurement live in
  `apps/frontend/src/lib/audio-analysis.ts`).
- Errors: insecure context, permission refused, no microphone, maximum length reached.

---

## 4. Phase 3 — YouTube / Vimeo (idea box)

Set aside on 2026-09-23: it contacts Google or Vimeo from the projection, which goes against the promise of a
self-hosted quiz with no tracking, and uploading an MP4 already covers the need. Kept here as it was specified.

- `MEDIA_EMBEDS_ENABLED=false` by default. Document that turning it on **breaks the "no tracking" promise** and does
  not work on a closed network.
- YouTube IFrame API through `youtube-nocookie.com`; Vimeo Player SDK with `dnt=1`.
- Store only **provider / id / start / end**; the iframe is built by QuizDock, never third-party HTML; the id is
  extracted from the pasted URL; no oEmbed.
- A check when the embed is added in the editor: not found, private, embedding forbidden (YouTube's distinct error codes).
- **CSP**: there is none today → create it; allow the providers in `frame-src` / `script-src` only when embeds are
  enabled. Never COEP.
- Adapters with one interface: `load / play / pause / mute / unmute`, events `ready / started / ended / error`.
- Existing: the `EmbeddedVideo` type in the contracts; the API refuses with `media.embeds_disabled`.
- Errors: unrecognised URL, not found / private, embedding forbidden, embeds disabled, provider unreachable.

Points found while preparing it, to settle if it is picked up again:

- **Duration**: the server cannot know an embed's length without oEmbed; the editor's test load would measure it
  (`getDuration`) and store the clipped length, so the question stretches as for an uploaded video.
- **Switch turned off later**: today `resolveQuestionMedia` refuses any save holding an embed, which would block
  editing such a question; decide whether stored embeds are kept (and not played), stripped or refused, and the same
  for a bundle import.
- **Outside the projection** (console screen tab, phones): a static placeholder avoids any third-party request.
- **Adapters** also need `seek` / `currentTime` (resume one second early, restart); Vimeo has no end parameter, pause
  at `endSec` on `timeupdate`; `@vimeo/player` can be bundled from npm, so only YouTube's `iframe_api` needs `script-src`.
- **Limits**: the loudness levels cannot apply (a cross-origin iframe escapes Web Audio); unlisted Vimeo videos need
  their `h=` hash, not stored, so they would read as private; autoplay needs `allow="autoplay"` on the iframe.
- **CSP** (useful on its own): check Swagger UI's inline scripts, the OIDC issuer in `connect-src`, an external
  `APP_LOGO_URL` in `img-src`, `blob:`/`data:`, `ws:`/`wss:`, and test on a production build (Vite dev bypasses it).
- **Every writer of the visual slot** (`visualMediaId`: questions, quiz duplication, transfer, bundle) would need the
  embed columns. Bundle version 3 was not released yet at the time: extend it rather than bump.

---

## 5. Phase 4 — remote players and media readiness

Today every device is assumed to be in the room: the projection plays the video or the sound, the phones show the
prompt, the image and the answers, never a video nor a sound. A player following from home (a video call) cannot hear
a "name this tune" question. Phase 4 gives such a player the whole question, and makes sure no screen starts a media
it has not loaded — the waiting part of the former phase 5, brought forward on 2026-09-23.

### 5.1 Presence

- On joining, a player says whether they are **in the room** or **remote** (in the room by default). The choice is
  offered only when the quiz has a sound or a video; otherwise every player is in the room. The choice is
  kept across a reconnection and shown to the host (console roster).
- A remote player gets the full question view: the prompt, the visual (image or video) and the sound.

### 5.2 Who hears the sound

- An **audio target**: a quiz default plus an optional per-question override — *projection only* / *projection and
  remote players* (the default) / *everyone*. The host can override the quiz default from the lobby, before the start.
- Sound plays only on the targeted devices: the phones in the room stay silent unless the target is *everyone*
  (which echoes in a shared room — the editor says so). A non-targeted device shows the video muted, or the image.
- Resolution: the question's own target, else the host's lobby choice, else the quiz's; the screens receive it
  resolved in `question:start` and `media:preload`, the console reads the session's default in `game:media`.
- The sound is unlocked on the **Join** click: **one** audio element is created there and reused for the whole session
  (iOS only lets an element that was unlocked by a gesture play later). A video follows the same rule.
- A local **mute** button on the player's device.

### 5.3 Preloading

- The existing `media:preload` (sent with the reveal, to non-players only) is extended to the players that need the
  media — remote players, and room phones for the images — and to the **next step**, slide or question.
- **From the lobby**, every device fetches the media of the first step while people wait for the start.
- **Accepted risk** (decided 2026-09-23): a player's device holds the next step's media 10–20 s before it shows,
  without its prompt; a tech-savvy player could open them. The host is told so (console lobby, self-hosting guide).
- Mobile data is spared: at most **one step ahead**; the images and sounds are light, a video is fetched only by a
  device that will play it.

### 5.4 Readiness

- A device tells the server when the media of a step are loaded (`media:ready { stepIndex }`). Only the devices that
  play something count: the projection, and the remote players for a question with a sound or a video.
- **In the lobby**: a "ready" mark next to each participant on the host console; the projection shows a count
  ("18 / 20 ready"). The host sees who is late before starting.
- **During the game**: no waiting page by default, so the pace is kept. Only when a counted device is not ready as a
  step is due, a short **loading** screen appears: the projection shows the count and a progress bar, the console
  lists the late participants, the phones say the question is coming. It lasts at most a configurable cap
  (`GAME_MEDIA_WAIT_S`, 10 s by default); the host can **start anyway**.
- One slow device never holds the room: past the cap, or on "start anyway", the step starts; a late device receives
  it part-way through and plays from where it should be.
- Detail per participant stays on the console; the projection only shows a count (200 names would be unreadable, and
  a name in large letters would single someone out).

### 5.5 Errors

- A remote device refusing the sound (unlock lost, page reloaded): **done** — *Sound blocked* with a button, as on
  the projection.
- A media failing to load on a device: shown only once the question runs (`media.slow`); the wait treats it as not
  ready, so the cap applies. A dedicated message: **idea box** (set aside on 2026-09-24).
- The wait cap reached: the question simply starts; the console said who was late. A message after the fact:
  **idea box** (set aside on 2026-09-24).
- Also shipped with the phase: a waveform size per question (S / M / L) and a playhead that follows the projection
  on every screen that shows the sound without playing it.

---

## 6. Phase 5 — synchronisation and fairness

- **Common start** (built): `mediaStartAt`, `MEDIA_LEAD_MS` (600 ms) ahead, kept as a distance from the answers'
  opening so pauses move it; a late device seeks to it. Measured: projection and a phone whose clock is 5 s off
  start within 1 ms.
- **Play then time** (built): per question, `timerAfterMedia` — the answers open at the media's end; only with a
  known duration; no stretch. The host's *Restart the media* still replays it (accepted).
- **Clock alignment** (built): `ping`/`pong` bursts at each connection then every minute, shortest round trip
  wins; every countdown uses the server's time.

---

## 7. Errors already covered

The projection's "media not loaded in time" (`media.slow`).

---

## 8. After the brief — a media library (a separate project)

- The author's media library: reuse, where each file is used.
- **Jobs** that delete orphans (replacing today's opportunistic sweep, run at start-up and after saving).
- A content hash to share one file between several uses (deduplication).
- Purging the old audio files the migration left on disk.
