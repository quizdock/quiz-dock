# Changelog

Toutes les évolutions notables de Roux-Quizz. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/),
versionnement [SemVer](https://semver.org/lang/fr/) (pré-1.0 : `0.MINOR.PATCH`). Voir
[specifications/SPECIFICATIONS-ROADMAP.md](./specifications/SPECIFICATIONS-ROADMAP.md).

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

### Notes
- `AUTH_MODE=none` par défaut : Keycloak n'est pas démarré (profil `keycloak`).
- Prochains jalons : v0.2.0 Builder + Auth, v0.3.0 Jeu de base.
