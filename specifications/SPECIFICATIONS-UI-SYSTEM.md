# QuizDock — UI system: rules and the three-lot rework

> **Intent, not yet the code.** This document records the rules and decisions taken during the September 2026 review of every screen, before they are implemented. Once a lot ships, what it changed is described in [`docs/`](../docs/README.md) and this page keeps only what is still to do.
>
> Method: each screen was inventoried from the code (every control, piece of information, shortcut and state, phase by phase), criticised, then redrawn on a single frame that places every inventoried element. Mock-ups were reviewed and settled by the maintainer; this page is their written outcome.

---

## 1. Cross-cutting rules

### 1.1 Actions
- **One primary action per screen**, always in the same place for a given screen. Its label is a **verb + object**: *Start quiz*, *Reveal answer*, *Show Q2*, *Next quiz…*, *Back to live*, *Present*, *Join the room*.
- **Colour of an action says what it does**: green (`main-action`) = go live (*Present*, *Start quiz*, *Start anyway*, *Next quiz…*); blue (`default`) = any other primary action.
- **Destructive actions** use a red outline (`destructive-outline`), are never next to the primary action, and sit after a separator in a menu when they are rare.
- **Rare actions** go in a `⋯` menu; nothing is reachable only on hover. A menu that drops down opens from **vertical dots** (`EllipsisVertical`, ⋮), with or without a label (*⋮ More*).
- A **reversible** gesture (remove a block, release the host seat) gets an *Undo* notice instead of a confirmation; an **irreversible** one keeps its confirmation.
- A control is **never hidden then shown** because of the state: it is greyed with its reason (a *Pause* with nothing to pause, a *Delete* a room is using).

### 1.2 Vocabulary
- One word per thing: **room** everywhere (never *session* on the participant side).
- No emoji inside labels; icons are separate elements.
- Dates and numbers follow the interface language (no hard-coded locale).

### 1.3 Frames
- A screen keeps **one frame across its states**: what moves is content, never the position of controls or of the outline.
- **No dead end**: every final or error screen offers a way on (join another room, try again, back to home). The app has a *not found* page and an *error* page.

### 1.4 Contrast
- On a question or slide background, the two-layer rule of #130 applies (text with a halo; UI on an opaque support with a two-tone edge; local palette through `data-scheme` and the `on-backdrop:` variant).
- **Field outlines reach 3:1** against the page (WCAG 1.4.11): the `--input` token goes to about `oklch(0.6 0 0)`; `--border` stays for decorative separators.
- A wrong or inactive answer is **greyed at low contrast, never made transparent**; the right answer keeps its colour and a two-tone ✓ mark.

### 1.5 Validation — permissive, constrain only when there is no other choice
| Level | What | What the author sees |
|---|---|---|
| 1 · Impossible by construction | Maximum lengths, 8 options, 20 accepted answers, 30 blocks / 10 per column, ordering positions chosen by swap, video *or* sound, image *or* gradient background, decimals accepted | A counter that stops at the limit; an *Add* button that says "8 max". Never an error. |
| 2 · Corrected automatically | Time clamped to 5–240 s, reveal delay to 1–300 s, negative tolerance to 0, empty rows/answers/blocks dropped, ticks reset on a type change, whitespace trimmed | A note under the field, not an error. |
| 3 · Completeness, checked at publication | A right answer ticked, at least 2 options, at least one accepted answer, a prompt or a media, pictures and their alt text (existing product decision), target and tolerance, a slide that shows something | *Save* always works; the step carries ⚠ in the list; *Publish* opens a checklist that leads to each step. Saving an incomplete step in a *ready* quiz offers to move it back to draft. |
| 4 · Blocking at save | Technical integrity only: unknown media, media of the wrong kind, concurrent save, item deleted meanwhile | Error on the field concerned, summary next to *Save*. |

- One way to show errors everywhere: **under the field**, a **summary next to *Save*** with links, **focus on the first** one. No native browser bubbles (`noValidate`).
- The shared schema in `@quiz-dock/contracts` separates **structure** (levels 1, 2, 4: always required) from **completeness** (level 3: required to become *ready*, and for any save in a *ready* quiz). The front validates with the same schema as the server.
- The API keeps the **field path** of every validation error; every business rule carries a **domain code** with its own text; a test fails when a code the server can send has no translation.

