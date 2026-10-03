# Quiz bundle (import / export)

A quiz leaves and enters QuizDock as a **bundle**: a `quiz.json` manifest next
to a `media/` folder, zipped (`<slug>.quizdock.zip`). The same layout, unzipped,
is what a Quiz Store repository holds.

**JSON Schema.** The manifest is published as a JSON Schema (draft 2020-12),
one file per manifest version, in [`schema/`](../schema/) — currently
[`quiz-bundle.v7.json`](../schema/quiz-bundle.v7.json). It is generated from the
importer's own schema and a test keeps the two in step, so a tool outside
QuizDock (a community store, a CI check) validates exactly what an import
accepts. A published version is never rewritten: a change to the format comes
with a new manifest version and a new file. The schema is structural, like the
first step of an import; the per-type rules of each question and slide are
checked afterwards.

**Format guide.** [`schema/quiz-format-guide.md`](../schema/quiz-format-guide.md)
is the same format in prose, text only, rules per type included: what someone —
or a chatbot — needs to write a `quiz.json` by hand
([import a quiz](https://quizdock.github.io/docs/host/import-a-quiz/)).
It is generated too, from the content schemas this time, and follows the
importer rather than a manifest version. A test fails when a field of the
format is neither described in it nor listed as left out.

Contributors changing the bundle schema or a content schema run
`pnpm generate:schema` and commit the result.

> **Videos and sounds (version 3).** A question's visual may be an MP4 video
> (H.264, AAC or no audio) and its audio slot an MP3 or an M4A (AAC, what the
> editor converts every sound to). Other audio formats (ogg, wav) are refused:
> the editor converts them before upload, an import does not.

- **Export** — editor header → *Export*, `GET /api/v1/quizzes/:id/export`, or
  `qd quiz:export <id> <file.zip>` from the operator CLI
  ([the CLI](https://quizdock.github.io/docs/operator/cli/)). An export fixes the quiz's `slug`
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
- **From another tool** — a Kahoot spreadsheet (`.xlsx`) imports as is, through the
  same *Import*. Anything else: a chatbot prompt writes the `quiz.json` from a PDF,
  screenshots or a spreadsheet
  ([import a quiz](https://quizdock.github.io/docs/host/import-a-quiz/)); an assistant
  connected through the MCP server checks and imports it itself (`validate_quiz`,
  `import_quiz`).
- **Check without importing** — `POST /api/v1/quizzes/validate` (`{"json": "<the
  quiz.json text>"}`) answers what an import would say of it, schema and per-type
  rules, without creating anything: the check behind the MCP server's
  `validate_quiz` and `qd quiz:validate`, for a tool that writes `quiz.json` files.

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
  gif, webp, avif, mp4, mp3, m4a — checked by content like any upload, each within
  its kind's limit (`MEDIA_MAX_BYTES`, `MEDIA_MAX_VIDEO_MB`,
  `MEDIA_MAX_AUDIO_MB`), the whole zip within `IMPORT_MAX_BYTES` (raise it for
  quizzes carrying videos). Nothing the archive declares is trusted: sizes are
  counted on the bytes actually unpacked, which may not exceed twice
  `IMPORT_MAX_BYTES` in total, over at most 2,000 entries.
- `quiz.mediaTailS` (version 3, 0–30, default 1): the pause kept after a
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
  (an MP3 or an M4A). Never both a video and a sound: the video carries its own.
- `waveformSize` (version 3): how thick its sound's waveform is drawn — `S`,
  `M` (default) or `L`; `hidden` (version 4): not drawn on the projection nor
  the phones, only on the host's console (the sound still plays).
- Slides with media (version 5), set like a question's: `video` (an MP4 filling
  the slide behind its content) with `videoLoop` and `videoSound` (both `true`
  when omitted), `audio` (a sound) with its `waveformSize` (`hidden` when
  omitted), and the slide's own `audioTarget`. A slide plays **one sound at
  most**: a video with its sound and an `audio` together are refused
  (`slide.two_sounds`).
- Image choice (version 6): a question of type `image_choice` has 2 or 4
  options, each a picture — `media` with its `alt`, in the quiz's language —
  and no `text`; `multiSelect: true` lets several be right. It has no `media`
  of its own (an `audio` is fine).
- `mediaPosition` (version 7): where a question's picture or video sits against
  its text on the projection — `bottom` (default, under the text), `top`,
  `left` or `right`. The answers stay below; the phones are unchanged.
- Questions and slides follow the API content rules (question types and their
  fields, block types, colour/shape names, limits). Defaults apply when a
  field is omitted: `timeLimitS` 20, `pointsMode` standard, `textTone` light,
  `displayDelayS` null (engine default; `0` = the host clicks).
- `scoring` picks a per-type rule (`standard` when omitted): numeric `closest`
  (answers ranked by distance, scored at the reveal), multiple_choice /
  ordering `partial` (credit per right element), text_input `lenient`
  (typos tolerated). `pointsMode` accepts `standard`, `double`, `none`, `fixed`
  (full points, no speed weighting).
- An invalid bundle is refused as a whole. An item whose content breaks its schema is
  named, with its field (`import.invalid_item`); a bundle whose structure is wrong is
  refused as one (`import.invalid_bundle`).
- An imported quiz is a **draft**: a step may still miss what it needs to be played
  (a question's right answer, target number, picture or alt text; a slide that shows
  nothing). The editor marks it *Unfinished*, and publishing the quiz waits until every
  step is complete.

## Store fields

The `quiz` object carries what a Quiz Store catalogue will need, so bundles
exported today stay valid there. The licence and the tags are set in the quiz
settings (*Sharing*); `namespace` and `domain` are not editable yet and export
at `null`. An imported bundle keeps whatever it carried, except its identity
(`slug`, `namespace`).

| Field | Type | Meaning |
|---|---|---|
| `version` (top level) | integer | Manifest schema version, up to `7`. An export stamps the **lowest version it needs** — `3`, `4` once a waveform is `hidden`, `5` once a slide carries a video or a sound, `6` once a question is an image choice, `7` once a question's picture or video sits above or beside its text (`mediaPosition`) — so an instance whose importer stops at an older version still takes a quiz that uses nothing newer. Absent in the earliest bundles: read as `0`, same layout. A bundle from a newer schema is refused. |
| `media` (top level) | object | What each media file carries beyond its bytes, keyed by the same path the items reference: an `alt`, the description read aloud by screen readers (version 2); for a sound or a video, what the editor measured (version 3) — `durationMs`, `peaks` (200 values in 0–1, the waveform the screens draw), `origin` (`upload` or `recording`), `loudnessLufs` and `peakDbfs` (the playback gain). A sound needs `durationMs` and `peaks`. Absent in a version 1 bundle, and an image with no alternative text simply has no entry. |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 60 | The identity that travels — never an internal id. Fixed by the owner's first export (derived from the title); the zip is named after it. Ignored on import: a copy carries nothing of its origin and gets its own slug at its first export. |
| `namespace` | string or `null` | Reserved for a Store submission (`<username>/<slug>`); `null` on a local export. Ignored on import. |
| `revision` | integer ≥ 0 | Publication counter of the quiz the bundle came from: **+1 every time it is shared** to a template catalogue. An import starts the copy back at 0 — it has never been shared itself. An integer, not semver. |
| `updatedAt` | ISO 8601 UTC | When the quiz was last saved (the export moment, since the export itself stamps it). Informative: ignored on import. |
| `language` | BCP 47 | A dedicated field, never a tag. Set in the quiz settings (*Sharing*); a bundle without one imports in the instance's language (`APP_LANG`). |
| `domain` | string or `null` | Free text until the Store closes the vocabulary. |
| `tags` | kebab-case strings, 5 at most | Lowercase, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 30 chars each. |
| `license` | SPDX identifier or `null` | The quiz settings offer `CC0-1.0`, `CC-BY-4.0` and `CC-BY-SA-4.0`, the three a community store accepts. An imported bundle may carry another identifier: it is kept. Required to share the quiz as a template. |

Every field is optional in the manifest: a bundle exported before they existed
imports with the defaults above. Nothing about the emitting instance travels —
no ids, no owner, no absolute URL; media paths are relative to the bundle root.
