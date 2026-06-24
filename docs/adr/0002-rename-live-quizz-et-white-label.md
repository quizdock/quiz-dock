# ADR 0002 — Renommage `live-quizz` + white-label (marque configurable)

- **Statut** : implémenté (2026-06-24)
- **Contexte** : le projet `roux-quizz` est renommé en `live-quizz`, et son positionnement
  est dé-spécialisé (on retire le cadrage « formation » des taglines). En complément, la marque
  (nom, logo, styles) doit être **personnalisable au déploiement** sans reconstruire l'image.

## Décisions

1. **Renommage global `roux-quizz` → `live-quizz`** : scope npm (`@live-quizz/*`), noms de packages,
   projet/réseaux/volumes Docker, DB (`livequizz`), user Postgres (`live`), realm Keycloak
   (`live-quizz`), client OIDC, clés `localStorage` (`live.*`), titres Swagger, code généré (Orval
   régénéré). Les **identifiants protocole** (`GameState`, events `host:*`/`player:*`, modèles
   Prisma) restent inchangés — cf. [[0001-i18n-et-glossaire]].
2. **Dé-spécialisation** : la tagline « Quiz interactifs pour la formation » devient
   « Quizz interactif ». Le terme « formation » reste dans les **specs** (prose de domaine), pas
   dans les taglines/headlines ni l'UI.
3. **White-label runtime** (sans rebuild) :
   - **Nom d'app** : variable d'env `APP_NAME` → un entrypoint régénère `/config.js`
     (`window.__APP_CONFIG__`) au démarrage du conteneur. L'app lit `src/config.ts`.
   - **Logo & CSS** : fichiers servis à chemin fixe (`/branding/logo.svg`, `/branding/override.css`),
     **remplaçables par un volume Docker** (`./branding` monté dans la racine servie).
   - Valeurs par défaut bundlées dans `apps/frontend/public/` (build + absence de volume).

## Conséquences

- **+** Une instance se rebrande via `.env` (`APP_NAME`) + le dossier `branding/` — aucune image à
  reconstruire. L'UI ne porte plus de marque en dur (header logo, onglet, partage passent par la config).
- **−** Recréation des volumes Postgres/Keycloak nécessaire pour appliquer les nouveaux noms
  (données de dev jetables — réalisé).
- **−** `config.js` est chargé en bloquant avant le bundle (négligeable, fichier minuscule).

## Reste à faire (non planifié)

- Renommage des **identifiants code** `game` → `session` (events WS, `GameState`, modèles Prisma,
  migrations). Gros blast-radius — séparé, cf. [[0001-i18n-et-glossaire]].
- Renommage éventuel du **dépôt / dossier de travail** (`projects/roux-quizz`) — hors périmètre.