### 1.6 Typography, widths, warnings
- `PageTitle` (`text-2xl font-bold tracking-tight`) and `SectionTitle` (`text-lg font-semibold`) everywhere; the spaced uppercase style is reserved for form legends.
- Page widths only through the `content-*` tiers; no raw `max-w-*`.
- Warnings through `--warning` / `--warning-text` (`Notice tone="warning"`, `Badge variant="warning"`); no hard-coded `amber-*`.

### 1.7 How — using the stack
- **Tailwind v4**: tokens in `index.css`, custom variants (`on-backdrop:`), no per-component colour.
- **Zod schemas in `@quiz-dock/contracts`**, shared by NestJS and the front; **TanStack Form** field validators built from them.
- **TanStack Table** for the history, results and room tables (sortable columns).
- **Orval**-generated clients stay the only REST access; error mapping keeps field paths.
- **Vitest** for components and the translation-coverage test; **Playwright** for one screenshot per screen and state, to catch regressions of the frames.

### 1.8 Motion — one layer, below the components
The live screens (projection, phones) move between steps; the rest of the app does not. Motion is a layer the game components do not know about, so a new screen or question type gets it for free.
- **One place**: `game/motion/` is the only code importing Motion — its tokens (durations, easing, stagger), the root setting (the system's *reduce motion* honoured: movement off, fades kept) and the primitives below.
- **Automatic, at the root of a live screen**: when the step changes, the previous background fades out over the new one (gradient, picture, video or none: nothing is duplicated), then the step's top-level elements come in one after the other.
- **Two primitives where a component must say what moves**: a number that counts up (scores) and a list that reorders by sliding (the standings, keyed by player). The reveal's bars fill from zero; the podium's steps rise third, second, first.
- **Three levels**: the instance's default for new rooms (`LIVE_MOTION`), the room's switch in the console (*Animations*, at any time, every screen follows), and each device's *reduce motion* (fades only). No per-user setting: the system's does that job.
- **Never in the way of the game**: purely visual, short (about half a second); no timer, sync or media start waits for an animation. Only opacity and position move, for the projectors and old phones. Animations are off in tests.

---

## 2. Lot 1 — live, host side

### 2.1 Console
- **Top, row 1** — where I am, in what state, what I look at: room and quiz, PIN (opens the invitation: QR, address, share, invitation address) at any moment, participants (opens the *Players* tab), phase; the **Console · Projection · Participant** views, in every phase.
- **Top, row 2** — what I set: *Open/Closed to newcomers*, *Sounds* (the room mixer), *Animations*, *Projection window*.
- **Transport** (2026-10-04) — at the top of the right column, above the outline and the players (first on a narrow screen): *Auto* switch and *Pause* (always there, greyed when there is nothing to pause, Space key shown), then *Change quiz* / *Choose the quiz* (lobby) or *Stop the quiz…*, and *Close room…* (red outline).
- **Centre** — the current step, same place in every phase; at the reveal the same tiles receive their counts (they are the gauge); the answer key is stated in words for the host only.
- **Right** — two tabs: **Outline** (every step with type and duration, a slide icon; played steps clickable to look back read-only; ◀ ▶ in its head) and **Players** (ready, media loaded, remote, remove for N minutes). *Players* by default in the lobby and while media load.
- **Bottom** — the information that decides when to move on ("12 of 14 answered · 14 s left", auto countdown) and the single primary action.
- Every phase keeps the frame: lobby, media loading, slide, question, reveal, looking back, podium. Before starting, the fixed-once-started settings are grouped ("Before starting").

### 2.2 Projection
- **Top band** (every phase): where the game is ("Question 1 / 10", room, quiz), the clock in the centre, the join reminder (address, PIN, small QR) on the right while the room is open to newcomers.
- **Stage**: the prompt always at the top, same size at the question and the reveal; at the reveal **the tiles stay in place**, each filled in proportion to its answers with its count and percentage; wrong ones in low-contrast grey.
- **Bottom band**: the room's status in large type ("12 / 14 answered", "9 / 14 found it", "11 ready", "Paused", "Waiting for the host").
- A real **leaderboard** screen (top 10 with score bars); looking back and pause are visible to the room; *Waiting for the host…* is distinct from *Paused*.
- Only exception to the frame: a **slide** (the author's full-screen composition) keeps just a "Join · PIN" chip.
- Corner buttons keep their two-tone edge.

### 2.3 Sound
- The projection plays the room's sound; the console controls it entirely (issue #150). The fullscreen click also unlocks the sound.

---

## 3. Lot 2 — authoring

- **Dashboard**: the whole card opens the editor; one visible action (*Present* when ready, *Publish to present* when draft); `⋯` for preview, history, archive, delete. *New quiz* opens the new quiz's editor.
- **Editor frame**: the quiz frame (title, description, settings) saves by itself with a visible *Saved*; header shows *Preview* and a `⋯ More` (history, export, export for publication, share as a template, archive · delete). The primary action stays in the status bar (*Publish* / *Present*). List rows show their actions on the selected row and a `⋯` on the others; the rail keeps the `⋯`. On a phone the form opens when a step is picked, not on load.
- **Question form**: order *Type · Prompt · Answers*, then folds *Media · Timing · Points · Explanation · Background*, each with a summary that is always filled. A live preview (projection / phone) made of the live components. *Correct* is a readable toggle; changing type resets ticks and says so; *True/False* comes with *True* ticked; ordering positions are chosen as "1st, 2nd…" (1-based, swap on conflict; the players still see the author's order); numeric target and tolerance accept decimals; accepted answers show "n / 20"; the scoring help is written under the choice; alt text and credit of a media are saved with the form.
- **Slide form**: same error display as the question; alignment as icons for text and image; removing a block offers *Undo*; empty blocks are flagged "empty — skipped when saved".
- **Preview page**: step list, ← → keys, *Back to the editor*, projection / phone switch.
- **Templates**: *Create a quiz from this* everywhere with one icon; *Withdraw* only for the author (or an admin), red outline, in `⋯`. A template's page **is the preview page**: the server reads the template through the import that makes the copy and returns its steps in the quiz's shape (media under stand-in ids with their catalogue URLs), and the page draws them with the quiz preview; only its header differs (author, licence, *Create a quiz from this*).
- **Read-only quiz**: same status colours as the editor; "No questions yet".

---

## 4. Lot 3 — entry, account, phone, back office

- **Join**: one component on the home page and `/join`; six digit boxes, numeric keypad; the PIN is checked as soon as the 6th digit is in (the room's name shows, or the error under the boxes). A signed-in host sees "Continue to my quizzes →".
- **Sign in**: local mode in one step (seat state, name, how long to keep it, *Take the host seat*; seat taken: *Join a room as a participant*); OIDC button with a loading state; the callback's error offers *Try again* and *Back to home*.
- **Phone, before the game**: "Joining Claire's room" on the nickname form, a 20-character counter; the lobby shows who I am, then *I'm ready* as the primary action at the bottom, sound and *Share the projection* as secondary actions.
- **Phone, ends**: removed → *Join another room*; host gone → an indicator and *Waiting for the host…*; end → feedback then *Join another room*.
- **Account and menus**: the profile in plain language (technical details folded), an error state; the user menu and the burger carry the same entries (including *Instance media*); the burger stays open while the seat is adjusted; *Release the seat* offers *Undo*.
- **History**: dates in the interface language, success as a bar, sortable columns, an empty state leading to *Present this quiz*.
- **Open rooms**: state and players first, then *Stop…* (red outline), *Projection*, *Resume* (primary); load and stop errors shown.
- **Instance media**: visible filter labels; *Delete* greyed with its reason when a room plays the file; actions inside the preview; a tab title.

---

## 5. Open points

- *Duplicate* one's own quiz (today only *Create from this quiz* on someone else's): an addition to decide.
- Shuffling an ordering question's items for the players: an addition to decide.
- A question's alt text for picture answers stays required at publication (existing decision); reopened only on request.
