# QuizDock — Dictionnaire de données

> Détail **niveau colonne** des données persistantes (PostgreSQL) et des structures temps réel (Redis).
> Complète `SPECIFICATIONS.md` §3 (modèle) et `SPECIFICATIONS-METIER.md` §12 (règles de gestion).
> Version 1.0 — 2026-06-09.

---

## 0. Conventions

- **SGBD** : PostgreSQL 16. **ORM** : Prisma — le dictionnaire reste agnostique.
- **Clés primaires** : **ULID** (`char(26)`, Crockford base32), générées côté app (lib `ulidx`). Choisies plutôt qu'UUID : **triables chronologiquement** (ordre d'insertion ≈ ordre temporel → meilleurs index, pagination par curseur naturelle), compactes, sans coordination. Pas d'auto-incrément exposé.
- **Nommage** : colonnes/tables DB en `snake_case` (standard SQL) ; côté TypeScript, types et champs en **camelCase** (standard TS), mapping assuré par l'ORM (Prisma `@map`). Tables au singulier (`quiz`, `answer_option`).
- **Horodatage** : `timestamptz` (UTC). `created_at` / `updated_at` sur toutes les tables métier.
- **Suppression** : *soft delete* via `archived_at`/`deleted_at` là où la conservation l'exige (cf. RG-11) ; suppression dure ailleurs.
- **Argent/score** : `integer` (points entiers).
- **Énumérations** : types `enum` Postgres (cf. §3).
- **Légende colonnes** : PK = clé primaire · FK = clé étrangère · NN = NOT NULL · UQ = unique · IDX = indexé · DEF = défaut.

---

## 1. Vue d'ensemble (relations)

```
user 1───* quiz 1───* question 1───* answer_option
                          │              
                          ├───* accepted_answer        (type = text_input)
                          │
quiz 1───* game_session_log 1───* player_result_log 1───* answer_log  (si full_capture)
                          │       1───* question_result_stat
user 0/1 ──────────────── player_result_log   (participant connecté, nullable)
media_asset *───0/1 quiz | question | answer_option   (cover/illustration)
```

Cardinalités clés :
- Un **quiz** appartient à **un** `user` (animateur). *(RG-01)*
- Une **question** appartient à **un** quiz ; ordre via `order_index`.
- Une **answer_option** appartient à **une** question.
- Un **game_session_log** référence le quiz joué et l'hôte ; il agrège `player_result_log` (1/participant) et `question_result_stat` (1/question).

---

## 2. Tables (PostgreSQL)

