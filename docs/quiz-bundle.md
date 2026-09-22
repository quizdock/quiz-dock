# Quiz bundle (import / export)

A quiz leaves and enters QuizDock as a **bundle**: a `quiz.json` manifest next
to a `media/` folder, zipped (`<slug>.quizdock.zip`). The same layout, unzipped,
is what a Quiz Store repository holds.

- **Export** — editor header → *Export*, `GET /api/v1/quizzes/:id/export`, or
  `qd quiz:export <id> <file.zip>` from the operator CLI
  ([self-hosting/cli.md](self-hosting/cli.md)). An export fixes the quiz's `slug`
  (derived from the title the first time) and leaves its `revision` alone — that
  counter moves when the quiz is *shared* to the template catalogue.
- **Import** — dashboard → *Import* (zip, or a bare `quiz.json` when there is
  no media), `POST /api/v1/quizzes/import` (multipart field `file`), or
  `qd quiz:import <file> <sub|email>`. The result is a **new draft** owned by
  the importer, with its own copies of the media. Nothing is merged or
  overwritten.

## `quiz.json`

```json
{
  "format": "quizdock/quiz",
  "version": 1,
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
    "cover": "media/cover.jpg"
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
  gif, webp, avif, mp3, ogg, wav, m4a — each within `MEDIA_MAX_BYTES`, the
  whole zip within `IMPORT_MAX_BYTES`.
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
exported today stay valid there. None of it is editable in the app yet: a quiz
built in the editor exports with `namespace`, `domain` and `license` at `null`
and `tags` empty; an imported bundle keeps whatever it carried.

| Field | Type | Meaning |
|---|---|---|
| `version` (top level) | integer | Manifest schema version, currently `1`. Absent in the earliest bundles: read as `0`, same layout. A bundle from a newer schema is refused. |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 60 | The identity that travels — never an internal id. Derived from the title at first export or import when absent; the zip is named after it. |
| `namespace` | string or `null` | Reserved for a Store submission (`<username>/<slug>`); `null` on a local export. |
| `revision` | integer ≥ 0 | Publication counter of the quiz the bundle came from: **+1 every time it is shared** to a template catalogue. An import starts the copy back at 0 — it has never been shared itself. An integer, not semver. |
| `updatedAt` | ISO 8601 UTC | When the quiz was last saved (the export moment, since the export itself stamps it). Informative: ignored on import. |
| `language` | BCP 47 | A dedicated field, never a tag. |
| `domain` | string or `null` | Free text until the Store closes the vocabulary. |
| `tags` | kebab-case strings, 5 at most | Lowercase, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 30 chars each. |
| `license` | SPDX identifier or `null` | e.g. `CC-BY-4.0`, `MIT`. |

Every field is optional in the manifest: a bundle exported before they existed
imports with the defaults above. Nothing about the emitting instance travels —
no ids, no owner, no absolute URL; media paths are relative to the bundle root.
