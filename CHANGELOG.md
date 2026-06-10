# Changelog

Toutes les évolutions notables de Roux-Quizz. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/),
versionnement [SemVer](https://semver.org/lang/fr/) (pré-1.0 : `0.MINOR.PATCH`). Voir
[specifications/SPECIFICATIONS-ROADMAP.md](./specifications/SPECIFICATIONS-ROADMAP.md).

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
