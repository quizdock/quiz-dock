# Live-Quizz — Feuille de route (jalons, tâches, phases)

> Plan de livraison incrémental, de **v0.1.0** à **v1.0.0**. Chaque jalon = une version livrable et démontrable (`docker compose up`).
> Complète `SPECIFICATIONS.md §15` (découpage) et §18 (Definition of Done). Version 1.0 — 2026-06-09.

---

## 1. Versionnement

**SemVer pré-1.0** (`0.MINOR.PATCH`) — tant qu'on est en `0.x`, chaque **MINOR** = un jalon fonctionnel, l'API peut évoluer.

| Incrément | Quand |
|-----------|-------|
| `0.x.0` (MINOR) | Nouveau jalon de phase atteint (cf. §3) |
| `0.x.y` (PATCH) | Corrections / ajustements sans nouveau périmètre |
| `1.0.0` | **Jalon conditionnel** — voir critères d'éligibilité ci-dessous |

> ⚠️ **La v1.0.0 n'est pas planifiée.** Ce n'est **pas** une étape de cette feuille de route. On sait que de nouvelles fonctionnalités émergeront en cours de développement : elles s'intègrent au fil de l'eau comme des `0.x` supplémentaires (`0.8.0`, `0.9.0`, `0.10.0`, …), sans destination figée. La **v1.0.0 ne sera envisagée que le jour où une version `0.x` se révèle stable et suffisamment complète** — par éligibilité, jamais par calendrier ni par pression de livraison. Le périmètre exact de cette future v1 n'est volontairement pas arrêté ici.

### Critères d'éligibilité (le jour où la v1.0.0 sera envisagée)
Les critères ci-dessous décrivent **ce qu'une version devra satisfaire** pour *prétendre* à `1.0.0` — ils ne planifient pas ce passage. Une version `0.x` ne serait promue `1.0.0` que si **toutes** ces conditions sont réunies :
1. ✅ **Complétude** : tout le périmètre « Must » v1 est livré et utilisé en conditions réelles (métier §13).
2. ✅ **Stabilité** : aucune anomalie bloquante/majeure ouverte ; comportement éprouvé sur plusieurs sessions réelles.
3. ✅ **Robustesse prouvée** : cibles de charge/latence tenues (technique §13) ; reconnexion et reprise validées.
4. ✅ **Sécurité** : revue de sécurité passée (JWT, anti-triche, RGPD) sans réserve critique.
5. ✅ **Qualité** : non-régression complète verte, couverture ≥ seuils, contrats figés.
6. ✅ **Exploitabilité** : doc/runbook complets, migrations et sauvegardes/purge éprouvées.
7. ✅ **Maturité du périmètre** : le rythme de nouvelles features s'est stabilisé (pas de gros chantier en cours), et l'on est prêt à **s'engager sur la stabilité de l'API publique** (REST + contrat WS).

Par défaut, on **reste en `0.x`** : corrections en PATCH, fonctionnalités (planifiées ou émergentes) en MINOR. Aucune échéance n'est fixée pour `1.0.0`.

Tag git par jalon (`v0.1.0`, `v0.2.0`, …). CHANGELOG mis à jour à chaque itération (technique §18).

---

## 2. Vue d'ensemble des jalons

