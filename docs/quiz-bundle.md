# Quiz bundle (import / export)

A quiz leaves and enters QuizDock as a **bundle**: a `quiz.json` manifest next
to a `media/` folder, zipped (`<slug>.quizdock.zip`). The same layout, unzipped,
is what a Quiz Store repository holds.

> **Videos and sounds (version 3).** A question's visual may be an MP4 video
> (H.264, AAC or no audio) and its audio slot an MP3. The formats of the audio
> suspended in [#42](https://github.com/quizdock/quiz-dock/issues/42) (ogg, wav,
> m4a) are still refused.

- **Export** — editor header → *Export*, `GET /api/v1/quizzes/:id/export`, or
  `qd quiz:export <id> <file.zip>` from the operator CLI
  ([self-hosting/cli.md](self-hosting/cli.md)). An export fixes the quiz's `slug`
  (derived from the title the first time) and leaves its `revision` alone — that
  counter moves when the quiz is *shared* to the template catalogue.
- **Export for publication** — editor header → *Export for publication*, for a
  community store (#21). It checks first what a store would refuse: the quiz
  must be *ready*, with a licence among CC0 / CC BY / CC BY-SA, a language, at
  least one tag, and a bundle within `PUBLICATION_MAX_MB` (20 MB by default,
  the heaviest media listed when it is over). Media without a credit are listed
  as a reminder, never a block: the contributor answers for the rights. The
  author confirms the `slug`, the name a store knows the quiz by in their
  repository; changing it later makes a new quiz for the store. The file is
  `<slug>.quizdock.zip`. `GET /api/v1/quizzes/:id/publication` returns the
  checks, `POST /api/v1/quizzes/:id/publication/export` (`{"slug"}`) the zip.
- **Import** — dashboard → *Import* (zip, or a bare `quiz.json` when there is
  no media), `POST /api/v1/quizzes/import` (multipart field `file`), or
  `qd quiz:import <file> <sub|email>`. The result is a **new draft** owned by
  the importer, with its own copies of the media. Nothing is merged or
  overwritten.

## `quiz.json`

```json
{
  "format": "quizdock/quiz",
  "version": 3,
  "quiz": {
    "slug": "capitals",
    "namespace": null,
    "revision": 3,
    "updatedAt": "2026-09-20T12:00:00.000Z",
    "title": "Capitals",
    "description": "Markdown, inline images allowed: ![map](media/map.png)",
    "language": "en",
    "domain": "geography",
    "tags": ["capitals", "europe"],
    "license": "CC-BY-4.0",
    "feedbackEnabled": true,
    "mediaTailS": 3,
    "loudnessTargetLufs": -16,
    "audioTarget": "projection_remote",
    "cover": "media/cover.jpg"
  },
  "media": {
    "media/cover.jpg": { "alt": "The port of Rotterdam at dusk" },
    "media/anthem.mp3": { "durationMs": 31000, "peaks": [0.12, 0.4, "… 200 values in 0–1"], "loudnessLufs": -17.2, "peakDbfs": -0.9 }
  },
  "items": [
    {
      "kind": "slide",
      "blocks": [
        { "type": "heading", "id": "h1", "text": "Welcome", "level": 1 },
        { "type": "image", "id": "i1", "media": "media/map.png", "size": "large", "align": "center" }
      ],
      "backgroundGradient": { "angle": 135, "colors": ["#1e3a8a", "#0f172a"] },
      "textTone": "light",
      "displayDelayS": 0
    },
    {
      "kind": "question",
      "type": "single_choice",
      "prompt": "Capital of France?",
      "media": "media/eiffel.jpg",
      "answerExplanation": "Paris has been the capital since 987.",
      "timeLimitS": 20,
      "pointsMode": "standard",
      "options": [
        { "text": "Paris", "color": "red", "shape": "triangle", "isCorrect": true },
        { "text": "Lyon", "color": "blue", "shape": "diamond" }
      ]
    },
    { "kind": "question", "type": "text_input", "prompt": "Capital of Italy?", "acceptedAnswers": ["Rome", "Roma"] },
    { "kind": "question", "type": "numeric", "prompt": "Departments in France?", "numericValue": 101, "numericTolerance": 0 },
    { "kind": "question", "type": "numeric", "prompt": "Height of the Eiffel Tower (m)?", "numericValue": 330, "numericTolerance": 5, "scoring": "closest", "pointsMode": "fixed" }
  ]
}
```

- `items` lists slides and questions **in sequence order**; a slide sits before
  the next question, or at the end.
- Media are referenced by relative path under `media/` (flat, no
  sub-folders), including inline Markdown images. Accepted types: png, jpg,
  gif, webp, avif, mp4, mp3 — checked by content like any upload, each within
  its kind's limit (`MEDIA_MAX_BYTES`, `MEDIA_MAX_VIDEO_MB`,
  `MEDIA_MAX_AUDIO_MB`), the whole zip within `IMPORT_MAX_BYTES` (raise it for
  quizzes carrying videos).
