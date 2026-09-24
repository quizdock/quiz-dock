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
  as it is (an MP4 is only rewritten for fast start; an H.264/AAC QuickTime film is moved into an MP4 without
  re-encoding, which Firefox can do too). Mediabunny does this by itself.
- **The server does not check dimensions**: the legacy formats it keeps accepting are not capped either; the
  bounds are the editor's (#52).
- **Animated GIF**: the first frame only, with a notice to the author.
- **SVG**: still refused (phase 1 decision).
- **What goes in**: whatever the browser decodes, probed file by file (Mediabunny for audio/video,
  `createImageBitmap` for images). It differs between browsers (Safari reads HEIC, Chrome does not); the message
  on refusal says so.
- **Legacy files** (MP3, PNG, JPEG, GIF, AVIF already stored, or arriving in an imported bundle) stay valid and
  playable. No bulk conversion: it would need a browser, and nothing is broken.

---

## 3. The upload flow

1. The author drops or picks a file. Before any work, the editor checks the result will fit the instance's limit
   for its kind (`GET /api/v1/media/limits`): a sound or a video is given the bitrate that fits its duration,
   down to a floor below which it is refused (#52 — there is no separate input limit: the input is streamed).
2. The browser probes, converts (progress bar, cancel button, the tab must stay open), then measures on the
   **converted** file what it measures today: the waveform and the loudness (BS.1770, SPECIFICATIONS-MEDIA §2) —
   on the original when the browser can encode the result but not decode it (Firefox without the system's AAC).
3. It uploads the file — **always**, even when the server may hold the same content already: a "send the hash
   first" shortcut would hand a file to anyone who knows its hash. The bandwidth of a duplicate is the price.
4. The server **does not trust the client**: it sniffs the container and codecs, checks the kind, the size
   (`MEDIA_MAX_BYTES`) and the dimensions, and computes the SHA-256 itself.
5. It stores the file unless that content is there already (§4), creates the media row and returns it.

The limits (input size, video and audio duration) come from the backend configuration, like the other
instance settings.

---

## 4. Data model — file and media apart

`media_asset` used to be both the file and its **use** (`alt`, #43), so one file could not serve several uses.
Delivered in #51:

- **`media_blob`** — one row per content: `sha256` (primary key), mime, size, created at. The file is
  `MEDIA_DIR/<sha256>`. No owner: two authors uploading the same file share one blob, which nobody can observe
  (the upload is always sent and hashed server-side, §3).
- **`media_asset`** — the author's media: owner, `alt`, **credit** (§6, phase 4), link to the blob
  (`blob_sha256`). What quizzes, questions, slides and options reference, as today. It **keeps what the file
  is** — kind, mime, size, duration, waveform, loudness, sample peak: the bytes never change, so these copies
  cannot drift, and every reader (game snapshot, editor, export, playback gain) stays as it was.

Rules:

- Picking a file from the library creates a **new** asset on the same blob, `alt` and credit pre-filled: changing
  the alt text of one use never changes another. Duplicating a quiz keeps sharing its assets, as today.
- A blob is deleted when no asset holds it any more (§7).
- Migration: SQL cannot hash files, so the schema migration only adds `media_blob` and a nullable
  `blob_sha256`; the clean-up job (§7) then **adopts** each older file — hash, link under its blob name, point
  the media at it, remove the old name — in an order that survives an interruption. Until then a media is served
  from its old file. A media whose file is lost keeps a null blob. URLs (`/api/v1/media/:assetId`) do not change.
- Bundles keep their format (one file per media); import goes through the upload, so identical files are
  shared on arrival.

---

## 5. The media input module (authors)

One component for every media field — `MediaUpload`, which every field already used (question visual and sound,
background, slide image block; the quiz cover and the answer options have no editor field yet). Delivered in #53,
it offers:

- **Upload** — the flow of §3.
- **My images / My videos / My sounds** — a button per field, named after its kind (the visual slot has two), opening
  the author's library in a dialog: one entry per file (a reused media is listed once), thumbnail or waveform,
  duration, "used in N quizzes"; search on the file name (`media_asset.name`, kept from #53 on — older media show
  their date), the alt text and the credit; picking one reuses it (§4); an unused entry can be deleted — every
  media of the author on that file goes, and the server refuses (`409 media.in_use`) while any is used.
- **Find elsewhere** — outgoing links to free libraries (§6), opened in a new tab; the author downloads, then
  drops the file here.
- **Alt text and credit** of the chosen media.

The management of the whole instance is the admin page (§8).

---

## 6. External libraries and credits

Outgoing links only: nothing is fetched by the server (no SSRF surface, works offline). The list comes from the
backend (`GET /api/v1/media/links`, set by `MEDIA_LIBRARY_LINKS`: a JSON list, or `none`), with defaults:

- [OpenSoundLibrary](https://opensoundlibrary.com/) — sounds, CC0 / CC-BY / CC-BY-SA;
- [Openverse](https://openverse.org/) — images and sounds under Creative Commons;
- [Wikimedia Commons](https://commons.wikimedia.org/) — images, sounds, video;
- [Freesound](https://freesound.org/) — sounds (account needed to download).

CC-BY and CC-BY-SA require **crediting the author**, hence a free-text **credit** on the asset (author, licence,
source). The credits of every media a quiz uses (slots, options, slides, images typed in text) are listed on its
preview page and, frozen in the session snapshot, shown in small print under the podium: the audience sees the
attribution. Importing by URL or through these libraries' APIs is not in scope (idea box).

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