| Version | Jalon | Objectif | Dépend de | Effort indicatif* |
|---------|-------|----------|-----------|-------------------|
| **v0.1.0** | Fondations (walking skeleton) | Monorepo, Docker Compose, CI, schéma BD, squelette auth — bout-en-bout vide qui tourne | — | M |
| **v0.2.0** | Builder + Auth | CRUD quiz/questions (REST+OpenAPI+Orval), auth OIDC hôte, upload média, UI builder | v0.1.0 | L |
| **v0.3.0** | Jeu de base | Lobby PIN, QCM unique, scoring temps, machine à états, leaderboard (Redis+WS), clients apprenant/projeté | v0.2.0 | L |
| **v0.4.0** | Robustesse temps réel | Reconnexion joueur/hôte, compensation latence, adapter Redis multi-instance, tests de charge 200 users | v0.3.0 | M |
| **v0.5.0** | Types de questions | Multi-réponses, vrai/faux, saisie texte, numérique, remise en ordre, sondage | v0.3.0 | M |
| **v0.6.0** | Restitution & reporting | Podium, stats par question, restitution + export CSV, historique apprenant, **capture intégrale** | v0.5.0 | M |
| **v0.7.0** | Finitions | i18n FR/EN, accessibilité, observabilité, modération, polish UX | v0.6.0 | M |
| **v0.8.0** | Durcissement & stabilisation | Revue sécurité, perf, non-régression complète, doc/runbook | v0.7.0 | M |
| **v0.9.0 → 0.x** | *Suite ouverte* | **Features émergentes** + stabilisation continue (non planifiées ici) | v0.8.0 | — |
| ~~v1.0.0~~ | *(non planifiée)* | Envisagée **par éligibilité** seulement (cf. §1), pas par calendrier | — | — |