- `quiz.mediaTailS` (version 3, 0–30, default 3): the pause kept after a
  question's sound or video. A media longer than its question stretches the
  question to the end of the media plus this pause — nothing is cut mid-play.
- `quiz.loudnessTargetLufs` (version 3): the level sounds and videos are
  brought to at playback — `-14` loud (streaming), `-16` balanced (default),
  `-23` calm (broadcast). The files are never re-encoded.
- `quiz.audioTarget` (version 3): which devices play the sounds —
  `projection`, `projection_remote` (default: the projection and the remote
  participants) or `everyone` (room phones included). A question may carry its
  own `audioTarget`; omitted, it follows the quiz (or the host's choice for a
  session).
- A question's `media` is its visual (an image or an MP4), `audio` its sound
  (an MP3). Never both a video and a sound: the video carries its own.
- Questions and slides follow the API content rules (question types and their
  fields, block types, colour/shape names, limits). Defaults apply when a
  field is omitted: `timeLimitS` 20, `pointsMode` standard, `textTone` light,
  `displayDelayS` null (engine default; `0` = the host clicks).
- `scoring` picks a per-type rule (`standard` when omitted): numeric `closest`
  (answers ranked by distance, scored at the reveal), multiple_choice /
  ordering `partial` (credit per right element), text_input `lenient`
  (typos tolerated). `pointsMode` accepts `standard`, `double`, `none`, `fixed`
  (full points, no speed weighting).
- An invalid bundle is refused as a whole, with the offending item and field.

## Store fields

The `quiz` object carries what a Quiz Store catalogue will need, so bundles
exported today stay valid there. The licence and the tags are set in the quiz
settings (*Sharing*); `namespace` and `domain` are not editable yet and export
at `null`. An imported bundle keeps whatever it carried.

| Field | Type | Meaning |
|---|---|---|
| `version` (top level) | integer | Manifest schema version, currently `3`. Absent in the earliest bundles: read as `0`, same layout. A bundle from a newer schema is refused. |
| `media` (top level) | object | What each media file carries beyond its bytes, keyed by the same path the items reference: an `alt`, the description read aloud by screen readers (version 2); for a sound or a video, what the editor measured (version 3) — `durationMs`, `peaks` (200 values in 0–1, the waveform the screens draw), `origin` (`upload` or `recording`), `loudnessLufs` and `peakDbfs` (the playback gain). A sound needs `durationMs` and `peaks`. Absent in a version 1 bundle, and an image with no alternative text simply has no entry. |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 60 | The identity that travels — never an internal id. Derived from the title at first export or import when absent; the zip is named after it. |
| `namespace` | string or `null` | Reserved for a Store submission (`<username>/<slug>`); `null` on a local export. |
| `revision` | integer ≥ 0 | Publication counter of the quiz the bundle came from: **+1 every time it is shared** to a template catalogue. An import starts the copy back at 0 — it has never been shared itself. An integer, not semver. |
| `updatedAt` | ISO 8601 UTC | When the quiz was last saved (the export moment, since the export itself stamps it). Informative: ignored on import. |
| `language` | BCP 47 | A dedicated field, never a tag. Set in the quiz settings (*Sharing*); a bundle without one imports in the instance's language (`APP_LANG`). |
| `domain` | string or `null` | Free text until the Store closes the vocabulary. |
| `tags` | kebab-case strings, 5 at most | Lowercase, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 30 chars each. |
| `license` | SPDX identifier or `null` | The quiz settings offer `CC0-1.0`, `CC-BY-4.0` and `CC-BY-SA-4.0`, the three a community store accepts. An imported bundle may carry another identifier: it is kept. Required to share the quiz as a template. |

Every field is optional in the manifest: a bundle exported before they existed
imports with the defaults above. Nothing about the emitting instance travels —
no ids, no owner, no absolute URL; media paths are relative to the bundle root.
