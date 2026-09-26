# QuizDock — Data dictionary

> **Column-level** detail of the persistent data (PostgreSQL) and of the real-time structures (Redis).
> It complements `SPECIFICATIONS.md` §3 (the model) and `SPECIFICATIONS-METIER.md` §12 (the business rules).
> Version 1.0 — 2026-06-09.

---

## 0. Conventions

- **DBMS**: PostgreSQL 16. **ORM**: Prisma — the dictionary itself stays agnostic.
- **Primary keys**: **ULID** (`char(26)`, Crockford base32), generated in the application (the `ulidx` library). Chosen over UUID because they are **chronologically sortable** (insertion order ≈ time order → better indexes, cursor pagination comes naturally), compact, and need no coordination. No auto-increment is exposed.
- **Naming**: database columns and tables in `snake_case` (SQL convention); on the TypeScript side, types and fields in **camelCase** (TS convention), with the ORM mapping between them (Prisma `@map`). Table names are singular (`quiz`, `answer_option`).
- **Timestamps**: `timestamptz` (UTC). `created_at` / `updated_at` on every domain table.
- **Deletion**: a *soft delete* through `archived_at`/`deleted_at` wherever retention requires it (see RG-11); a hard delete elsewhere.
- **Money / score**: `integer` (whole points).
- **Enums**: Postgres `enum` types (see §3).
- **Column legend**: PK = primary key · FK = foreign key · NN = NOT NULL · UQ = unique · IDX = indexed · DEF = default.

---

## 1. Overview (relations)

```
user 1───* quiz 1───* question 1───* answer_option
                          │              
                          ├───* accepted_answer        (type = text_input)
                          │
quiz 1───* game_session_log 1───* player_result_log 1───* answer_log  (if full_capture)
                          │       1───* question_result_stat
user 0/1 ──────────────── player_result_log   (a signed-in participant, nullable)
media_asset *───0/1 quiz | question | answer_option   (cover / illustration)
media_asset *───0/1 media_blob                         (the stored file, shared by identical media)
```

The key cardinalities:
- A **quiz** belongs to **one** `user` (a host). *(RG-01)*
- A **question** belongs to **one** quiz; the order comes from `order_index`.
- An **answer_option** belongs to **one** question.
- A **game_session_log** references the quiz that was played and the host; it aggregates `player_result_log` (one per participant) and `question_result_stat` (one per question).

---

## 2. Tables (PostgreSQL)

### 2.1 `user` — accounts (hosts, signed-in participants, admins)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | The internal identifier |
| `oidc_subject` | text | UQ, NN | The `sub` claim of the OIDC token (the link to the IdP) |
| `display_name` | text | NN | The displayed name |
| `email` | citext | UQ, nullable | The email address, when the IdP provides one |
| `roles` | enum `user_role`[] | NN, DEF `{}` | The **set** of effective roles, recomputed on every request: the union of what was assigned and what the context derives (claims, host seat). Empty = participant; `{admin, host}` manages *and* hosts *(RG-14)* |
| `assigned_roles` | enum `user_role`[] | NN, DEF `{}` | What an operator granted (CLI). Sticky: provisioning never takes it away |
| `locale` | text | DEF `fr` | The preferred language (`fr`/`en`) |
| `preferences` | jsonb | NN, DEF `{}` | What the account remembers wherever it signs in: the choices that follow the person (the participant access a launch uses without asking, once the host asked to remember it), never the layout of one screen, which stays in the browser. Read key by key: an unknown or stale key falls back to its default. Shape: `UserPreferences` in the contracts |
| `created_at` | timestamptz | NN, DEF now() | Created |
| `updated_at` | timestamptz | NN | Last modified |
| `deleted_at` | timestamptz | nullable | Anonymised for data protection (see §6) |

> Under `AUTH_MODE=none` a "local" host may exist with no `oidc_subject` (in practice the column is then nullable; `oidc_subject` carries a sentinel value `local:<name>`). Guest participants are **NOT** `user` rows: they only exist in Redis and in `player_result_log`, without a `user_id`.