\* Effort relatif (S/M/L), **pas** une durée calendaire (dépend de la taille d'équipe). Voir §6.

---

## 3. Definition of Done d'un jalon

Un jalon `v0.x.0` est atteint quand **toutes** ses tâches sont :
1. ✅ Implémentées et revues.
2. ✅ Couvertes par tests unitaires + fonctionnels verts (technique §17).
3. ✅ Non-régression complète verte en CI.
4. ✅ Documentées (CHANGELOG + spec/API si changement).
5. ✅ Démontrables via `docker compose up`.
6. ✅ Taguées `v0.x.0`.

---

## 4. Tâches par phase

> Conventions d'ID : `P{phase}-{DOMAINE}-{n}`. Domaines : `INFRA`, `BACK`, `FRONT`, `DATA`, `QA`, `DOC`.
> Référence spec entre parenthèses.

### Phase 1 — v0.1.0 · Fondations
**But** : un squelette qui démarre de bout en bout, sans fonctionnalité métier.

| ID | Tâche |
|----|-------|
| P1-INFRA-1 | Monorepo **pnpm** workspaces : `apps/backend`, `apps/frontend`, `packages/contracts` (technique §2) |
| P1-INFRA-2 | **Docker Compose** : services front, back, postgres, redis, keycloak (profil) + healthchecks ; médias sur volume local (technique §16) |
| P1-INFRA-3 | `.env.example`, profils Compose `dev`/`test`/`keycloak`, Makefile/scripts |
| P1-INFRA-4 | **CI GitHub Actions** : lint, typecheck, tests, build images (technique §17.4) |
| P1-INFRA-5 | Git hooks **Husky** (pre-commit/commit-msg/pre-push) + commitlint (technique §18) |
| P1-BACK-1 | Squelette **NestJS** : healthcheck `/health`, config, logger structuré |
| P1-BACK-2 | Intégration **OpenAPI** (`@nestjs/swagger`) servie sur `/api/docs` |
| P1-BACK-3 | Abstraction **`AuthProvider`** (`NoAuthProvider`/`OidcProvider`) + `AUTH_MODE` (technique §1) |
| P1-DATA-1 | **Schéma Prisma** initial + migrations (toutes tables, **ULID**) (données §2) |
| P1-DATA-2 | Connexion **Redis** + adapter Socket.IO câblé (technique §2) |
| P1-FRONT-1 | Squelette **React+Vite**, **shadcn/ui**, **TanStack Router**, page d'accueil |
| P1-FRONT-2 | Pipeline **Orval** branché sur l'OpenAPI (génération + check de drift) (technique §2.3) |
| P1-DOC-1 | CHANGELOG initial, README à jour |

**Critère de sortie** : `docker compose up` lève toute la stack ; `/health` OK ; front affiche l'accueil ; CI verte ; client Orval généré.

---

### Phase 2 — v0.2.0 · Builder + Auth
**But** : un formateur s'authentifie et crée des quiz complets.

| ID | Tâche |
|----|-------|
| P2-BACK-1 | Intégration **OIDC** : validation JWT (JWKS), rôles `host`/`player`, **Keycloak en IdP de référence** (import realm) (technique §16) |
| P2-BACK-2 | **CRUD Quiz** REST + DTO/OpenAPI (technique §10, RG-01/02) |
| P2-BACK-3 | **CRUD Questions** + options + réordonnancement (RG-03) |
| P2-BACK-4 | Gestion des **types de question** (validation par type) (technique §4) |
| P2-BACK-5 | **Upload média** → volume local servi par le backend (`media_asset`) (données §2.6) |
| P2-BACK-6 | Cycle de vie quiz `draft→ready→archived` + validations (RG-02) |
| P2-FRONT-1 | **Connexion** (OIDC / mode local) |
| P2-FRONT-2 | **Tableau de bord** banque de quiz (TanStack Table/Query) (UI §2.1) |
| P2-FRONT-3 | **Éditeur de quiz** (TanStack Form) : énoncé, options couleur+forme, temps, points (UI §2.2) |
| P2-FRONT-4 | **Prévisualisation** de question (UI §2.3) |
| P2-QA-1 | Tests : CRUD, auth (accès refusé/isolation propriétaire), validations par type (technique §17) |

**Critère de sortie** : un formateur se connecte, crée un quiz multi-questions avec médias, le passe `ready`. Client REST 100 % généré par Orval.

---

### Phase 3 — v0.3.0 · Jeu de base
**But** : jouer une session live de bout en bout avec un seul type de question.

| ID | Tâche |
|----|-------|
| P3-BACK-1 | **WS Gateway** Socket.IO `/game` + contrat partagé `@live-quizz/contracts` (technique §9) |
| P3-BACK-2 | **Création de session** + génération PIN unique (RG-04) (séquences §2) |
| P3-BACK-3 | **Join** invité/connecté + lobby + `sessionToken` (séquences §2) |
| P3-BACK-4 | **Machine à états** LOBBY→…→PODIUM (technique §8) |
| P3-BACK-5 | **Déroulé question** : `question:start` sans réponse correcte (anti-triche §7) |
| P3-BACK-6 | **Soumission + timing serveur** + verrouillage (technique §6, RG-06) |
| P3-BACK-7 | **Scoring** temps + série (technique §5) — *100 % testé* |
| P3-BACK-8 | **Leaderboard** Redis (ZSet) + `reveal`/`leaderboard` events |
| P3-FRONT-1 | **Client apprenant mobile** : rejoindre, attendre, répondre, feedback (UI §5) |
| P3-FRONT-2 | **Écran projeté** : lobby + question (UI §4) |
| P3-FRONT-3 | **Console d'animation** : lobby, pilotage, compteur réponses, classement (UI §3) |
| P3-FRONT-4 | Chrono visuel dérivé des **timestamps serveur** (UI §5.3) |
| P3-QA-1 | Golden tests scoring + tests e2e flux complet (1 hôte + N joueurs) (technique §17.3) |

**Critère de sortie** : démo complète — créer, lancer, 10+ joueurs rejoignent, répondent à des QCM, voient scores/classement/podium.

---

### Phase 4 — v0.4.0 · Robustesse temps réel
**But** : tenir la charge et les aléas réseau.

| ID | Tâche |
|----|-------|
| P4-BACK-1 | **Reconnexion apprenant** (`player:reconnect`, place+score) (séquences §4, technique §11) |
| P4-BACK-2 | **Hôte déconnecté** → pause `HOST_DISCONNECTED` → reprise/fin (séquences §5) |
| P4-BACK-3 | **Compensation de latence** (ping/pong, `latencyMs/2`) (technique §6) |
| P4-BACK-4 | **Adapter Redis multi-instance** validé (rooms synchronisées) (technique §2) |
| P4-BACK-5 | TTL / expiration parties + nettoyage `pin:index` |
| P4-QA-1 | **Tests de charge** k6/Artillery : 200 joueurs/partie, pic de soumissions, cibles latence §13 |
| P4-QA-2 | Tests d'intégration reconnexion joueur/hôte |

**Critère de sortie** : une partie survit à un restart d'instance ; 200 joueurs tiennent les cibles de latence ; reconnexions fonctionnelles.

---

### Phase 5 — v0.5.0 · Types de questions
**But** : couvrir tous les formats d'évaluation.

| ID | Tâche |
|----|-------|
| P5-BACK-1 | **Vrai/Faux** (back + validation) |
| P5-BACK-2 | **QCM multi-réponses** (tout-ou-rien, scoring) (technique §5) |
| P5-BACK-3 | **Saisie texte** : normalisation + `accepted_answer` (données §2.5, RG-06) |
| P5-BACK-4 | **Numérique** : valeur + tolérance (données §2.3) |
| P5-BACK-5 | **Remise en ordre** : séquence correcte (données §2.4) |
| P5-BACK-6 | **Sondage** (0 point) |
| P5-FRONT-1 | Composants de réponse dédiés par type (saisie, curseur, drag-order) (UI §5.3) |
| P5-FRONT-2 | Builder : édition spécifique par type (UI §2.2) |
| P5-QA-1 | Tests unitaires scoring/validation par type + e2e |

**Critère de sortie** : les 7 types jouables de bout en bout, builder + gameplay + scoring corrects.

---

### Phase 6 — v0.6.0 · Restitution & reporting
**But** : restituer et tracer les résultats (cœur formation).

| ID | Tâche |
|----|-------|
| P6-BACK-1 | **Consolidation** fin de session Redis→PG (`game_session_log` + snapshot quiz) (séquences §6, données §2.7) |
| P6-BACK-2 | **`player_result_log`** + classement final + départage (RG-08/09) |
| P6-BACK-3 | **`question_result_stat`** (taux, distribution, temps) (données §2.9) |
| P6-BACK-4 | **Export CSV** des résultats (technique §10) |
| P6-BACK-5 | **Historique apprenant** connecté (`/me/history`) |
| P6-BACK-6 | **Mode capture intégrale** : `full_capture`, `answer_log`, event `notice` (données §2.10, RG-13) |
| P6-FRONT-1 | **Podium** (apprenant + projeté) (UI §5.5) |
| P6-FRONT-2 | **Restitution** formateur : synthèse + analyse par question (UI §6) |
| P6-FRONT-3 | **Avis capture intégrale** + case au lancement (UI §3.1, §5.2 bis) |
| P6-FRONT-4 | **Historique apprenant** (UI §7) |
| P6-QA-1 | Tests consolidation, export, capture intégrale (présence/absence `answer_log`) |

**Critère de sortie** : fin de session → restitution exploitable + export CSV ; capture intégrale opérationnelle avec avis.

---

### Phase 7 — v0.7.0 · Finitions
**But** : qualité produit et exploitabilité.

| ID | Tâche |
|----|-------|
| P7-FRONT-1 | **i18n** FR/EN (libellés externalisés) (technique §13) |
| P7-FRONT-2 | **Accessibilité** : contraste AA, clavier, tailles tactiles, couleur+forme vérifiés |
| P7-BACK-1 | **Observabilité** : métriques (parties actives, sockets, latence), traces, logs |
| P7-BACK-2 | **Modération** : filtre pseudos, exclusion (`host:kick`) (RG-06/12) |
| P7-ALL-1 | Polish UX, états d'erreur/vides, messages transverses (UI §8) |
| P7-QA-1 | Tests d'accessibilité + i18n |

**Critère de sortie** : app bilingue, accessible, observable, modérable.

---

### Phase 8 — v0.8.0 · Durcissement & stabilisation
**But** : rendre la base solide et exploitable (sans viser une « release v1 » figée).

| ID | Tâche |
|----|-------|
| P8-QA-1 | **Revue de sécurité** (JWT, CORS, rate-limit, anti-triche, RGPD) (technique §13) |
| P8-QA-2 | **Non-régression complète** + couverture ≥ seuils ; tests de contrat figés |
| P8-INFRA-1 | Build images **prod** (multi-stage), `docker-compose.yml` prod-like, secrets |
| P8-INFRA-2 | Stratégie de **migrations** + sauvegarde/purge (rétention RG-11) |
| P8-DOC-1 | Doc d'exploitation : runbook, OpenAPI publiée, guide formateur |
| P8-QA-3 | Recette globale sur tous les parcours (métier §6) |

**Critère de sortie** : base durcie, audité, documentée, taggée **v0.8.0**.

---

### Au-delà — v0.9.0 → 0.x · Suite ouverte
**But** : intégrer les **fonctionnalités émergentes** (identifiées en cours de dev) et poursuivre la stabilisation, **sans jalon de release planifié**.

- Chaque nouvelle feature = un MINOR `0.x` avec son propre lot de tâches, tests et doc (même DoD, §3).
- Le backlog connu (§7) et les besoins découverts alimentent ces versions au fil de l'eau.
- La **v1.0.0 reste hors plan** : elle ne sera envisagée que si/quand une version `0.x` satisfait **tous** les critères d'éligibilité (§1).

---

## 5. Dépendances & chemin critique

```
v0.1.0 ─▶ v0.2.0 ─▶ v0.3.0 ─┬─▶ v0.4.0 ─┐
                             │           ├─▶ v0.6.0 ─▶ v0.7.0 ─▶ v0.8.0 ─▶ 0.9.0 → 0.x …
                             └─▶ v0.5.0 ─┘                                  (suite ouverte)

                                   (v1.0.0 : hors plan, par éligibilité uniquement — §1)
```

- **Chemin critique** : Fondations → Builder → Jeu de base (tout en dépend).
- **Parallélisable** après v0.3.0 : Robustesse (v0.4.0) et Types de questions (v0.5.0) peuvent avancer en parallèle si l'équipe le permet ; v0.6.0 attend les deux.
- **Suite ouverte** après v0.8.0 : les `0.x` s'enchaînent au gré des features émergentes ; pas de point d'arrivée figé.
- **Transverses** (présents à chaque phase, pas un jalon séparé) : tests, doc, accessibilité de base.

---

## 6. Planification calendaire

L'effort est donné en relatif (S/M/L) **car les dates dépendent de la capacité d'équipe**. Pour passer à un planning daté, fixer :
- taille et composition de l'équipe (back/front/devops) ;
- capacité par sprint (ex. sprints de 2 semaines) ;
- jours fériés / congés.

> Hypothèse de référence (à valider) : 1 jalon MINOR ≈ 1 à 3 sprints selon S/M/L, équipe de 2–3 devs. Je peux produire un **planning daté** (Gantt / sprints) dès que ces paramètres sont fixés.

---

## 7. Backlog des features candidates (rappel)

Alimente les `0.x` à venir (§ « Suite ouverte »), au fil des priorités et des besoins émergents — **sans rattachement à un jalon de release** :

Mode **équipes** · mode **asynchrone/devoir** · **partage**/bibliothèque publique · **dashboard admin** agrégé · **AsyncAPI** pour le WS · génération de questions par IA · **générateur d'avatars** (multiavatar : avatar déterministe dérivé du pseudo, affiché lobby/classement/podium — cosmétique côté client, sans impact sur le contrat live). Détail : métier §4 / §13.

> Cette liste n'est pas exhaustive : de nouvelles fonctionnalités apparaîtront en cours de développement et viendront s'y ajouter.