### 2.1 `user` — comptes (animateurs, participants connectés, admins)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | Identifiant interne |
| `oidc_subject` | text | UQ, NN | claim `sub` du token OIDC (lien IdP) |
| `display_name` | text | NN | Nom affiché |
| `email` | citext | UQ, nullable | Courriel (si fourni par l'IdP) |
| `role` | enum `user_role` | NN, DEF `player` | `host` \| `player` \| `admin` |
| `locale` | text | DEF `fr` | Langue préférée (`fr`/`en`) |
| `created_at` | timestamptz | NN, DEF now() | Création |
| `updated_at` | timestamptz | NN | Dernière modif |
| `deleted_at` | timestamptz | nullable | Anonymisation RGPD (cf. §6) |

> En `AUTH_MODE=none`, un animateur « local » peut exister sans `oidc_subject` (colonne alors nullable en pratique ; `oidc_subject` porte une valeur sentinelle `local:<nom>`). Les **participants invités ne sont PAS** des lignes `user` (ils n'existent qu'en Redis et dans `player_result_log` sans `user_id`).

### 2.2 `quiz` — quiz (banque privée du animateur)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `owner_id` | char(26) | FK→`user.id`, NN, IDX | Propriétaire (animateur) *(RG-01)* |
| `title` | text | NN | Titre |
| `description` | text | nullable | Description |
| `cover_media_id` | char(26) | FK→`media_asset.id`, nullable | Visuel de couverture |
| `status` | enum `quiz_status` | NN, DEF `draft` | `draft` \| `ready` \| `archived` *(RG-02)* |
| `visibility` | enum `quiz_visibility` | NN, DEF `private` | `private` (v1) ; `unlisted` réservé |
| `language` | text | NN, DEF `fr` | Langue du quiz |
| `question_count` | int | NN, DEF 0 | Dénormalisé (perf listing) |
| `created_at` | timestamptz | NN, DEF now() | |
| `updated_at` | timestamptz | NN | |
| `archived_at` | timestamptz | nullable | Archivage (soft) |

Index : `(owner_id, status)` pour le tableau de bord.
Règle : passage à `status=ready` interdit si `question_count = 0` ou question invalide *(RG-02)*.

### 2.3 `question`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `quiz_id` | char(26) | FK→`quiz.id` ON DELETE CASCADE, NN, IDX | Quiz parent |
| `order_index` | int | NN | Position (0-based) ; UQ `(quiz_id, order_index)` |
| `type` | enum `question_type` | NN | cf. §3 |
| `prompt` | text | NN | Énoncé |
| `media_id` | char(26) | FK→`media_asset.id`, nullable | Illustration |
| `time_limit_s` | int | NN, DEF 20, CHECK 5–120 | Temps limite *(RG-03)* |
| `points_mode` | enum `points_mode` | NN, DEF `standard` | `standard` \| `double` \| `none` (sondage) |
| `numeric_value` | numeric | nullable | Cible (type `numeric`) |
| `numeric_tolerance` | numeric | nullable, CHECK ≥ 0 | Tolérance ± (type `numeric`) |
| `created_at` | timestamptz | NN, DEF now() | |
| `updated_at` | timestamptz | NN | |

CHECK applicatif/SQL selon le type :
- `single_choice`/`multiple_choice`/`true_false`/`ordering` → ≥ 2 `answer_option` (≤ 6) *(RG-03)*.
- `text_input` → ≥ 1 `accepted_answer`.
- `numeric` → `numeric_value` NN + `numeric_tolerance` NN.
- `poll` → `points_mode=none`, pas de bonne réponse.

### 2.4 `answer_option` — options (QCM, V/F, ordre)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `question_id` | char(26) | FK→`question.id` ON DELETE CASCADE, NN, IDX | |
| `order_index` | int | NN | Position d'affichage ; UQ `(question_id, order_index)` |
| `text` | text | nullable | Libellé (nullable si média seul) |
| `media_id` | char(26) | FK→`media_asset.id`, nullable | Média de l'option |
| `color` | enum `option_color` | NN | `red`\|`blue`\|`yellow`\|`green` (+ ext.) |
| `shape` | enum `option_shape` | NN | `triangle`\|`diamond`\|`circle`\|`square` (accessibilité) |
| `is_correct` | boolean | NN, DEF false | Bonne réponse (QCM/V/F). **Jamais exposé avant reveal** (technique §7) |
| `correct_order_index` | int | nullable | Rang attendu (type `ordering`) |

> Pour `ordering`, l'exactitude = séquence des `correct_order_index` ; `is_correct` non utilisé.

### 2.5 `accepted_answer` — réponses acceptées (type `text_input`)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `question_id` | char(26) | FK→`question.id` ON DELETE CASCADE, NN, IDX | |
| `text` | text | NN | Forme acceptée (libellé d'origine) |
| `normalized` | text | NN, IDX | Forme normalisée (minuscule, sans accent/espaces superflus) pour comparaison *(RG-06)* |

### 2.6 `media_asset` — médias

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `owner_id` | char(26) | FK→`user.id`, NN, IDX | Propriétaire |
| `url` | text | NN | Route de service backend (`/api/v1/media/<id>`) ; fichier stocké sur volume local |
| `mime` | text | NN | `image/png`, `audio/mpeg`, … |
| `size_bytes` | bigint | NN, CHECK ≤ limite | Taille |
| `kind` | enum `media_kind` | NN | `image` \| `audio` |
| `created_at` | timestamptz | NN, DEF now() | |

### 2.7 `game_session_log` — session jouée (trace durable)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `quiz_id` | char(26) | FK→`quiz.id`, NN, IDX | Quiz joué (snapshot conseillé, cf. note) |
| `host_id` | char(26) | FK→`user.id`, NN, IDX | Animateur animateur |
| `pin` | char(6) | NN | PIN utilisé (historique ; non unique dans le temps) |
| `status` | enum `session_status` | NN, DEF `ended` | `ended` \| `archived` (le live `lobby`/`in_progress` vit en Redis) |
| `language` | text | NN | Langue de la session |
| `player_count` | int | NN, DEF 0 | Nb d'participants ayant joué |
| `success_rate` | numeric | nullable | Taux de réussite moyen (%) |
| `full_capture` | boolean | NN, DEF false | **Mode capture intégrale** : si vrai, chaque réponse individuelle est persistée (`answer_log`). Décidé à la création de la session ; **participants informés en début de session** (avis affiché, cf. §6) |
| `started_at` | timestamptz | NN | Début effectif |
| `ended_at` | timestamptz | NN | Fin |
| `retain_until` | timestamptz | NN | Échéance de conservation *(RG-11, DEF +24 mois)* |
| `created_at` | timestamptz | NN, DEF now() | |

> **Snapshot recommandé** : pour que la restitution reste fidèle même si le quiz est ensuite modifié/supprimé, stocker un instantané du quiz/questions (JSONB `quiz_snapshot`) au moment de la session. Sinon, une suppression de quiz fausserait l'historique.

### 2.8 `player_result_log` — résultat d'un participant sur une session

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | Session |
| `user_id` | char(26) | FK→`user.id`, **nullable**, IDX | Participant connecté ; NULL si invité |
| `nickname` | text | NN | Pseudo affiché |
| `final_score` | int | NN, DEF 0 | Score final |
| `final_rank` | int | NN | Rang final (1 = meilleur) |
| `correct_count` | int | NN, DEF 0 | Nb de bonnes réponses |
| `answered_count` | int | NN, DEF 0 | Nb de questions répondues |
| `avg_response_ms` | int | nullable | Temps de réponse moyen |
| `max_streak` | int | NN, DEF 0 | Plus longue série |

Index : `(session_log_id, final_rank)` ; `(user_id, session_log_id)` pour l'historique.

### 2.9 `question_result_stat` — agrégat par question (pour la restitution)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | |
| `question_id` | char(26) | FK→`question.id`, NN | Référence (ou index dans le snapshot) |
| `order_index` | int | NN | Position dans la session |
| `correct_count` | int | NN, DEF 0 | Réponses correctes |
| `answer_count` | int | NN, DEF 0 | Réponses reçues |
| `success_rate` | numeric | NN, DEF 0 | % correct |
| `avg_response_ms` | int | nullable | Temps moyen |
| `distribution` | jsonb | NN, DEF '{}' | Répartition par option `{optionId: count}` |

> Ces lignes sont **calculées en fin de session** à partir des données live Redis, puis persistées. Par défaut, les réponses individuelles brutes ne sont pas conservées (seulement agrégées) — minimisation RGPD/volume. Le détail individuel n'est persisté **que si `full_capture = true`** (§2.10).

### 2.10 `answer_log` — réponse individuelle (mode capture intégrale)

> Peuplée **uniquement si** `game_session_log.full_capture = true`. Sinon la table reste vide pour la session. Permet rejeu/audit complet d'une session passée.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | char(26) | PK (ULID, ordonnant) | |
| `session_log_id` | char(26) | FK→`game_session_log.id` ON DELETE CASCADE, NN, IDX | Session |
| `player_result_log_id` | char(26) | FK→`player_result_log.id` ON DELETE CASCADE, NN, IDX | Participant (résultat) |
| `question_id` | char(26) | FK→`question.id`, NN | Question (ou index dans le snapshot) |
| `order_index` | int | NN | Position dans la session |
| `answer_value` | jsonb | NN | Réponse brute (`optionId` \| `[optionIds]` \| texte \| nombre \| `[ordre]`) |
| `is_correct` | boolean | NN | Exactitude calculée serveur |
| `points_awarded` | int | NN, DEF 0 | Points attribués |
| `response_ms` | int | NN | Temps de réponse (après compensation latence) |
| `received_at` | timestamptz | NN | Horodatage serveur de réception |

Index : `(session_log_id, order_index)` ; `(player_result_log_id)`.
> Allonge la durée de conservation et le volume → réservé aux sessions où l'audit/la traçabilité fine est requise (certif, examen blanc). Soumis à la même échéance `retain_until`.

---

## 3. Énumérations

| Enum | Valeurs | Notes |
|------|---------|-------|
| `user_role` | `host`, `player`, `admin` | `admin` réservé v1.1 |
| `quiz_status` | `draft`, `ready`, `archived` | Cycle de vie quiz |
| `quiz_visibility` | `private`, `unlisted` | v1 : `private` seul |
| `question_type` | `single_choice`, `multiple_choice`, `true_false`, `text_input`, `numeric`, `ordering`, `poll` | cf. technique §4 |
| `points_mode` | `standard`, `double`, `none` | `none` = sondage (0 pt) |
| `option_color` | `red`, `blue`, `yellow`, `green` | Extensible si > 4 options |
| `option_shape` | `triangle`, `diamond`, `circle`, `square` | Accessibilité (couleur + forme) |
| `media_kind` | `image`, `audio` | v1 (pas de vidéo) |
| `session_status` | `lobby`, `in_progress`, `ended`, `archived` | `lobby`/`in_progress` n'existent qu'en Redis |

---

## 4. Structures temps réel (Redis)

> État **vivant** d'une partie. TTL ≈ durée de partie + marge (DEF 4 h) ; nettoyage auto des parties abandonnées. Source de vérité du live ; consolidé en base à la fin (§2.7–2.9).

### 4.1 `game:{pin}` — Hash (état de partie)

| Champ | Type | Description |
|-------|------|-------------|
| `state` | string | `LOBBY`\|`QUESTION_SHOW`\|`ANSWERING`\|`REVEAL`\|`LEADERBOARD`\|`PODIUM`\|`ENDED`\|`HOST_DISCONNECTED` |
| `quizId` | string | Quiz joué |
| `hostId` | string | Animateur |
| `hostSocketId` | string | Socket courante de l'hôte |
| `currentQuestionIndex` | int | Index 0-based |
| `questionStartedAt` | int (ms epoch) | Horloge **serveur** (fairness, technique §6) |
| `questionEndsAt` | int (ms epoch) | Fin théorique |
| `fullCapture` | bool | Mode capture intégrale actif → écrit `answer_log` à la fin (§2.10) |
| `createdAt` | int (ms epoch) | Création de la partie |

### 4.2 `game:{pin}:players` — Hash `playerId → JSON`

```jsonc
{
  "nickname": "marc",
  "userId": "uuid|null",      // null = invité
  "connected": true,
  "score": 8120,
  "streak": 3,
  "joinedAt": 1733740800000
}
```

### 4.3 `game:{pin}:answers:{qIdx}` — Hash `playerId → JSON`

```jsonc
{
  "value": "optionId | [optionIds] | texte | nombre | [ordre]",
  "receivedAt": 1733740812345,  // horodatage serveur
  "latencyMs": 42,              // compensation (technique §6)
  "isCorrect": true,
  "pointsAwarded": 850
}
```
> Une seule entrée par `playerId` (1 réponse/question, RG-06). Soumissions ultérieures ignorées.

### 4.4 `game:{pin}:leaderboard` — Sorted Set

- Membre = `playerId`, score = `score`. Lecture top-N + rang en O(log n).

### 4.5 `session:{token}` — String

- `token` (remis au join) → `playerId`. Permet la **reconnexion** (technique §11). TTL = durée de partie.

### 4.6 `pin:index` — Set

- PINs actifs, pour garantir l'**unicité** à la génération *(RG-04)*. Le PIN est retiré en fin de partie.

---

## 5. Contrat partagé (TypeScript)

> Hors base : types du **package `@quiz-dock/contracts`** (technique §2.3), source de vérité du WebSocket. Alignés sur les enums §3. Exemple de structures de payload (référence, pas exhaustif) :

```ts
type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false'
  | 'text_input' | 'numeric' | 'ordering' | 'poll';

interface QuestionStartPayload {            // serveur → client (SANS bonne réponse)
  questionIndex: number;
  type: QuestionType;
  prompt: string;
  media?: { url: string; kind: 'image' | 'audio' };
  options?: { id: string; text?: string; color: string; shape: string }[];
  timeLimitS: number;
  basePoints: number;
  startedAt: number;   // ms epoch serveur
  endsAt: number;
}

interface SubmitAnswerPayload {             // client → serveur
  pin: string;
  questionIndex: number;
  answer: string | string[] | number;
}
```

---

## 6. RGPD, conservation & intégrité

| Règle | Application |
|-------|-------------|
| **Invités non identifiables** | `player_result_log.user_id = NULL`, seul le `nickname` est stocké (donnée non rattachée à une personne). |
| **Suppression de compte** | `user.deleted_at` renseigné ; `display_name`/`email` anonymisés ; `player_result_log.user_id` conservé mais le `nickname` peut être pseudonymisé. Les restitutions agrégées restent. |
| **Conservation** | `game_session_log.retain_until` (DEF +24 mois, RG-11). Purge planifiée au-delà. |
| **Suppression de quiz** | Refusée si des `game_session_log` non purgés y référent **sans snapshot** ; recommandé : snapshot JSONB pour découpler (cf. §2.7). |
| **Réponses brutes** | Par défaut non persistées individuellement (agrégées en `question_result_stat`) → minimisation des données. |
| **Mode capture intégrale** | Si `full_capture = true`, chaque réponse est persistée (`answer_log`). **Activé à la création de la session par le animateur** ; **les participants en sont informés par un avis affiché en début de session** (transparence/consentement) avant toute collecte. Réservé aux besoins d'audit/certification. |
| **Intégrité référentielle** | CASCADE sur les enfants directs (question, option) ; restriction/snapshot pour préserver l'historique de session. |

---

## 7. Index & performance (synthèse)

| Table | Index | But |
|-------|-------|-----|
| `quiz` | `(owner_id, status)` | Tableau de bord animateur |
| `question` | `(quiz_id, order_index)` UQ | Ordre, intégrité |
| `answer_option` | `(question_id, order_index)` UQ | Ordre |
| `accepted_answer` | `(question_id, normalized)` | Comparaison réponse texte |
| `player_result_log` | `(session_log_id, final_rank)` ; `(user_id, session_log_id)` | Classement, historique |
| `question_result_stat` | `(session_log_id, order_index)` | Restitution par question |
| `answer_log` | `(session_log_id, order_index)` ; `(player_result_log_id)` | Rejeu/audit (si capture intégrale) |
| `game_session_log` | `(host_id, started_at)` ; `(retain_until)` | Historique, purge |
