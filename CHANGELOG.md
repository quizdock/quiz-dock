# Changelog

All notable changes to QuizDock are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org). Generated from conventional commits.

## [Unreleased]

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **An OIDC_ISSUER ending in `/` while the provider's issuer does not (or the reverse) no longer signs in: set it to the provider's issuer, as the backend log and `quizdock doctor` point out.**

### Bug Fixes

- Smoother French for the remote presence hint *(i18n)*
- Compare the OIDC issuer exactly, trailing slash included *(auth)*
- A manager reads another host's quiz, and a failed save says so *(editor)*
- Start a quiz in the instance language, and let the author change it *(quiz)*
- Bound the archive on the bytes actually unpacked *(import)*

### Documentation

- Game sequencing by events, and the engine split, after the room *(roadmap)*
- The room layer in unreleased *(changelog)*
- The multi-quiz room brief, from the model to the ordered pull requests *(spec)*
- One answer grid in unreleased *(changelog)*
- Exact OIDC issuer in unreleased *(changelog)*
- Unreleased before the release *(changelog)*
- The licence, tags and language of a quiz in the feature list
- The refactoring plan for the game gateway tests *(dev)*
- #91 is merged *(spec)*
- The community store brief, from the model to the road to opening *(spec)*
- Unreleased after merging the store prerequisites *(changelog)*
- The image retention policy for Docker Hub (proposal) *(releasing)*
- Manager read-only view in unreleased *(changelog)*
- Export for publication in unreleased *(changelog)*
- Quiz language in unreleased *(changelog)*
- Bundle JSON Schema in unreleased *(changelog)*
- Bounded import archive in unreleased *(changelog)*
- The licence and the tags are set in the quiz settings *(bundle)*
- Licence and tags of a quiz in unreleased *(changelog)*
- The README no longer opens on the 0.8 breaking change
- The README no longer opens on the 0.8 breaking change
- The 0.8 breaking change at the top of the README
- The README warns OIDC deployments about the 0.8 breaking change
- Breaking changes in a warning box, impossible to miss *(changelog)*
- The README and the CLI guide at 0.8, the media library as what is new

### Features

- The next quiz in the same room, the players still in *(game)*
- The question fits the screen, the clock as a bar *(live)*
- One answer grid on the projection and the phone *(live)*
- Export a quiz for publication to a community store *(editor)*
- Publish the manifest as a JSON Schema, one file per version *(bundle)*
- Set the licence and the tags of a quiz *(editor)*

### Refactor

- The room under its PIN, each game under its own id *(game)*

### Contributors

- fchaussin

## [0.8.0] - 2026-09-25

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **OIDC configuration changed (OIDC_SESSION_SCOPE removed; new OIDC_INTERNAL_URL, OIDC_CLIENT_SECRET, TRUST_PROXY; everyone signs in again), see <https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/upgrade-oidc-session.md>**

### Bug Fixes

- A fresh install starts: the templates folder belongs to the app *(docker)*
- Quizdock init writes the new OIDC settings *(cli)*
- Keep the session alive through a long game; words for the new errors *(auth)*
- Say why a sign-in failed in the log; a stable Keycloak issuer in dev *(auth)*
- The template page draws its slides as the stage does *(store)*
- A template card draws its first slide as the stage does *(store)*
- The OIDC session survives a new tab *(auth)*
- The wrong-PIN window opens with SET NX, on any Redis version *(game)*
- An original uploaded again is reused, not converted into a duplicate *(media)*
- The administration page says when an action on the instance media fails *(media)*
- Keep file names as typed, and a library entry kept for past results *(media)*
- Judge a conversion on the tracks that play, and word what the codecs throw *(media)*
- Adopting older files never holds up the clean-up, nor empties a restored volume *(media)*

### Documentation

- Unreleased changes *(changelog)*
- The sample quizzes wait in the templates *(auth)*
- Unreleased changes, with the OIDC upgrade notes *(changelog)*
- Upgrade notes for the OIDC session held by the backend *(auth)*
- The session held by the backend, OIDC_INTERNAL_URL and TRUST_PROXY *(auth)*
- Unreleased changes *(changelog)*
- Player view with the answer tiles pinned at the bottom *(screenshots)*
- One commented .env example per setup: standalone, local, OIDC
- The preview in plain words
- The README in the words of the people who use it
- Participant access, safeguards, CSP and preview in the README; new screenshots
- A technical debt register, starting with the OIDC tokens in the browser
- The media library in the README (and on Docker Hub), new screenshots
- Name the multi-arch builder instead of making it the default *(releasing)*
- Media library and in-browser converter *(spec)*

### Features

- No token in the browser any more, the session is a cookie *(auth)*
- The backend holds the OIDC session, the browser a cookie (BFF) *(auth)*
- Name the proxies allowed to speak for the client (TRUST_PROXY) *(security)*
- Answer tiles pinned to the bottom, up to four per row *(player)*
- Free libraries under open licences for every kind by default *(media)*
- A Content-Security-Policy on every page *(security)*
- The OIDC session shared by the tabs or per tab (OIDC_SESSION_SCOPE) *(auth)*
- Navigation above the stage, questions in 16:9 like the projection *(preview)*
- "remember my choice" in the launch dialog, set in the profile *(live)*
- Close or reopen the game to newcomers during play *(live)*
- Launch dialog for participant access, lobby lock, docs *(live)*
- Open access for participants, lobby lock, wrong-PIN limit *(game)*
- Account preferences, remembered wherever one signs in *(users)*
- An empty state like the editor's when no template is shared *(templates)*
- Invite bug reports, feature ideas, translation fixes and questions *(home)*
- One file list with Global, list or grid, and a preview *(media)*
- Sizes in pixels, and media the instance provides to every host *(media)*
- An administration page for the instance's media *(media)*
- The author's library, credits, and free libraries to look in *(media)*
- Convert every media in the browser to one format per kind *(media)*
- Store each file once, named after its SHA-256 *(media)*
- An hourly job deletes unused media and stray files *(media)*

