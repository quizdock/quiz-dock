# Changelog

All notable changes to QuizDock are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org). Generated from conventional commits.

## [0.3.2] - 2026-06-24

### Security

- Remediate transitive CVEs + add Trivy/pnpm-audit scanning *(security)*

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

## [0.1.2] - 2026-06-10

### Features

- Schéma Prisma, migrations et PrismaService (P1-DATA-1) *(data)*

## [0.1.1] - 2026-06-09

### Documentation

- Changelog 0.1.1 (outillage des fondations)

### Features

- Génère l'OpenAPI et le client REST Orval (TanStack Query) *(api)*

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


