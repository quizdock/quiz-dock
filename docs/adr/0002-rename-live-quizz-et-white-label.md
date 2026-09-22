# ADR 0002 — `live-quizz` rename + white-label (configurable brand)

- **Status**: implemented (2026-06-24)
- **Context**: the `roux-quizz` project is renamed to `live-quizz`, and its positioning is
  de-specialised (the "training" framing is dropped from the taglines). On top of that, the brand
  (name, logo, styles) must be **customisable at deployment time** without rebuilding the image.

## Decisions

1. **Global rename `roux-quizz` → `live-quizz`**: npm scope (`@live-quizz/*`), package names,
   Docker project/networks/volumes, database (`livequizz`), Postgres user (`live`), Keycloak realm
   (`live-quizz`), OIDC client, `localStorage` keys (`live.*`), Swagger titles, generated code
   (Orval regenerated). The **protocol identifiers** (`GameState`, the `host:*`/`player:*` events,
   the Prisma models) are left untouched — see [[0001-i18n-et-glossaire]].
2. **De-specialisation**: the tagline "Quiz interactifs pour la formation" becomes
   "Quizz interactif". The word "formation" stays in the **specs** (domain prose), not in the
   taglines, headlines or UI.
3. **Runtime white-label** (no rebuild):
   - **App name**: the `APP_NAME` environment variable → an entrypoint regenerates `/config.js`
     (`window.__APP_CONFIG__`) when the container starts. The app reads `src/config.ts`.
   - **Logo & CSS**: files served at fixed paths (`/branding/logo.svg`, `/branding/override.css`),
     **replaceable through a Docker volume** (`./branding` mounted into the served root).
   - The defaults are bundled in `apps/frontend/public/` (for the build, and when no volume is mounted).

## Consequences

- **+** An instance rebrands itself through `.env` (`APP_NAME`) and the `branding/` folder — no image
  to rebuild. The UI no longer carries a hard-coded brand: the header logo, the tab title and the
  share text all go through the config.
- **−** The Postgres/Keycloak volumes have to be recreated for the new names to apply (throwaway
  development data — done).
- **−** `config.js` is loaded blocking, ahead of the bundle (negligible, the file is tiny).

## Still to do (unplanned)

- Renaming the **code identifiers** `game` → `session` (WS events, `GameState`, Prisma models,
  migrations). A large blast radius — kept separate, see [[0001-i18n-et-glossaire]].
- A possible rename of the **repository / working folder** (`projects/roux-quizz`) — out of scope.
