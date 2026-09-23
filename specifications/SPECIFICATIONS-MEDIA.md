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
| 3 | YouTube / Vimeo embeds | Planned (§4) |
| 4 | Remote players | Planned (§5) |
| 5 | Synchronisation and fairness | Planned (§6) |

---

## 2. Phase 1 — the decisions it settled

- **Old audio**: the foreign keys are nulled and the rows deleted; the files stay on disk (purged later, §8).
- **Orphans**: a media file no reference holds any more is deleted server-side after a 24 h grace period
  (duplicating a quiz shares its media ids); a running game protects its media.
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

## 4. Phase 3 — YouTube / Vimeo

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

---

## 5. Phase 4 — remote players

- A full player view: the prompt, the visual, the sound.
- On joining: **in the room** / **remote**.
- Audio target: a quiz default plus a per-question setting (everyone / projection only / projection + remote),
  overridable at launch. Sound plays only on the targeted devices (embeds through mute); in a hybrid game, phones in
  the room stay silent.
- Unlock on the **Join** click: **one** audio element created there and reused for the whole session (iOS).
- A local mute button.
- Preloading on remote devices (extend `media:preload`, today reserved to non-players).

---

## 6. Phase 5 — synchronisation and fairness

- Clients send `media:ready` (embeds: the `started` event). The server waits, with a configurable cap of a few seconds,
  then broadcasts a common start timestamp.
- A per-question **play then time** mode: the timer starts when the media ends.
- A player who is not ready still receives the question, part-way through.
- Client clock alignment (the server's ping/pong exists, clients do not use it yet).

---

## 7. Errors already covered

The projection's "media not loaded in time" (`media.slow`).

---

## 8. After the brief — a media library (a separate project)

- The author's media library: reuse, where each file is used.
- **Jobs** that delete orphans (replacing today's opportunistic sweep, run at start-up and after saving).
- A content hash to share one file between several uses (deduplication).
- Purging the old audio files the migration left on disk.
