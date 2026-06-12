# Changelog

Toutes les évolutions notables de Roux-Quizz. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/),
versionnement [SemVer](https://semver.org/lang/fr/) (pré-1.0 : `0.MINOR.PATCH`). Voir
[specifications/SPECIFICATIONS-ROADMAP.md](./specifications/SPECIFICATIONS-ROADMAP.md).

## [Non publié] — v0.2.0 Builder + Auth (en cours)

### Added
- **Fondation frontend builder** (P2-FRONT-1, début) : **TanStack Router** + **Query**, contexte
  d'**auth mode local** (`X-Local-User`, stocké localement) avec connexion par nom, garde de route,
  et **tableau de bord** listant les quiz du formateur via le client **Orval** (liste + création).
  Mutator `fetch` custom injectant l'en-tête d'auth. Branché de bout en bout (proxy Vite → API).
- **Éditeur de quiz** (P2-FRONT-3) : route `/quizzes/:id`, édition des métadonnées (TanStack **Form**),
  **cycle de vie** (publier/brouillon/archiver/supprimer), liste des questions.
- **Formulaire de question par type** (TanStack Form, ajout **et** édition) : sélecteur de type +
  champs **dynamiques** — options couleur/forme/correcte (radio si réponse unique), `correctOrderIndex`
  (remise en ordre), réponses acceptées (texte), valeur/tolérance (numérique), sondage. Construit un
  payload propre par type et **affiche les erreurs de validation** renvoyées par l'API (400).
- **Tests d'intégration frontend** (harnais router mémoire + Query + auth + `fetch` mocké) :
  tableau de bord (liste/vide/création), connexion locale + redirection, éditeur (rendu détail,
  publication PATCH, publication désactivée si 0 question), garde de route → login.
- **Upload média** (P2-BACK-5) sur **volume local** servi par le backend : `POST /media`
  (multipart, authentifié, validation mime image/audio + taille `MEDIA_MAX_BYTES`),
  `GET /media/:id` (**public** — chargé aussi par les apprenants en jeu), `DELETE /media/:id`
  (propriétaire). `media_asset.url` = route de service backend ; un fichier par id.
- **CRUD Questions + options + réponses** (P2-BACK-3) + **validation par type** (P2-BACK-4) :
  `POST /quizzes/:id/questions`, `PUT/DELETE /questions/:qid`, `PATCH /quizzes/:id/questions/reorder`.
  Validation Zod **exhaustive par type** (§4) : 2–6 options, nombre de bonnes réponses, permutation
  `ordering`, réponses acceptées (text_input, `normalized` calculé serveur RG-06), value+tolérance
  (numeric), sondage sans bonne réponse. Isolation via le quiz (`/questions/:qid` → 404 si non
  possédé) ; `questionCount` maintenu atomiquement ; réordonnancement en deux phases (anti-collision
  d'unicité) ; `GET /quizzes/:id` renvoie désormais les questions. Le passage à `ready` exige ≥ 1
  question, la validité par type étant garantie à l'écriture.
- **CRUD Quiz** (P2-BACK-2) + **cycle de vie** `draft→ready→archived` (P2-BACK-6, RG-02) :
  `GET/POST /quizzes`, `GET/PUT/DELETE /quizzes/:id`, `PATCH /quizzes/:id/status`,
  `POST /quizzes/:id/duplicate` (copie profonde questions/options en `draft`).
  **Isolation par propriétaire** stricte (404 si non possédé, jamais de fuite d'existence) ;
  transitions validées (draft→ready exige ≥ 1 question — validation par type à venir en P2-BACK-3).
- **Pipeline de validation Zod** (`nestjs-zod`) : DTO `createZodDto` → validation runtime
  (`ZodValidationPipe` global) **et** schémas OpenAPI (`cleanupOpenApiDoc` dans les deux bootstraps),
  consommés par le client Orval. Conforme au choix technique « un seul langage, schémas réutilisés ».
- **Abstraction `AuthProvider`** (SPECIFICATIONS §1, P1-BACK-3) sélectionnée par `AUTH_MODE` :
  - `NoAuthProvider` (mode `none`) : identité locale via l'en-tête `X-Local-User` (sentinel
    `local:<slug>` déterministe), toujours rôle `host`.
  - `OidcProvider` (mode `oidc`) : validation JWT **production** d'un fournisseur **OIDC quelconque**
    via JWKS (`jose`) — signature, `iss`, `exp`, `aud` (optionnel). `iss` attendu et URI JWKS
    configurables **séparément** (`OIDC_ISSUER` ≠ `OIDC_JWKS_URI`) pour le cas Docker (host interne ≠
    host SPA) ; claim de rôles paramétrable (`OIDC_ROLES_CLAIM`, défaut `realm_access.roles`).
    **Keycloak** reste l'IdP OIDC **de référence** fourni en dev (profil Compose), sans spécificité.
- **`AuthGuard` global** (sécurité par défaut) + décorateur `@Public()` (santé ouverte) +
  `@CurrentUser()` ; **provisioning** utilisateur idempotent (`UsersService.upsertFromPrincipal`,
  upsert sur `oidcSubject`).
- **`GET /me`** : profil de l'utilisateur authentifié (exerce guard + provisioning + `@CurrentUser`).
- **Realm de référence** : direct grant + utilisateur de test `formateur` (rôle `host`) pour login/dev.

### Fixed
- **Client Orval : double préfixe `/api/v1/api/v1/...`** corrigé (les chemins OpenAPI portent déjà
  le préfixe ; `baseUrl` retiré côté Orval).
- **Mutator fetch : statuts ≥ 400 lèvent désormais** (`ApiError` avec corps), pour que TanStack Query
  expose l'erreur et que les écrans affichent les messages de validation (avant : 4xx silencieux).

### Changed
- **Ports hôte peu courants** (anti-collision) : backend `43000`, front dev `45173`, front prod
  `48081`, postgres `45432`, keycloak `48080` (mnémo « 4 » + port usuel ; ports internes inchangés).
- **Config centralisée** : un seul `.env` racine fait foi (ports, creds Postgres, OIDC, médias).
  `DATABASE_URL` n'est plus dupliquée mais **dérivée** de `POSTGRES_*` (+ `POSTGRES_PORT` côté hôte)
  — par compose pour le conteneur, par `prisma.config.ts` pour la CLI. Suppression d'`apps/backend/.env`.
- **Auth recadrée Keycloak → OIDC générique** : colonne `keycloak_sub` → **`oidc_subject`**
  (migration de renommage), `AUTH_MODE=keycloak` → **`oidc`**, env `KEYCLOAK_*` → **`OIDC_*`**.
  Specs reformulées en « compatibilité OIDC », Keycloak présenté comme IdP de référence.
- **Stockage des médias : SeaweedFS/S3 retiré au profit d'un volume local** servi par le backend
  (choix self-hosted, sans brique objet ni dépendance cloud). Service `storage` + volume `storagedata`
  + `S3_ENDPOINT` supprimés du compose (→ volume `mediadata`, `MEDIA_DIR`, `MEDIA_MAX_BYTES`) ;
  specs §16/§2.6 mises à jour.
- **Valeurs d'enum alignées sur le fil** : les membres des enums Prisma portent désormais la valeur
  du domaine en minuscules (`draft`, `host`, `single_choice`…), si bien que l'API REST expose les
  mêmes valeurs que la base et que `@roux-quizz/contracts` (avant : PascalCase côté client Prisma).
  Aucune migration (valeurs en base inchangées).

### Verified
- Tests unitaires : `OidcProvider` validé avec un **vrai keypair RS256** (vraie vérif jose :
  signature/`iss`/`exp`/`aud`), `NoAuthProvider`, `AuthGuard` (401, `@Public`, provisioning).
- Runtime (mode `none`, contre Postgres) : `/me` provisionne des utilisateurs distincts par
  `X-Local-User` (isolation), `/health` public. Mode `oidc` : `/me` sans token → **401**.
- Compatibilité OIDC prouvée **sans instance live** (aucune dépendance à un IdP en dev).

## [0.1.2] - 2026-06-10 — Socle de données (Prisma)

Complète l'item de fondation **P1-DATA-1** (schéma de données + migrations), prérequis du builder v0.2.0.

### Added
- **Schéma Prisma complet** (`apps/backend/prisma/schema.prisma`) : les 10 tables de
  [SPECIFICATIONS-DONNEES](./specifications/SPECIFICATIONS-DONNEES.md) §2 et les 9 énumérations
  natives Postgres §3. Conventions respectées : PK/FK **ULID** `char(26)`, DB en `snake_case`
  (`@map`/`@@map`) / TS en camelCase, `timestamptz`, `citext` (email), relations `ON DELETE CASCADE`
  sur les enfants directs, index de §7, et `quiz_snapshot` JSONB (§2.7).
- **Migration initiale** + migration dédiée aux **CHECK** non exprimables en PSL
  (`time_limit_s` 5–120, `numeric_tolerance ≥ 0`, `size_bytes > 0`).
- **`PrismaService`** (module global NestJS) : connexion/lifecycle, injecté dans tout le backend.
- Scripts backend `db:generate` / `db:migrate` / `db:deploy` ; `postinstall` régénère le client.

### Changed
- **Compose dev** : Postgres exposé sur l'hôte (`POSTGRES_PORT`, défaut 5432) pour la CLI Prisma ;
  le backend applique `prisma migrate deploy` au démarrage (idempotent) → `docker compose up` turnkey.
- **Dockerfile backend** : le schéma Prisma est copié avant l'install pour que `postinstall`
  génère le client typé.

### Notes
- **Prisma 7** : la connexion runtime passe par un **driver adapter** (`@prisma/adapter-pg`) et
  l'URL vit dans `prisma.config.ts` (plus dans le schéma). Le « query compiler » remplace le moteur
  Rust — aucun binaire moteur requis au runtime.
- ULID générés par `@default(ulid())` (couvre uniformément les écritures imbriquées) — toutes les
  propriétés de la spec §0 (format, triable, sans coordination) sont satisfaites.
- La borne haute de taille média reste une politique d'upload applicative (cf. P2-BACK-5).

## [0.1.1] - 2026-06-09 — Outillage des fondations

Complète les items reportés de la 0.1.0 (qualité, hooks, CI, génération de client).

### Added
- **ESLint** (flat config, typescript-eslint) + **Prettier** ; lint/format centralisés à la racine.
- **Husky** + **commitlint** (Conventional Commits) + **lint-staged** :
  `pre-commit` (lint-staged), `commit-msg` (commitlint), `pre-push` (tests).
- **Génération OpenAPI** : script backend qui écrit `openapi/openapi.json` sans démarrer de serveur.
- **Client REST Orval** : hooks **TanStack Query** générés dans `apps/frontend/src/api/generated`
  (client `react-query`, `httpClient: fetch`, `baseUrl: /api/v1`).
- **CI GitHub Actions** : install → contracts → lint → format → typecheck → test → build →
  **check de drift OpenAPI/Orval** (la CI échoue si le client n'est pas régénéré).

### Notes
- Artefacts générés (OpenAPI, client Orval) exclus de Prettier (formatés par leur générateur)
  pour garantir un check de drift déterministe.

## [0.1.0] - 2026-06-09 — Fondations (walking skeleton)

Premier jalon : un squelette qui démarre de bout en bout, sans fonctionnalité métier.

### Added
- **Monorepo pnpm** (workspaces) : `apps/backend`, `apps/frontend`, `packages/contracts`.
- **Package de contrats partagé** (`@roux-quizz/contracts`) : énumérations du domaine
  (états de partie, types de question, points, couleurs/formes) et noms d'événements
  WebSocket — build dual ESM/CJS.
- **Backend NestJS** : squelette + endpoint `GET /health`, OpenAPI auto sur `/api/docs`
  (+ `/api/docs-json` pour Orval), lecture de `AUTH_MODE`.
- **Frontend React + Vite** : page d'accueil, proxy `/api` vers le backend.
- **Dockerisation** : `docker-compose.yml` (postgres, redis, storage SeaweedFS, backend,
  frontend, keycloak sous profil), override de dev avec hot-reload, Dockerfiles multi-stage,
  realm Keycloak minimal, `.env.example`.
- **Tests** : Jest (backend) et Vitest (frontend) — verts.

### Verified
Stack vérifiée **de bout en bout** (`docker compose`), chemins **dev** et **prod** :
- `GET /health` → `200` JSON ; OpenAPI servi sur `/api/docs-json`.
- Frontend servi (Nginx en prod, Vite en dev) ; proxy Nginx `/api` → backend OK.
- Tous les conteneurs `healthy` (postgres, redis, storage SeaweedFS, backend, frontend).

Correctifs trouvés en vérifiant (et non par la seule validation de config) :
- `pnpm deploy` (pnpm v10+) nécessite `--legacy` (sinon `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`).
- Healthcheck backend en `127.0.0.1` (et non `localhost` → busybox tape l'IPv6, refus).
- Healthcheck SeaweedFS sur `:9333/cluster/healthz`.
- Dev : exécuter `nest` directement (la vérif de deps de pnpm 11 échoue sans TTY) et
  ne jamais monter le `node_modules` de l'hôte (glibc) dans Alpine (musl).

### Reporté (à finir en v0.1.x — items de fondation restants)
- CI GitHub Actions (P1-INFRA-4), git hooks Husky/commitlint (P1-INFRA-5).
- Pipeline Orval + check de drift OpenAPI (P1-FRONT-2).
- Configs ESLint + scripts `lint` réels (actuellement référencés mais non configurés).

### Notes
- `AUTH_MODE=none` par défaut : Keycloak n'est pas démarré (profil `keycloak`).
- Ports hôte configurables (`BACKEND_PORT`, `FRONTEND_PORT`, `VITE_PORT`, …) pour éviter
  les collisions avec d'autres stacks locales.
- Prochains jalons : v0.2.0 Builder + Auth, v0.3.0 Jeu de base.