### Performance

- Read every media's uses once per admin page, not once per media *(media)*

### Security

- The image runs on Debian 13, without the Debian 12 base's OpenSSL CVEs *(security)*

### Contributors

- fchaussin

## [0.7.1] - 2026-09-24

### Documentation

- My quizzes and the shared templates; the Docker Hub overview follows main *(screenshots)*
- New in 0.7, video and sound, right under the pitch *(readme)*

### Features

- One shared host account instead of a 5-minute seat *(demo)*

### Contributors

- fchaussin

## [0.7.0] - 2026-09-24

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **Sound files are no longer accepted. Audio could be attached to a question but no screen has ever played it, so it is refused at the door until that gets a proper design (#42). A quiz that already carries a sound keeps it in the database — nothing was deleted — but a bundle carrying one is refused as a whole, including a bundle exported from an older version. Sorry for the disruption if you were relying on it.**

### Bug Fixes

- The preload notice speaks of a tech-savvy participant *(console)*
- The preload notice names the real risk: a malicious participant *(console)*
- No pause button while the room waits for media *(console)*
- The lobby folds the address help and shares the link *(console)*
- A screen attaching at the reveal gets the session's audio target *(live)*
- The playback effect follows the position key it reads *(live)*
- The Markdown toolbar floats instead of pushing the field *(editor)*
- The sound unlock speaks of the session in Chinese, as the glossary does *(i18n)*
- The sweep spares a video or sound held outside a question slot *(media)*
- The description reads as a paragraph again *(editor)*
- A payload without a count is not a rating *(editor)*
- The reviews state really sits beside the switch *(editor)*
- A question resumed during its reading delay kept its full length *(game)*
- A taken copy starts its publication counter at zero (#39) *(store)*

### Documentation

- No version numbers ahead; finishing touches and hardening ship as patches *(roadmap)*
- The folded editor, the lobby with sound, joining in the room or remote *(screenshots)*
- V0.7.0 is video and sound; finishing touches and hardening move one step *(roadmap)*
- The folded editor, the lobby's sound first, upgrade examples at 0.7.0
- Listen first, the common start and the server clock
- Video, sound and remote participants, announced as experimental
- The last phase 4 error messages move to the idea box *(specs)*
- Phase 4 decisions on presence, default target and preloading *(specs)*
- Phase 4 brings remote players, preloading and media readiness *(specs)*
- Embedded videos move to the idea box *(specs)*
- A dedicated media brief, with microphone recording in the idea box *(specs)*
- Microphone recording moves to the backlog *(roadmap)*
- A dedicated guide for audio and video *(self-hosting)*
- Say plainly that sound files are suspended, and apologise *(media)*

### Features

- Who hears the sound comes first in the lobby settings *(console)*
- Every fold starts closed; the status bar keeps its card *(editor)*
- The status bar lines up with the title *(editor)*
- Sound settings on their own row, under the feedback *(editor)*
- Question media fold as one, visual and sound as groups *(editor)*
- Open, the sound settings read on one line *(editor)*
- Fold secondary settings, group each domain *(editor)*
- Listen first, then answer — the timer starts when the media ends *(media)*
- Every device starts a question's media on the same instant *(live)*
- Every screen reads the server's clock *(live)*
- The room waits a moment for the devices still loading a question's media *(live)*
- A playhead on the waveform, the same on every screen *(live)*
- Each question picks how thick its waveform is drawn *(editor)*
- The host sees which devices have loaded the next question's media *(live)*
- Every device fetches the next question's media ahead, from the lobby on *(live)*
- A remote participant's phone plays the question's video and sound *(live)*
- Each quiz, question and session says who hears the sound *(media)*
- A player says whether they play in the room or remotely *(live)*
- The projection asks for sound as soon as it opens *(live)*
- An interrupted media resumes a second early; the host can restart it *(live)*
- Each quiz picks the level its sounds play at *(media)*
- A question lasts as long as its media, plus a pause *(live)*
- Carry a question's video and sound (bundle version 3) *(bundle)*
- Play the question's video and sound on the projection *(live)*
- Pick an image or a video, and a sound, for a question *(editor)*
- Accept MP4 video and MP3 sound, checked by their content *(media)*
- Give a question a visual slot and an audio slot *(media)*
- Tell a media file by its bytes, not its name *(contracts)*
- Serve byte ranges so Safari can play a video *(media)*
- Each form bar says what it is saving *(editor)*
- An empty bank offers both ways to start *(dashboard)*
- Read a template as a grid, numbered and even (#39) *(store)*
- The samples live in the library instead of being handed out (#39) *(store)*
- A gallery of templates, and a preview to decide on (#39) *(store)*
- An account holds a set of roles, so managing and hosting cumulate *(auth)*
- The interface follows the roles, and an account has a page *(ui)*
- Admin manages the instance, it does not host it (RG-14) *(auth)*
- A page for running sessions, the menu is just the door *(live)*
- A top bar that fits a phone — logo only, burger below md *(ui)*
- The bank is a bank, and running sessions follow the host *(dashboard)*
- Accept images only until sound has somewhere to play (#42) *(media)*
- Alternative text, because the image is sometimes the question *(media)*
- Share a quiz as a template, browse and take copies (#39) *(store)*
- A catalogue of shared templates, on disk and offline (#39) *(store)*
- Hand a quiz over to another account with quiz:transfer *(cli)*

### Refactor

- A quiz description is plain text *(editor)*

### Contributors

- fchaussin

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


