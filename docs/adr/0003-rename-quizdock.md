# ADR 0003 — Renommage `live-quizz` → `QuizDock`

- **Statut** : implémenté (2026-06-24)
- **Contexte** : `Live-Quizz` (cf. [[0002-rename-live-quizz-et-white-label]]) entre en collision
  frontale avec **[Live Quiz](https://live-quiz.forge.apps.education.fr)**, outil de quiz interactif
  de l'Éducation nationale : nom quasi identique (`live-quiz` vs `live-quizz`), même créneau
  (alternative souveraine à Kahoot), antériorité forte (projet public, médiatisé, hébergé sur la
  forge gouvernementale). SEO inexploitable et confusion garantie. Le positionnement réel du projet
  est par ailleurs le **self-hosted interne en entreprise**, pas l'éducation.

## Décisions

1. **Nouveau nom : `QuizDock`** (marque affichée `QuizDock`, slug/package `quiz-dock`, DB/Docker
   Hub `quizdock`). « Dock » évoque le **déploiement conteneur / self-hosted** (Docker) et le « quai »
   où les joueurs se connectent — cohérent avec le positionnement et le live multijoueur. Disponible
   et *ownable* : npm (`quiz-dock`, `@quiz-dock/*`), domaines (`quizdock.io`/`.app`/`.fr`),
   GitHub, Docker Hub. (`quizdock.com` déjà pris — sans impact, `.io`/`.fr` retenus.)
2. **Périmètre du renommage** (mêmes surfaces que [[0002-rename-live-quizz-et-white-label]]) :
   scope npm `@live-quizz/*` → `@quiz-dock/*`, noms de packages, nom de projet/réseaux/volumes
   Docker, DB (`livequizz` → `quizdock`), realm Keycloak (`live-quizz` → `quiz-dock`), client OIDC
   (`live-quizz-frontend` → `quiz-dock-frontend`), `OIDC_ISSUER` (realm), titres OpenAPI/Swagger,
   code généré Orval, logos par défaut, `APP_NAME` par défaut (`QuizDock`), README/specs.
3. **Conservé volontairement** : le mot **`live`** lorsqu'il décrit la *feature temps réel* et ne
   porte aucun risque marque/SEO — préfixe `localStorage live.*` (sessions/avatars/auth persistés),
   i18n `live.json`, `live-components.tsx`, user/mot de passe Postgres `live` (défaut interne
   surchargeable). Les **identifiants protocole** (events WS `host:*`/`player:*`, `GameState`,
   modèles Prisma) restent inchangés — cf. [[0001-i18n-et-glossaire]].
4. **ADR historiques non réécrits** : `0001` et `0002` gardent le nom `live-quizz` (ils actent des
   décisions passées). De même les entrées CHANGELOG déjà publiées.

## Conséquences

- **+** Plus de collision de marque/SEO ; positionnement self-hosted lisible dès le nom.
- **−** Recréation des volumes Postgres/Keycloak nécessaire (DB `quizdock`, realm `quiz-dock`) —
  données de dev jetables. En dev : `docker compose down -v` puis `up` recrée DB + realm.
- **−** Le scope npm change → `pnpm install` régénère le lockfile (workspace `@quiz-dock/*`).
- Le white-label runtime (cf. [[0002-rename-live-quizz-et-white-label]]) reste le mécanisme de
  marque : une instance peut afficher tout autre nom via `APP_NAME` + `branding/` sans rebuild.

## Reste à faire (non planifié)

- Dé-spécialisation **éducation → entreprise** de la prose README/specs (« formateur/apprenant »
  encore présents) — séparé, hors périmètre de ce simple renommage.
- Renommage éventuel du **dépôt / dossier de travail** (`projects/roux-quizz`) — hors périmètre.
