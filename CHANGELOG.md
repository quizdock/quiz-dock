# Changelog

All notable changes to QuizDock are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org). Generated from conventional commits.

## [0.6.0] - 2026-09-22

### Bug Fixes

- The phone shows the nickname the server actually kept *(live)*
- Show the question image to participants and on the projection (#41) *(live)*
- The notice must not promise an account a guest does not have (#38) *(game)*

### Documentation

- Point the upgrade examples at 0.6.0
- The revision counter describes what the code does today *(specs)*
- No catalogue on a demo instance (#39) *(specs)*
- Write down how quizzes are shared, by copy (#39) *(specs)*
- Finish the guide split, specify roles and personalised tracking (#38)
- Split the operator guide, group the variables by theme *(self-hosting)*
- Translate the contributor docs, the ADRs and the specifications

### Features

- Link the project site from the demo limitations *(demo)*
- List on the home page what a demo instance does not do *(demo)*
- Add personalised tracking and the chosen display name (#38) *(game)*
- Authenticate participants too under AUTH_MODE=oidc (#38) *(auth)*
- Point OIDC_NAME_CLAIM at the claim carrying the display name (#38) *(auth)*
- Make `host` an assignable role, not only a derived one (#38) *(auth)*
- Take the header logo in any web format, add APP_LOGO_URL *(brand)*

### Refactor

- Stop exposing quiz.visibility, which describes nothing (#39) *(api)*

### Contributors

- fchaussin

## [0.5.1] - 2026-09-21

### Bug Fixes

- :latest no longer overwritten by the standalone image; non-root everywhere *(docker)*
- Prisma 7.10 drops hono/valibot, overrides for qs and body-parser *(deps)*
- Bake the schema engine matching the runtime so migrate works offline *(docker)*

### Documentation

- The standalone scan raises the npm alerts until the next release *(security)*
- Audit of the 48 code-scanning alerts — :latest was the standalone image *(security)*
- A 15-second GIF of a session on the big screen under the pitch *(readme)*
- One row of badges, main features first, local vs OIDC table, six screenshots *(readme)*
- Local mode vs OIDC mode among the features *(readme)*
- Link to the public demo instance *(readme)*

### Features

- Update tranditional chinese translations *(i18n)*

### Contributors

- fchaussin
- noeFly
- Francois Chaussin

## [0.5.0] - 2026-09-20

### Bug Fixes

- The admin CLI boots again — its context imports RedisModule *(cli)*
- Cap a seat taken before the guard at startup; local-mode hint no longer says demo *(demo)*
- A server install keeps the proxy-resolved origin as invitation address; remembered and LAN candidates only apply on localhost *(control)*
- Option removal confirmation checks the text only *(editor)*
- A quiz in play cannot be deleted; a session whose quiz vanished still ends; polls show no verdict *(live)*
- Screens attaching at a reveal get the question; option tiles pair up (container query on the wrapper); projection timer on one line; Resume vs Back to live *(live)*
- Help state declared before use *(control)*
- Sessions survive a server restart — timers re-armed from Redis, sockets re-attach on reconnect *(live)*
- One avatar everywhere — the server's seed once the game runs, podium rows keep it on reconnect *(live)*
- Accepted answers joined with a translated separator, not a hard-coded French 'ou' *(live)*
- Slides stretch to their container, halo is the design default *(live)*
- Resolve zh-TW straight to en, never through zh *(i18n)*
- Never provision an anonymous local identity, serve /config.js publicly *(auth)*
- Keep the OIDC session alive and log out at the provider *(auth)*

### Documentation

- Fix the Keycloak realm link; index and README mention the CLI quiz export / import
- Local mode and demo mode are two different things *(demo)*
- Phone views composed into landscape images — one format for every shot *(screenshots)*
- Editor after the status-bar rework *(screenshots)*
- Features, screenshots in journey order, scoring and live-session notes, config knobs
- Credit the zh-TW contributor in the glossary *(i18n)*
- Glossary — every interface term in the five locales, and the wording decisions *(i18n)*

### Features

- Quiz:list, quiz:export and quiz:import on the same services as the API (#20) *(cli)*
- The manifest carries the store fields (slug, revision, tags, license…) *(bundle)*
- The SPA learns of the demo from GET /auth/config, not config.js *(demo)*
- Public instance guards — 5-minute host seat, no uploads, hourly reset *(demo)*
- Running sessions of the quiz replace the single-session bar; options are removed with a trash icon and a confirmation *(editor)*
- Invitation address anticipates the runtime — bare LAN IPs composed with the page's scheme/port, environment-aware help, setups table in the docs *(control)*
- Help on the invitation address — why it matters and where to find the machine's IP *(control)*
- The host picks the invitation address (public URL, LAN IP, this page, or any address) *(live)*
- Show the project version (release tag) instead of the wire contract's *(frontend)*
- The reveal shows the answers with the participant's own pick (or typed / ordered answer) *(player)*
- URLs read like the interface; Tab cycles the console views; join fields autofocus *(routes)*
- Extend the host seat for a chosen duration, or release it, from the user menu *(auth)*
- Console / Projection / Participant tabs replace the breadcrumb *(control)*
- Ordering answers by drag and drop (pointer, touch, keyboard), arrows kept as fallback *(player)*
- Per-type scoring variants and a fixed points mode *(scoring)*
- Host seat countdown and renewal in the topbar *(auth)*
- Form edits follow the editor in a running session, substance stays frozen *(live)*
- Host navigates back over played steps (question reveals, slides) and resumes *(live)*
- Answer rules shown with the question on the projection and the phone *(live)*
- Text outline on by default for slides and questions
- Import a bundle from the dashboard, export from the editor *(frontend)*
- Portable bundle export / import (quiz.json + media/, zipped) *(quizzes)*
- Qd command inside both images *(cli)*
- Quizdock operator script (init, up, backup, restore, upgrade) + guide *(cli)*
- Admin CLI shipped in the image (doctor, seat, users, samples, purge) *(cli)*
- Make the local host seat an intentional, expiring claim *(auth)*
- Resolve the JWKS through OIDC discovery and stick to the standards *(auth)*
- Enforce the host role and add a zero-config local host seat *(auth)*

### Contributors

- Francois Chaussin
- fchaussin

## [0.4.2] - 2026-09-16

### Bug Fixes

- Zh-TW nickname typo (匿稱 → 暱稱) *(i18n)*

### Documentation

- Mention zh-TW in index.ts header and .env.example

### Features

- Add missing zh-TW keys (machine-assisted, native review welcome) *(i18n)*

### Contributors

- Francois Chaussin

## [0.4.1] - 2026-09-16

### Bug Fixes

- Load zh-TW dashboard namespace from the right folder *(i18n)*

### Documentation

- Add zh-TW as avaliable language in docs files

### Features

- Add zh-TW translations *(i18n)*
- Describe the selected question type's behaviour under the type select *(editor)*
- Navigation shells for host, participant and projection
- Document title per route ("<page> · <app name>") *(frontend)*
- Running-sessions badge on each quiz card *(dashboard)*
- Form drafts in localStorage, persistent nickname, capture confirm on the console
- Text block size — S 20 / M 30 / L 40 px on the stage *(slides)*

### Contributors

- Francois Chaussin
- noeFly

## [0.4.0] - 2026-09-16

### Bug Fixes

- Portal + fixed overlay instead of <dialog> top layer *(drawer)*
- Reopen modally after a hot reload, hide the grip on the side sheet *(drawer)*

### Documentation

- Absolute link in the upgrading note (Docker Hub renders the README) *(readme)*
- Upgrading procedure (auto migrations, backup, no rollback), engine knobs, release checklist
- README features cover slides, rich text, explanations, backgrounds; drop the stale Docker Hub overview copy
- Document the 0.x version bump rule *(release)*

### Features

- Confirm before deleting a question or a slide *(editor)*
- Status bar replaces the folded settings box *(editor)*
- Collapsible sequence rail and foldable slide preview *(editor)*
- Per-block text alignment, centred by default *(slides)*
- Backgrounds for slides and questions, gradient generator, column splits
- Block composer replaces title/body/layout *(slides)*
- Inline images, text contrast over covers, display-time semantics *(slides)*
- Layouts and full-surface rendering *(slides)*
- Master/detail builder, in-place title, option pairs, feedback page *(editor)*
- Drag-and-drop ordering, unsaved-edit guard, mobile drawer *(editor)*
- Content slides in the quiz sequence (quiz_item kind=slide)
- Per-question reveal delay in auto mode (question.reveal_delay_s)
- Answer explanation shown at reveal (question.answer_explanation)
- WYSIWYG editor for Markdown fields, with source toggle *(frontend)*
- Render restricted Markdown in text fields *(frontend)*

### Security

- Remediate transitive HIGH/CRITICAL CVEs, scan before audit gate *(security)*

### Contributors

- Francois Chaussin
- fchaussin

## [0.3.2] - 2026-06-24

### Security

- Remediate transitive CVEs + add Trivy/pnpm-audit scanning *(security)*

### Contributors

- fchaussin

## [0.3.1] - 2026-06-24

### Bug Fixes

- Exclude /config.js from OpenAPI (asset, not an API endpoint) *(api)*

### Documentation

- One-container (:standalone) quickstart + split user/integrator docs
- Detailed configuration, branding & OIDC guide
- Add join/avatar + player-review + podium shots; emoji-fixed; rating feature
- Add 1024x768 screenshots gallery to README
- Add a full badge row (release, CI, docker, stack, i18n) *(readme)*
- Add Docker Hub repository overview (ready to paste)

### Features

- All-in-one :standalone image (one-command beginner use) *(deploy)*

### Contributors

- fchaussin

## [0.3.0] - 2026-06-24

### Bug Fixes

- Block answering during the read delay so every answer counts *(player)*
- Center modal ConfirmDialog *(ui)*
- Enable Vite polling so WSL2 bind-mount edits hot-reload *(dev)*
- Stop Questions overlapping the sidebar on desktop *(editor)*
- Hoist Questions above Diffusion/Avis on small screens, stop horizontal overflow *(editor)*
- Tooltip no longer sticks after click; hover-delay + keyboard-only focus *(ui)*
- Rating no longer hangs on a missing ack; backend tsc watch polling
- Manuel/auto tooltips were clipped; add Démarrer tooltip *(control)*
- Editor 2-col layout was clipped by the shell width cap *(frontend)*
- Freeze the countdown on pause across all three surfaces *(frontend)*
- Reveal lisible pour ordre/texte (intitulés, valeurs acceptées) *(frontend)*
- Écran joueur — énoncé, chrono, multi-réponses, types numérique/texte/ordre *(frontend)*
- Join joueur sur le socket du hook (pas un 2ᵉ socket) *(frontend)*
- Convergence REVEAL sur les connectés en attente, pas hlen(réponses) *(game)*

### Documentation

- Docker hub run instructions (pull image) + build option
- Add Multiavatar player avatars feature *(readme)*
- Rewrite for GitHub + Docker Hub; logo, features, self-host *(readme)*
- Clarify registry/namespace (Docker Hub account vs GHCR alt) *(releasing)*
- Add RELEASING.md (Docker Hub publishing plan)
- Site is live at quizdock.github.io *(brand)*
- Add brand & hosting notes (surfaces, GitHub Pages, org reservation) *(brand)*
- I18n plan + canonical glossary (session/participant/animateur) *(adr)*
- Cadrage de la partie live + avatar au backlog *(specs)*
- Changelog — boucle de jeu complète + partage PIN/QR (v0.3.0 en cours)
- Changelog — scoring + session create/join + ports 1xxxx (v0.3.0 en cours)

### Features

- Real QuizDock icon as default app logo; show app name in header *(brand)*
- Single all-in-one image (NestJS serves the SPA) *(deploy)*
- Add English, Spanish & Simplified Chinese; env-driven instance language *(i18n)*
- Rename live-quizz -> QuizDock *(brand)*
- Rename roux-quizz -> live-quizz + runtime white-label *(brand)*
- Wire per-field validation translation (honor structured codes) *(i18n)*
- Phase 3 — backend emits only tokens, front owns the dictionary *(i18n)*
- Phase 2 — extract all UI strings + apply glossary *(i18n)*
- Phase 2 — extract dashboard + confirm-dialog, apply glossary *(i18n)*
- Phase 1 — synchronous i18next infra (react-i18next, FR) *(i18n)*
- Score-bar ranking list at reveal (top 10), podium kept for the end *(live)*
- Icon-only save button for the avatar *(avatar)*
- Randomizable, persisted player avatars propagated live *(avatar)*
- Host can ban a player for a duration (RG-12) *(game)*
- Standings between questions, final ranking, player rank + avatars *(live)*
- Sticky-bottom join QR + PIN during phone-answer questions *(screen)*
- Full-capture consent toggle in the lobby before start (SFD 3.1) *(game)*
- Per-participant drill-down + CSV exports (phase 3) *(sessions)*
- Owner-only history of archived games (phase 2 — consultation) *(sessions)*
- Archive finished sessions with results (phase 1 — capture) *(game)*
- Enlarge result/end icons, sticky-bottom answer zone with scrollable prompt *(player)*
- Guard end-game with warning + confirm modal, expose pause during a live question *(control)*
- Textarea prompts, responsive sidebar, scrollable feedback, relocated delete *(editor)*
- Auto-advance countdown + progress bar on the reveal *(control)*
- Show the correct answer (green outline) to the host live *(control)*
- Prominent current-question panel during a live question *(control)*
- Stop a game from the dashboard list and the control lobby *(game)*
- End-of-game rating UI — player stars + owner Avis card *(frontend)*
- End-of-game player rating (Likert + comment), owner-only read *(feedback)*
- Quiz title + description in recap, tooltips on actions/QR *(control)*
- Editor desktop layout — settings sidebar + questions main *(frontend)*
- Control console as a pacing dashboard (mode/pause/chrono/outline) *(frontend)*
- Manual/auto pacing, pause, live chrono adjust + control outline *(game)*
- Bouton « Présenter » en vert (variante success) *(frontend)*
- Éditeur — « Enregistrer » réactif au dirty + modal de confirmation custom *(frontend)*
- Builder réorganisé + panneau d'accès (contrôle/projection/invitation) *(frontend)*
- Endpoint REST GET /games/mine + panneau « parties en cours » (§6.2) *(game)*
- Écrans live — console hôte, projeté, client apprenant (§10.3) *(frontend)*
- Fondation live client — socket dédoublonné, hook d'état, chrono *(frontend)*
- Replay complet à l'attache — roster du lobby + answer:count courant *(game)*
- Hôte déconnecté — pause HOST_DISCONNECTED, reprise et fin auto (§7) *(game)*
- Sémantique live de rattachement — late join, spectateur, reconnexion, host:attach *(game)*
- Message de partage enrichi (PIN + lien cliquable) ; docs à jour *(frontend)*
- Home rejoindre fonctionnel, /join en Card, bouton Partager (PIN+QR) *(frontend)*
- Partage de partie par PIN + QR code depuis l'éditeur et la liste (P3-FRONT-1) *(frontend)*
- Reveal personnel + leaderboard + host:reveal/next/end + podium (P3-BACK-7/8) *(game)*
- Player:submit — timing serveur, unicité, scoring branché (P3-BACK-5) *(game)*
- Machine à états — host:start, question:start, timer→reveal atomique (P3-BACK-4/5) *(game)*
- Série neutre sur questions sans points + filtre WS error typé *(game)*
- Session create + join sur état Redis (P3-BACK-2/3) *(game)*
- Fonction de scoring pure + grading par type + golden tests 100% (P3-BACK-6) *(game)*
- Fondation temps réel — gateway Socket.IO /game + Redis + contrat WS typé (P3-BACK-1) *(game)*

### Refactor

- De-specialize education vocabulary -> generic *(brand)*
- Semantic color tokens over Bootstrap-style "success" *(frontend)*

### Contributors

- fchaussin

## [0.2.0] - 2026-06-12

### Documentation

- Changelog v0.2.0 (Builder + Auth)

### Features

- Flux de connexion OIDC (Authorization Code + PKCE) (P2-FRONT-1) *(frontend)*
- Endpoint public GET /auth/config (découverte du mode par la SPA) *(auth)*
- Intègre les icônes lucide-react (+ specs) *(frontend)*
- Plein écran + responsive sur l'aperçu (fondation live v0.3.0) *(frontend)*
- Passe UI shadcn/ui + Tailwind v4 *(frontend)*
- Réordonnancement des questions dans l'éditeur *(frontend)*
- Upload média dans le formulaire de question *(frontend)*
- Bouton Aperçu → prévisualisation du quiz en nouvel onglet (P2-FRONT-4) *(frontend)*
- Formulaire de question par type (ajout/édition) (P2-FRONT-3) *(frontend)*
- Shell de l'éditeur de quiz — méta, cycle de vie, liste (P2-FRONT-3) *(frontend)*
- Fondation builder — router, auth locale, tableau de bord (P2-FRONT-1) *(frontend)*
- Upload sur volume local servi par le backend (P2-BACK-5) *(media)*
- Endpoint de duplication de quiz (P2-BACK-2) *(quizzes)*
- Endpoints CRUD questions/options + validation par type (P2-BACK-3/4) *(questions)*
- Endpoints CRUD quiz + cycle de vie + validation Zod (P2-BACK-2/6) *(quizzes)*
- Abstraction AuthProvider (none/keycloak) + guard + provisioning (P1-BACK-3) *(auth)*

### Refactor

- Généralise Keycloak → OIDC (specs + code + schéma) *(auth)*

### Contributors

- fchaussin

## [0.1.2] - 2026-06-10

### Features

- Schéma Prisma, migrations et PrismaService (P1-DATA-1) *(data)*

### Contributors

- fchaussin

## [0.1.1] - 2026-06-09

### Documentation

- Changelog 0.1.1 (outillage des fondations)

### Features

- Génère l'OpenAPI et le client REST Orval (TanStack Query) *(api)*

### Contributors

- fchaussin

## [0.1.0] - 2026-06-09

### Bug Fixes

- Rendre la stack opérationnelle (dev + prod) vérifiée end-to-end *(docker)*

### Documentation

- Changelog v0.1.0 (fondations)
- Spécifications de référence et organisation du dépôt

### Features

- Squelette React + Vite avec page d'accueil *(frontend)*
- Squelette NestJS avec /health et OpenAPI *(backend)*
- Package partagé d'énumérations et d'événements WS (dual ESM/CJS) *(contracts)*

### Contributors

- fchaussin


