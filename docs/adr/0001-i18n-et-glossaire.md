# ADR 0001 — Front-end i18n + a canonical vocabulary glossary

- **Status**: implemented (Phases 1–3 shipped on 2026-06-24) — glossary ratified 2026-06-24.
  A later phase (renaming the project and the code identifiers) is still pending.
- **Date**: 2026-06-24
- **Context**: the domain vocabulary is inconsistent between the README (a "training" register:
  *formateur* / *apprenant* / *session*) and the code (a "game" register: *joueur* / *partie* /
  *game*). At the same time the whole UI chrome is hard-coded French, and the backend leaks French
  error messages. We want (1) to harmonise the vocabulary around **generic** terms — neither "game"
  nor "training" — and (2) to lay down an **i18n** infrastructure on the front end.

## Decisions

1. **A generic glossary**: we converge on **session / participant / animateur** (see the table).
2. **The backend emits tokens only**: it returns **stable codes** and never text meant for a person.
   The i18n dictionary lives **on the front end alone**.
3. **Depth of the rebrand**: **the UI plus the backend error codes**. We do **not** rename the
   internal identifiers (the `game:*`/`player:*` WebSocket events, the `GameState` enum, the Prisma
   models). Those are protocol and persistence identifiers, not user-facing text.
4. **Languages**: **French only** is shipped, but the multi-language infrastructure is in place
   (dictionary structure, language selection, ICU plurals). No further translation in this pass.
5. **Validation**: class-validator errors come back as **structured codes** `{ field, code }`,
   translated on the front end (a custom ValidationPipe).
6. **Out of scope (later phases)**: renaming the project to `live-quizz`; renaming the code
   identifiers `game` → `session` (the WS contract, the enum, the models). One thing at a time.

## The canonical glossary

| Concept | Terms in use today (mixed) | **Target** | Notes |
|---|---|---|---|
| The content its owner creates | quiz | **quiz** | kept (generic) |
| A live run of a quiz | partie / game / session | **session** | the database already says `session` |
| The person answering | joueur / apprenant / participant | **participant** | |
| The person hosting | formateur / animateur / hôte | **animateur** | the `host:*` code identifiers are kept |
| The access code | PIN | **PIN** | kept |

> The full glossary (every term of the interface, in 5 languages, with the reasoning) is kept in
> [`apps/frontend/src/i18n/GLOSSARY.md`](../../apps/frontend/src/i18n/GLOSSARY.md).
>
> The glossary governs **user-facing text** (the dictionary values) and the **codes** of the error
> tokens. The code identifiers (`GameState`, `host:create`, the Prisma models) **stay** — in
> particular the protocol term `host` ≠ the user-facing term "animateur", a deliberate divergence.

## The i18n architecture (front end)

- **Library**: `react-i18next` + `i18next` (compatible with React 19 / Vite; namespaces,
  interpolation, ICU plurals).
- **Location**: `apps/frontend/src/i18n/` → `index.ts` (init) + `locales/fr/<namespace>.json`.
- **Namespaces per surface**: `common`, `dashboard`, `editor`, `live` (host/screen/player), `join`,
  `sessions`, `errors` (backend codes), `validation` (field codes).
- **Key naming**: by **feature and place**, not by domain noun (`dashboard.activeGames.stop`, not
  `partie.stop`) — so the glossary can still move without breaking the keys. The **values** carry
  the glossary ("session", "participant"…).
- **Plurals**: native ICU plurals (`{count, plural, ...}`) — we do **not** carry literal
  `joueur(s)` / `question(s)` forms.
- **An important distinction**: `quiz.language` (an existing field = the language of the
  **content** of the questions) ≠ the language of the **UI**. Two separate notions.

## Integration plan (in phases)

> An ordering constraint: **freeze the glossary (this document) BEFORE extracting the strings**, or
> we carve outdated terms in stone. Each phase is a standalone, tested commit/PR.

### Phase 1 — i18n infrastructure (nothing visible changes)
- Add `react-i18next` / `i18next`.
- Create `src/i18n/index.ts`, the empty namespaces plus `common`.
- **Wire the test harness** (`src/test/harness.tsx`) onto the `I18nextProvider` with the real `fr`
  loaded synchronously → otherwise the ~10 `getByText(/français/)` assertions break.
- Add an inert language selector (French only) to validate the wiring.

### Phase 2 — Extract the UI into the `fr` dictionary
- Migrate the strings route by route (dashboard → editor → live → join → sessions), applying the
  glossary to the **values**.
- Replace the local maps such as `STATUS_LABEL` with i18n keys.
- Convert the hand-written plurals to ICU.
- Update the affected tests along each route (through `t()` or the resolved French text).

### Phase 3 — The backend emits tokens
- **One error envelope** `{ code, params? }`, emitted by **two** filters feeding the **same** front-end
  `errors` namespace:
  - **REST** (most of the `throw`s): a global `HttpExceptionFilter`. ⚠️ Without it, a Nest
    `HttpException` serialises `{ statusCode, message, error }` — a flat code can fit inside
    `message`, but `params` has nowhere to go → the interpolated errors
    (`transition_forbidden`) would lose their parameters or keep their French. This is the silent
    half of "the backend emits tokens".
  - **WS**: a `WsExceptionFilter` — move the `error` event from `{ code, message }` to
    `{ code, params? }` in `@live-quizz/contracts` (the French `message` disappears; an
    English-only development fallback remains).
- Replace every `throw new XxxException('French text')` with a stable **code** (say
  `quiz.not_found`, `session.finished`, `nickname.taken`, `quiz.transition_forbidden` + `params`).
- **A custom ValidationPipe**: an `exceptionFactory` returning `{ code, errors: [{ field, code, params }] }`.
- Front end: an `errors` namespace (domain codes, **nested** to match the dotted codes) and a
  `validation` one (generic Zod codes). `apiErrorText` resolves `code`/`params`; for
  `{ code: 'validation', errors }` it translates **each** `{ field, code }` through `validation`.
- **Source of truth**: the codes the backend emits are authoritative; `errors.json` and
  `validation.json` must stay in step with them (no automatic guard — a code with no key renders
  the raw key).
- Out of scope: the Swagger/OpenAPI descriptions (**developer** documentation, not UX).

### A later phase (separate) — not planned here
- Rename the project to `live-quizz` (packages, npm scopes, Docker images, README).
- Rename the code identifiers `game` → `session` (WS events, `GameState`, Prisma models, Orval
  regenerated, migrations). A large blast radius — to be handled together with the project rename.

## Consequences

- **+** A coherent, neutral vocabulary; adding a second language becomes trivial (a `locales/en/`
  folder).
- **+** The backend is decoupled from presentation; clients own the wording.
- **−** A contract change (the `error` payload) → the `contracts` version must be bumped, front and
  back kept in step.
- **−** ~10 accented `getByText` assertions **plus `getByRole('button', {name})` queries** on French
  labels ("Arrêter", "Présenter", "Éditer"…) to adapt, and the harness to instrument (Phase 1).
