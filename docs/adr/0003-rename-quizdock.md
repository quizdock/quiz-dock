# ADR 0003 — Rename `live-quizz` → `QuizDock`

- **Status**: implemented (2026-06-24)
- **Context**: `Live-Quizz` (see [[0002-rename-live-quizz-et-white-label]]) collides head-on with
  **[Live Quiz](https://live-quiz.forge.apps.education.fr)**, the interactive quiz tool of the French
  Ministry of Education: an almost identical name (`live-quiz` vs `live-quizz`), the same niche (a
  sovereign alternative to Kahoot) and a strong precedence (a public, well-covered project hosted on
  the government forge). SEO would be unusable and confusion guaranteed. The project's real
  positioning is also **self-hosted, inside a company**, not education.

## Decisions

1. **New name: `QuizDock`** (displayed brand `QuizDock`, slug/package `quiz-dock`, database and
   Docker Hub `quizdock`). "Dock" evokes the **container / self-hosted deployment** (Docker) and the
   "quay" players connect to — in step with the positioning and with live multiplayer. Available and
   ownable: npm (`quiz-dock`, `@quiz-dock/*`), domains (`quizdock.io`/`.app`/`.fr`), GitHub, Docker
   Hub. (`quizdock.com` is already taken — no impact, `.io`/`.fr` were chosen.)
2. **Scope of the rename** (the same surfaces as [[0002-rename-live-quizz-et-white-label]]): npm
   scope `@live-quizz/*` → `@quiz-dock/*`, package names, Docker project/networks/volumes, database
   (`livequizz` → `quizdock`), Keycloak realm (`live-quizz` → `quiz-dock`), OIDC client
   (`live-quizz-frontend` → `quiz-dock-frontend`), `OIDC_ISSUER` (the realm), OpenAPI/Swagger titles,
   the Orval-generated code, the default logos, the default `APP_NAME` (`QuizDock`), README and specs.
3. **Deliberately kept**: the word **`live`** where it describes the *real-time feature* and carries
   no brand or SEO risk — the `localStorage live.*` prefix (persisted sessions, avatars, auth), the
   i18n `live.json`, `live-components.tsx`, the Postgres user/password `live` (an internal default
   that can be overridden). The **protocol identifiers** (the `host:*`/`player:*` WS events,
   `GameState`, the Prisma models) are left untouched — see [[0001-i18n-et-glossaire]].
4. **Historical ADRs are not rewritten**: `0001` and `0002` keep the name `live-quizz` (they record
   past decisions).
5. **De-specialisation from education to generic**: the vocabulary `formateur`/`apprenant`/`formation`
   becomes `animateur`/`participant`/`session` everywhere — prose (README, specs, living CHANGELOG),
   comments and test seeds, and **Keycloak** (role descriptions and the demo user `animateur`). The
   **technical roles** stay `host`/`player`. Replacement is done on word boundaries (`\b`) so
   `information`/`transformation`/`plateforme` survive.

## Consequences

- **+** No more brand or SEO collision; the self-hosted positioning is legible from the name itself.
- **−** The Postgres/Keycloak volumes have to be recreated (database `quizdock`, realm `quiz-dock`) —
  throwaway development data. In development, `docker compose down -v` then `up` recreates both.
- **−** The npm scope changes → `pnpm install` regenerates the lockfile (workspace `@quiz-dock/*`).
- The runtime white-label (see [[0002-rename-live-quizz-et-white-label]]) remains the brand
  mechanism: an instance can display any other name through `APP_NAME` + `branding/`, with no rebuild.

## Still to do (unplanned)

- Renaming the **GitHub repository** `live-quizz` → `quiz-dock`: done. The **local working folder**
  stays `projects/roux-quizz` (a deliberate choice: continuity of the history and of session memory).