### 2.2 `quiz` — quizzes (a host's private bank)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `owner_id` | char(26) | FK→`user.id`, NN, IDX | The owner (a host) *(RG-01)* |
| `title` | text | NN | Title |
| `description` | text | nullable | Description |
| `cover_media_id` | char(26) | FK→`media_asset.id`, nullable | The cover artwork |
| `status` | enum `quiz_status` | NN, DEF `draft` | `draft` \| `ready` \| `archived` *(RG-02)* |
| `visibility` | enum `quiz_visibility` | NN, DEF `private` | Kept in the schema, **read by nothing and no longer exposed by the API**: sharing is the presence of an entry in the local catalogue, not a state of the quiz (#39), and publishing to a public store cannot be one either since an instance cannot verify a remote (#21). Its fate is settled there. |
| `language` | text | NN, DEF `fr` | The quiz's language |
| `question_count` | int | NN, DEF 0 | Denormalised (listing performance) |
| `publication_id` | char(26) | nullable | ULID of the **template** this quiz is shared as, minted the first time it is shared and never rewritten — withdrawing the entry and sharing again keeps the same template for everyone holding a copy *(RG-17)*. Null for a quiz never shared, and for an imported copy: a copy carries nothing of its origin. |
| `revision` | int | NN, DEF 0 | Publication counter: +1 every time the quiz is shared to the catalogue; an export leaves it alone, and an imported copy starts back at 0 |
| `slug` | text | nullable | Readable name, derived from the title at the first export. Display only — never an identifier, never a path |
| `namespace` | text | nullable | Display only, same rule as `slug` |
| `created_at` | timestamptz | NN, DEF now() | |
| `updated_at` | timestamptz | NN | |
| `archived_at` | timestamptz | nullable | Archived (soft) |

Index: `(owner_id, status)` for the dashboard.
Rule: moving to `status=ready` is refused when `question_count = 0` or a question is invalid *(RG-02)*.
Rule: only a `ready` quiz may be shared *(RG-17)*.

#### The catalogue of shared templates (on disk, not in the database)

Sharing writes a **copy** under `STORE_DIR` (a volume of its own, like the media
directory), in the bundle format of `docs/quiz-bundle.md`:

```
STORE_DIR/
  index.json                 the catalogue: one entry per template
  <publication_id>/          named by the ULID, never by the slug
    quiz.json                the manifest, carrying publication_id + revision
    media/                   the images, audio and video it refers to
```

The folder **is** the state of sharing: no table mirrors it, so restoring the
volume, copying it to another instance or removing an entry by hand needs no
reconciliation. An entry names the title, language, tags, question count,
author, licence and revision — enough to browse without opening a bundle.

The identifier is a ULID rather than a slug because a human string cannot be
arbitrated with no registry to ask, which an offline instance never has. The
same reasoning makes the catalogue readable and writable **with no network at
all**; a public store (a remote catalogue in the same format) is an extra
source, never a required one.

### 2.3 `question`

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `quiz_id` | char(26) | FK→`quiz.id` ON DELETE CASCADE, NN, IDX | The parent quiz |
| `order_index` | int | NN | Position (0-based); UQ `(quiz_id, order_index)` |
| `type` | enum `question_type` | NN | see §3 |
| `prompt` | text | NN | The prompt |
| `media_id` | char(26) | FK→`media_asset.id`, nullable | An illustration |
| `time_limit_s` | int | NN, DEF 20, CHECK 5–120 | The time limit *(RG-03)* |
| `points_mode` | enum `points_mode` | NN, DEF `standard` | `standard` \| `double` \| `none` (a poll) |
| `numeric_value` | numeric | nullable | The target (`numeric` questions) |
| `numeric_tolerance` | numeric | nullable, CHECK ≥ 0 | The ± tolerance (`numeric` questions) |
| `created_at` | timestamptz | NN, DEF now() | |
| `updated_at` | timestamptz | NN | |

CHECKs, in SQL or in the application, depending on the type:
- `single_choice`/`multiple_choice`/`true_false`/`ordering` → ≥ 2 `answer_option` (≤ 6) *(RG-03)*.
- `text_input` → ≥ 1 `accepted_answer`.
- `numeric` → `numeric_value` NN + `numeric_tolerance` NN.
- `poll` → `points_mode=none`, no right answer.

### 2.4 `answer_option` — options (choice, true/false, ordering)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `question_id` | char(26) | FK→`question.id` ON DELETE CASCADE, NN, IDX | |
| `order_index` | int | NN | Display position; UQ `(question_id, order_index)` |
| `text` | text | nullable | The label (nullable when the option is media only) |
| `media_id` | char(26) | FK→`media_asset.id`, nullable | The option's media |
| `color` | enum `option_color` | NN | `red`\|`blue`\|`yellow`\|`green` (+ more) |
| `shape` | enum `option_shape` | NN | `triangle`\|`diamond`\|`circle`\|`square` (accessibility) |
| `is_correct` | boolean | NN, DEF false | A right answer (choice, true/false). **Never exposed before the reveal** (technique §7) |
| `correct_order_index` | int | nullable | The expected rank (`ordering` questions) |

> For `ordering`, correctness is the sequence of `correct_order_index`; `is_correct` is unused.

### 2.5 `accepted_answer` — accepted answers (`text_input` questions)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `question_id` | char(26) | FK→`question.id` ON DELETE CASCADE, NN, IDX | |
| `text` | text | NN | The accepted form (as the author wrote it) |
| `normalized` | text | NN, IDX | The normalised form (lowercase, unaccented, extra spaces removed) for comparison *(RG-06)* |

### 2.6 `media_asset` — media

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `owner_id` | char(26) | FK→`user.id`, NN, IDX | The owner |
| `url` | text | NN | The backend route that serves it (`/api/v1/media/<id>`); the file lives on a local volume |
| `alt` | text | nullable | **Alternative text**, written by whoever attached the media and read aloud by screen readers. Carried by the media rather than by each use: typed once, valid everywhere the image serves, and it travels in a bundle (`media` section, format version 2). Null or empty is legitimate — for a decorative image it is the right answer, and a wrong description is worse than none. When it is missing, the live screens fall back to a generic label rather than an empty `alt`, which would hide an image that carries the question. |
| `credit` | text | nullable, ≤ 300 (app) | Who made it, under which licence, from where (#53) — a CC-BY licence asks for it. Listed on the quiz's preview page and under the podium |
| `name` | text | nullable, ≤ 200 (app) | The file name the author picked, with the extension of the stored format: what the library searches. Null for media uploaded before #53 |
| `source_sha256` | char(64) | nullable, IDX with `owner_id` | SHA-256 of the original file the author picked, before the browser converted it: an original uploaded again is reused rather than converted anew (a re-encoded video never gives the same bytes). Looked up among the author's own media and the global ones only |
| `width`, `height` | int | nullable | Displayed size of an image or a video, read from the bytes (rotation applied); 0 × 0 when the bytes do not say; null for a sound, or not read yet (filled in by the clean-up job) |
| `instance` | boolean | NN, DEF false | One of the **global media** (#62): provided by an administrator to every host, never swept by the clean-up, counted under "Global" rather than its administrator. Carries a credit but no alt text (it depends on the use and the quiz's language). Hosts reuse it as a media of their own on the same file; no quiz points at it |
| `mime` | text | NN | `image/png`, `audio/mpeg`, … |
| `size_bytes` | bigint | NN, CHECK ≤ the limit | Size |
| `kind` | enum `media_kind` | NN | `image` \| `audio` |
| `blob_sha256` | char(64) | FK→`media_blob.sha256` (RESTRICT), nullable, IDX | The stored file, shared by every media carrying the same bytes. Null until the clean-up job adopts a file uploaded before files were shared, or when the file is lost. The media keeps its own `mime`, `size_bytes` and measures: the bytes never change, so the copies cannot drift |
| `created_at` | timestamptz | NN, DEF now() | |

### 2.6 bis `media_blob` — a stored file

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `sha256` | char(64) | PK | SHA-256 of the bytes, computed by the server; the file is `MEDIA_DIR/<sha256>` |
| `mime` | text | NN | As found by the content check |
| `size_bytes` | bigint | NN | Size |
| `created_at` | timestamptz | NN, DEF now() | A blob no media holds is deleted, with its file, after the 24 h grace period |

### 2.7 `game_session_log` — a session that was played (the durable trace)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `quiz_id` | char(26) | FK→`quiz.id`, NN, IDX | The quiz that was played (a snapshot is advised, see the note) |
| `host_id` | char(26) | FK→`user.id`, NN, IDX | The host who ran it |
| `pin` | char(6) | NN | The PIN used (historical; not unique over time) |
| `room_id` | char(32) | nullable, IDX | The room it was played in (SPECIFICATIONS-ROOM): the archived sessions of one room are read together — its quizzes, and standings summed from their `player_result_log` (nothing stored twice). Null for sessions archived before rooms |
| `status` | enum `session_status` | NN, DEF `ended` | `ended` \| `archived` (the live `lobby`/`in_progress` states live in Redis) |
| `language` | text | NN | The session's language |
| `player_count` | int | NN, DEF 0 | How many participants played |
| `success_rate` | numeric | nullable | The mean success rate (%) |
| `personal_tracking` | boolean | NN, DEF true | **Personalised tracking**: when false, no `player_result_log` (and therefore no `answer_log`) is written for the session — only `question_result_stat` and this summary. Chosen when the session is created (and adjustable from the lobby, like full capture); the participants are told at the start (RG-16). |
| `full_capture` | boolean | NN, DEF false | **Full-capture mode**: when true, every individual answer is persisted (`answer_log`). Decided when the session is created; **the participants are told at the start of the session** (a displayed notice, see §6) |
| `started_at` | timestamptz | NN | When it actually started |
| `ended_at` | timestamptz | NN | When it ended |
| `retain_until` | timestamptz | NN | The retention deadline *(RG-11, DEF +24 months)* |
| `created_at` | timestamptz | NN, DEF now() | |

> **A snapshot is recommended**: so the report stays faithful even if the quiz is later modified or deleted, store a snapshot of the quiz and its questions (a JSONB `quiz_snapshot`) at the time of the session. Otherwise deleting a quiz would distort the history.

### 2.8 `player_result_log` — one participant's result on a session

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | The session |
| `user_id` | char(26) | FK→`user.id`, **nullable**, IDX | A signed-in participant; NULL for a guest |
| `nickname` | text | NN | The displayed nickname |
| `final_score` | int | NN, DEF 0 | The final score |
| `final_rank` | int | NN | The final rank (1 = best) |
| `correct_count` | int | NN, DEF 0 | How many right answers |
| `answered_count` | int | NN, DEF 0 | How many questions were answered |
| `avg_response_ms` | int | nullable | The mean answer time |
| `max_streak` | int | NN, DEF 0 | The longest streak |

Indexes: `(session_log_id, final_rank)`; `(user_id, session_log_id)` for the history.

### 2.9 `question_result_stat` — per-question aggregate (for the report)

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | |
| `question_id` | char(26) | FK→`question.id`, NN | The reference (or the index in the snapshot) |
| `order_index` | int | NN | Position within the session |
| `correct_count` | int | NN, DEF 0 | Right answers |
| `answer_count` | int | NN, DEF 0 | Answers received |
| `success_rate` | numeric | NN, DEF 0 | % right |
| `avg_response_ms` | int | nullable | Mean time |
| `distribution` | jsonb | NN, DEF '{}' | Distribution per option `{optionId: count}` |

> These rows are **computed at the end of the session** from the live Redis data, then persisted. By default the raw individual answers are not kept (only the aggregates) — data and volume minimisation. The individual detail is persisted **only when `full_capture = true`** (§2.10).

### 2.10 `answer_log` — an individual answer (full-capture mode)

> Filled **only when** `game_session_log.full_capture = true`. Otherwise the table stays empty for that session. It allows a past session to be replayed or audited in full.

| Column | Type | Constraints | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK (ULID, ordering) | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | The session |
| `player_result_log_id` | char(26) | FK→`player_result_log.id` ON DELETE CASCADE, NN, IDX | The participant (their result) |
| `question_id` | char(26) | FK→`question.id`, NN | The question (or its index in the snapshot) |
| `order_index` | int | NN | Position within the session |
| `answer_value` | jsonb | NN | The raw answer (`optionId` \| `[optionIds]` \| text \| a number \| `[order]`) |
| `is_correct` | boolean | NN | Correctness as computed by the server |
| `points_awarded` | int | NN, DEF 0 | The points awarded |
| `response_ms` | int | NN | The answer time (after latency compensation) |
| `received_at` | timestamptz | NN | The server timestamp of arrival |

Indexes: `(session_log_id, order_index)`; `(player_result_log_id)`.
> It lengthens both the retention and the volume → reserved for sessions where fine-grained audit or traceability is required (certification, a mock exam). Subject to the same `retain_until` deadline.

---

## 3. Enums

| Enum | Values | Notes |
|------|---------|-------|
| `user_role` | `host`, `player`, `admin` | Held as a **set** on the account; `player` is the floor, never stored |
| `quiz_status` | `draft`, `ready`, `archived` | The quiz lifecycle |
| `quiz_visibility` | `private`, `unlisted` | Unused: see `quiz.visibility` |
| `question_type` | `single_choice`, `multiple_choice`, `true_false`, `text_input`, `numeric`, `ordering`, `poll` | see technique §4 |
| `points_mode` | `standard`, `double`, `none` | `none` = a poll (0 points) |
| `option_color` | `red`, `blue`, `yellow`, `green` | Extensible beyond 4 options |
| `option_shape` | `triangle`, `diamond`, `circle`, `square` | Accessibility (colour + shape) |
| `media_kind` | `image`, `audio` | v1 (no video) |
| `session_status` | `lobby`, `in_progress`, `ended`, `archived` | `lobby`/`in_progress` only exist in Redis |

---

## 4. Real-time structures (Redis)

> The **living** state of a session. TTL ≈ the length of a session plus a margin (DEF 4 h); abandoned sessions are cleaned up automatically. It is the source of truth while a game runs, and is consolidated into the database at its end (§2.7–2.9). The keys are defined in `apps/backend/src/game/game.keys.ts`.
>
> Every session is a **room** (SPECIFICATIONS-ROOM §1): the room lives under its **PIN**, each **game** (one quiz played in it) under its own **game id** (32 hex characters). Nothing a game leaves behind (a lock, an answer, a score) is ever read by the next game of the room.

### 4.1 The room (keyed by the PIN)

| Key | Type | Contents |
|-----|------|----------|
| `pin:{pin}` | String | The room id; atomic allocation (`SET NX`), guarantees the PIN's **uniqueness** *(RG-04)*. Deleted when the room closes. |
| `room:{pin}` | Hash | `roomId`, `hostUserId`, `gameId` (the game it plays), `fullCapture`, `personalTracking`, `pickOwnName`, `participantAccess`, `joinLocked`, `joinBaseUrl`, `openedAt` — what the players were told when they came in. |
| `room:{pin}:players` | Hash `playerId → JSON` | Who each player is: `nickname`, `avatar`, `userId` (null = a guest), `connected`, `joinedAt`, `latencyMs`, `presence`. No score: it belongs to each game. |
| `room:{pin}:nicknames` | Set | The normalized nicknames (atomic deduplication). |
| `room:{pin}:ban:{nickname}` | String | A banned normalized nickname; the key's TTL is the ban's length *(RG-12)*. |
| `session:{token}` | String | The token handed out on joining → `{ pin, playerId }`; makes **reconnecting** possible (technique §11). |
| `room:{pin}:tokens` | Hash `playerId → token` | The players' session tokens, so the room keeps them alive while it lives. |
| `room:{pin}:played` | Hash `gameId → JSON` | Once a game that started is over (podium, end, host gone): what each of its players did in it — `{ playerId: { score, correct, answered, totalMs, maxStreak } }`. The standings are its sum; recording a game twice changes nothing. |
| `host:{userId}:games` | Set | The host's open rooms, by PIN (resumed from the dashboard). |

### 4.2 A game (keyed by its id)

| Key | Type | Contents |
|-----|------|----------|
| `game:{id}` | Hash | The state machine: `state`, `quizId`, `title`, `language`, `currentIndex`, `slideIndex`, `totalQuestions`, `createdAt`, the **server** timings `questionStartedAt` / `questionEndsAt` (technique §6), `mode`, `paused`, `clockFrozen`, `pausedRemainingMs`, `autoNextAt`, `mediaWaitUntil`, `mediaLeadMs`, `audioTarget`, `reviewStep`, `prevState`. |
| `game:{id}:snapshot` | String (JSON) | The frozen quiz, right answers included — server side only. |
| `game:{id}:scores` | Hash `playerId → JSON` | `{ score, streak }` in this game. Its keys are **who plays this game** (a player joining at the podium waits for the next one); the ranking is read from it (by score, then arrival). |
| `game:{id}:answers:{qIdx}` | Hash `playerId → JSON` | The graded answer: `answer`, `isCorrect`, `pointsAwarded`, `credit`, `tMs`, `receivedAt` (and `closestRank` / `distance` for a numeric `closest`). One entry per player (`HSETNX`, RG-06); later submissions are ignored. |
| `game:{id}:ready:{qIdx}` | Set | The devices that loaded a question's sound or video. |
| `game:{id}:reveal-lock:{qIdx}`, `…:advance-lock:{step}`, `…:media-wait-lock:{qIdx}` | String (`SET NX`) | One winner per transition (no double reveal, no skipped step). |

---

## 5. The shared contract (TypeScript)

> Outside the database: the types of the **`@quiz-dock/contracts` package** (technique §2.3), the source of truth of the WebSocket. They follow the enums in §3. Example payload structures (for reference, not exhaustive):

```ts
type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false'
  | 'text_input' | 'numeric' | 'ordering' | 'poll';

interface QuestionStartPayload {            // server → client (WITHOUT the right answer)
  questionIndex: number;
  type: QuestionType;
  prompt: string;
  media?: { url: string; kind: 'image' | 'audio' };
  options?: { id: string; text?: string; color: string; shape: string }[];
  timeLimitS: number;
  basePoints: number;
  startedAt: number;   // server epoch ms
  endsAt: number;
}

interface SubmitAnswerPayload {             // client → server
  pin: string;
  questionIndex: number;
  answer: string | string[] | number;
}
```

---

## 6. Data protection, retention & integrity

| Rule | How it applies |
|-------|-------------|
| **Guests are not identifiable** | `player_result_log.user_id = NULL`; only the `nickname` is stored (data not tied to a person). |
| **Account deletion** | `user.deleted_at` is set; `display_name`/`email` are anonymised; `player_result_log.user_id` is kept but the `nickname` may be pseudonymised. The aggregated reports remain. |
| **Retention** | `game_session_log.retain_until` (DEF +24 months, RG-11). A scheduled purge beyond that. |
| **Deleting a quiz** | Refused when unpurged `game_session_log` rows reference it **without a snapshot**; the recommendation is a JSONB snapshot to decouple them (see §2.7). |
| **Raw answers** | Not persisted individually by default (aggregated into `question_result_stat`) → data minimisation. |
| **Personalised tracking off** | `personal_tracking = false`: no individual row at all (`player_result_log`, `answer_log`), only the per-question aggregates and the session summary. A display name chosen by the participant is never a substitute — with tracking on, the results stay attached to the account (RG-16). |
| **Full-capture mode** | When `full_capture = true`, every answer is persisted (`answer_log`). **Turned on by the host when the session is created**; **the participants are told through a notice at the start of the session** (transparency and consent) before anything is collected. Reserved for audit and certification needs. |
| **Referential integrity** | CASCADE on the direct children (question, option); restriction or a snapshot to preserve the session history. |

---

## 7. Indexes & performance (summary)

| Table | Index | Purpose |
|-------|-------|-----|
| `quiz` | `(owner_id, status)` | The host's dashboard |
| `question` | `(quiz_id, order_index)` UQ | Order, integrity |
| `answer_option` | `(question_id, order_index)` UQ | Order |
| `accepted_answer` | `(question_id, normalized)` | Comparing a text answer |
| `player_result_log` | `(session_log_id, final_rank)`; `(user_id, session_log_id)` | Leaderboard, history |
| `question_result_stat` | `(session_log_id, order_index)` | The per-question report |
| `answer_log` | `(session_log_id, order_index)`; `(player_result_log_id)` | Replay and audit (under full capture) |
| `game_session_log` | `(host_id, started_at)`; `(retain_until)` | History, purge |
