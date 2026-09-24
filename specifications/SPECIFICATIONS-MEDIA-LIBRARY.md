# QuizDock — Media library & converter

> The project announced in [SPECIFICATIONS-MEDIA.md §8](./SPECIFICATIONS-MEDIA.md#8-after-the-brief--a-media-library-a-separate-project):
> one file format per kind of media, converted in the author's browser; files shared between their uses; a media
> input module common to every form; an administration page for the instance's media. This document keeps the
> **decisions** and the **requirements**; operators get their own page once it ships.

Working rules: one phase at a time, one commit per step, every string in the five locales, nothing assumed (read
the code first).

---

## 1. The frame

Media is not what QuizDock is about. The converter covers **what the author's browser can already read and
encode**, and nothing more: no ffmpeg on the server, no conversion queue, no new binary in the image. A file the
browser cannot handle is refused with a clear message, and the author turns to a dedicated tool. That limit is
chosen, not suffered.

What the frame buys: a backend that stays small (it validates, it does not transcode), no GPL binary next to
MIT code, no untrusted file handed to a decoder on the server, the self-hosted and air-gapped promises (#31) kept.

---

## 2. Target formats

One format per kind, chosen on what is **realistic to encode in a browser today** and **played everywhere**,
including the participants' older phones.

| Kind | Target | Settings | Encoded with | When the browser cannot encode it |
|---|---|---|---|---|
| Image | **WebP** | longest edge ≤ 1920 px, alpha kept, quality 0.8 | `OffscreenCanvas.convertToBlob` | `@jsquash/webp` (WASM, Apache-2.0), loaded only then — Safari |
| Video | **MP4, H.264 + AAC-LC** | ≤ 1080p, ≤ 30 fps, `yuv420p`, metadata at the start (fast start) | WebCodecs via Mediabunny | only an already compliant MP4 is accepted, copied without re-encoding |
| Audio | **M4A, AAC-LC** | 128 kb/s, stereo, 48 kHz | WebCodecs via Mediabunny | `@mediabunny/aac-encoder` (WASM, MPL-2.0), loaded only then — Firefox, desktop Linux |

Why these, and not the others considered:

- **WebP, not AVIF.** No browser encodes AVIF from a canvas; a WASM AVIF encoder is heavy and slow. WebP is read
  from iOS 14 on, where AVIF needs iOS 16.4 — and an image can *be* the question (#43): a participant who cannot
  display it cannot answer. The price, some 25 % more bytes than AVIF, is paid once per file.
- **H.264, not AV1 / HEVC / VP9.** The only video codec both encodable in Chrome and Safari and decoded
  everywhere. There is no realistic WASM fallback for video: a browser without an H.264 encoder (Firefox, today)
  only takes files that need no re-encoding.
- **AAC, not MP3 or Opus.** Native AAC encoders cover most browsers (all but Firefox and desktop Linux), where an
  MP3 encoder is never native. Opus encodes everywhere but plays unreliably in older Safari. AAC is also the sound
  track of the video, so one fallback serves both.

Special cases:

- **Nothing is re-encoded that need not be**: a file already in the target format and within the limits is kept
  as it is (an MP4 is only rewritten for fast start). Mediabunny does this by itself.
- **Animated GIF**: the first frame only, with a notice to the author.
- **SVG**: still refused (phase 1 decision).
- **What goes in**: whatever the browser decodes, probed file by file (Mediabunny for audio/video,
  `createImageBitmap` for images). It differs between browsers (Safari reads HEIC, Chrome does not); the message
  on refusal says so.
- **Legacy files** (MP3, PNG, JPEG, GIF, AVIF already stored, or arriving in an imported bundle) stay valid and
  playable. No bulk conversion: it would need a browser, and nothing is broken.

---

## 3. The upload flow

1. The author drops or picks a file. The module checks the input limits (size, duration) **before** any work.
2. The browser probes, converts (progress bar, cancel button, the tab must stay open), then measures on the
   **converted** file what it measures today: the waveform and the loudness (BS.1770, SPECIFICATIONS-MEDIA §2).
3. It computes the **SHA-256** of the converted file (SubtleCrypto has no MD5) and asks the server whether it
   already holds that content; if so, nothing is uploaded.
4. Otherwise it uploads. The server **does not trust the client**: it sniffs the container and codecs, checks the
   kind, the size (`MEDIA_MAX_BYTES`) and the dimensions, recomputes the hash, and refuses a mismatch.
5. The server creates the media row (§4) and returns it.

The limits (input size, video and audio duration) come from the backend configuration, like the other
instance settings.

---

## 4. Data model — file and media apart

Today `media_asset` mixes what belongs to the **file** (mime, size, duration, waveform, loudness) and what
belongs to its **use** (`alt`, #43). Sharing one file between several uses needs them apart.

- **`media_blob`** — one row per content: `sha256` (unique), path on disk, mime, size, width/height, duration,
  peaks, loudness, sample peak, created at. No owner: two authors uploading the same file share one blob, which
  nobody can observe (the hash is checked for the uploader's own request only — no "does this exist" oracle
  beyond "skip the upload").
- **`media_asset`** — the author's media: owner, `alt`, **credit** (§6), link to the blob. What quizzes,
  questions, slides and options reference, as today.

Rules:

- Picking a file from the library creates a **new** asset on the same blob, `alt` and credit pre-filled: changing
  the alt text of one use never changes another. Duplicating a quiz keeps sharing its assets, as today.
- A blob is deleted when no asset holds it any more (§7).
- Migration: one blob per existing asset, hashed from the file on disk; blobs with the same hash merged, files
  removed. Existing URLs (`/api/v1/media/:assetId`) keep working.
- Bundles export one file per blob; import hashes each file and reuses what exists.

---

## 5. The media input module (authors)

One component for every media field (question visual, sound, background, slide, answer option, quiz cover), in
place of today's `media-upload` and its variants. It offers:

- **Upload** — the flow of §3.
- **My media** — the author's library: thumbnail or waveform, kind, duration, size, "used in N quizzes", search
  by name; picking one reuses it (§4).
- **Find elsewhere** — outgoing links to free libraries (§6), opened in a new tab; the author downloads, then
  drops the file here.
- **Alt text and credit** of the chosen media.

A light "My media" view per author (list, usages, delete when unused) sits behind the same component; the
management of the whole instance is the admin page (§8).

---

## 6. External libraries and credits

Outgoing links only: nothing is fetched by the server (no SSRF surface, works offline). The list is part of the
instance configuration, with defaults:

- [OpenSoundLibrary](https://opensoundlibrary.com/) — sounds, CC0 / CC-BY / CC-BY-SA;
- [Openverse](https://openverse.org/) — images and sounds under Creative Commons;
- [Wikimedia Commons](https://commons.wikimedia.org/) — images, sounds, video;
- [Freesound](https://freesound.org/) — sounds (account needed to download).

CC-BY and CC-BY-SA require **crediting the author**, hence a free-text **credit** on the asset (author, licence,
source). Credits are shown on the quiz's preview page and can be put on a closing slide. Importing by URL or
through these libraries' APIs is not in scope (idea box).

---

## 7. Housekeeping

- **Orphans as a scheduled job**, hourly, instead of the sweep at start-up and after saving: an asset no quiz,
  question, slide or option references, older than the 24 h grace period, not held by a running session, is
  deleted; then every blob no asset holds. With several backend instances, one Redis lock per run.
- **Purge of the old audio files** the phase 1 migration left on disk: files under `MEDIA_DIR` no blob points to,
  older than the grace period. Same job.
- `DEMO_MODE` keeps its hourly reset, which wipes media with everything else.

---

## 8. The administration page

For the `admin` role only. It shows and acts on the instance's media:

- disk used, by kind and by owner; files in legacy formats;
- orphans waiting for the job and files on disk with no blob; "run now" for the job of §7;
- the largest files and the most shared ones, with their usages;
- deleting a media of any owner, with the usages it breaks listed first.

No conversion queue: conversion happens in the author's browser.

---

## 9. Phases

| # | Subject | Side |
|---|---|---|
| 1 | Scheduled orphan job, purge of the old audio files (§7) | backend |
| 2 | `media_blob` / `media_asset` split, SHA-256, migration, bundle import/export (§4) | backend |
| 3 | Browser converter (Mediabunny, WebP), server-side validation of the targets (§2, §3) | both |
| 4 | Media input module, My media, credits, external links (§5, §6) | frontend |
| 5 | Administration page (§8) | both |

---

## 10. Idea box

- Import by URL or through a library's API (needs an SSRF guard and breaks offline use).
- AVIF, once browsers encode it natively.
- Animated GIF converted into a looping silent video.
