# QuizDock — Spécifications

> Clone de Kahoot : quiz chronométrés multijoueurs, notation au temps de réponse.
> Document de référence pour le développement. Version 1.0 — 2026-06-09.

---

## 1. Vision & périmètre

QuizDock est une plateforme de quiz en temps réel inspirée de Kahoot :

- Un **hôte** crée des quiz (builder) et lance des **parties** (game sessions).
- Des **joueurs** (10 à 200 par partie) rejoignent via un **PIN** et répondent à des questions chronométrées depuis leur appareil.
- Les **points dépendent de l'exactitude ET de la rapidité** de la réponse.
- Un **classement** s'affiche après chaque question et un **podium** clôture la partie.

### Rôles

| Rôle | Authentification | Capacités |
|------|------------------|-----------|
| **Créateur / Hôte** | OIDC (JWT) si activé, sinon mode local | Créer/éditer des quiz, lancer une partie, piloter le déroulé |
| **Joueur invité** | Aucune (PIN + pseudo) | Rejoindre une partie, répondre |
| **Joueur connecté** | OIDC (JWT) optionnel | Idem invité + historique et stats persistés sur son profil |

> **Décision** : modèle d'auth **mixte**. Un joueur peut jouer en invité (PIN + pseudo) ou se connecter pour conserver son historique.

### Auth facultative (mode configurable)

L'authentification complète est **optionnelle** : le projet doit tourner en dev/démo sans IdP. Variable `AUTH_MODE` :

| `AUTH_MODE` | Effet | Usage |
|-------------|-------|-------|
| `none` | Mode local sans IdP ; l'hôte s'identifie par un simple nom local (pas de JWT), service `keycloak` non démarré | Dev, démo, déploiement léger |
| `oidc` | Validation JWT via un fournisseur OIDC (Keycloak en référence) : hôtes via JWT OIDC, joueurs connectés possibles | Prod / multi-utilisateurs sécurisé |

Le backend expose une **interface d'auth** (`AuthProvider`) avec deux implémentations (`NoAuthProvider`, `OidcProvider`) sélectionnées par `AUTH_MODE` ; le reste du code ne dépend pas du provider. `OidcProvider` valide les JWT (signature via JWKS, issuer, audience) de **n'importe quel fournisseur OIDC** conforme — Keycloak est fourni comme **IdP OIDC de référence** pour le dev/démo, derrière un **profil Compose** (`--profile keycloak`) pour ne pas l'imposer.

### Hors périmètre v1
- Mode solo / défi asynchrone.
- Marketplace de quiz publics.
- Application mobile native (web responsive uniquement).
- Paiement / abonnements.

---

## 2. Stack technique

| Couche | Choix | Notes |
|--------|-------|-------|
| Gestionnaire de paquets | **pnpm** | Monorepo (workspaces) front + back + contrats partagés |
| Frontend | **React + Vite + TypeScript** | UI **shadcn/ui** (Radix + Tailwind) + icônes **lucide-react** ; **TanStack** Query/Form/Router/Table ; client REST **généré par Orval** ; `socket.io-client` pour le live |
| Backend | **Node.js + TypeScript (NestJS)** + **Socket.IO** | REST builder avec **OpenAPI auto-généré** ; WS gateways pour le jeu |
| Sync front/back | **OpenAPI → Orval** (REST) + **package de contrats partagé** (WS) | Le REST est régénéré depuis OpenAPI ; le contrat WS est typé en TS partagé |
| Temps réel | **Socket.IO** + **adapter Redis** | Rooms synchronisées entre instances |
| État de partie | **Redis** | Source de vérité du live (état, joueurs, réponses, scores) |
| Persistance durable | **PostgreSQL** | Quiz, questions, résultats finaux, profils |
| Auth | **OIDC (JWT)** — Keycloak en IdP de référence | Hôtes via JWT si `AUTH_MODE=oidc` ; joueurs optionnel |
| Médias | **Volume local** servi par le backend (proxy) | Images/audio des questions (self-hosted, sans service objet) |

### 2.1 Frontend — stack détaillée

Monorepo **pnpm** (workspaces). Application **React + Vite + TypeScript**.

| Brique | Rôle |
|--------|------|
| **shadcn/ui** (Radix UI + Tailwind CSS) | Composants accessibles, possédés dans le repo (pas une dépendance opaque) ; thème, dark mode |
| **lucide-react** | Icônes (compagnon shadcn/ui) : actions du builder, navigation, plein écran, états |
| **TanStack Query** | Cache & état serveur (REST builder, historiques, restitutions) ; invalidation, retry, optimistic update |
| **TanStack Form** | Formulaires du builder (création/édition de quiz et questions), validation typée |
| **TanStack Router** | Routage typé bout-en-bout, chargement de données par route |
| **TanStack Table** | Tableaux (banque de quiz, classements, restitution, analyse par question) |
| **Orval** | Génère hooks **TanStack Query** + client + types TS **à partir de l'OpenAPI** du backend |
| **socket.io-client** | Canal temps réel (gameplay) — hors périmètre Orval/REST |
| State local | **Zustand** pour l'état UI du jeu (état de partie courant, chrono visuel) |

### 2.2 Backend — choix Node vs Python (tranché)

**Décision : Node.js + TypeScript (NestJS).** Pour ce projet « WebSocket réactif », Node l'emporte :

- **End-to-end TypeScript** : le contrat WebSocket (events §9) est défini une fois en TS et **partagé** front/back via un package du monorepo (`@quiz-dock/contracts`) — impossible à obtenir avec un backend Python (Orval ne couvrant pas le WS, on perdrait le typage du live).
- **Socket.IO est natif côté Node** : adapter Redis, rooms, reconnexion, namespaces — exactement la stack temps réel déjà spécifiée (§9, §11). `python-socketio` existe mais est secondaire.
- **NestJS** apporte les deux besoins clés dans un seul cadre :
  - **REST avec OpenAPI auto-généré** via `@nestjs/swagger` (décorateurs sur DTO → spec OpenAPI servie sur `/api/docs-json`).
  - **WebSocket Gateways** Socket.IO intégrées, avec injection de dépendances (utile pour l'abstraction `AuthProvider`, §1) et testabilité.
- Un seul langage sur tout le monorepo → DTO/schemas Zod réutilisés pour validation runtime **et** génération OpenAPI.

> **Décision verrouillée : NestJS.** Alternatives évaluées puis écartées :
> - **Python (FastAPI)** — excellent OpenAPI auto, mais casse l'unité de typage du temps réel (contrat WS non partageable) et dédouble le langage.
> - **Node + Fastify** + `@fastify/swagger` + `zod-to-openapi` — plus léger, même résultat OpenAPI→Orval, mais Socket.IO à brancher manuellement et moins de structure (DI/testabilité) pour le contexte entreprise. Écarté au profit du cadre intégré NestJS.

### 2.3 Boucle de synchronisation front/back

```
DTO/schemas backend (NestJS, décorés / Zod)
        │  build
        ▼
OpenAPI 3.x auto-généré  ──servi sur──▶ /api/docs (Swagger UI) + /api/docs-json
        │
        ▼  pnpm orval  (CI + script local)
Hooks TanStack Query + client + types TS  ──importés par──▶ Frontend
```

- **REST (builder, restitutions, historique)** : 100 % généré par **Orval** depuis l'OpenAPI ; aucune écriture manuelle d'appels HTTP côté front. Régénération en CI ; **drift détecté** si le client généré diffère du committé (test de non-régression de contrat, cf. §17.3).
- **WebSocket (gameplay)** : **non couvert par OpenAPI/Orval**. Le contrat (§9) vit dans le package partagé `@quiz-dock/contracts` (types d'events + schemas de validation), importé par le backend (gateways) et le frontend (`socket.io-client`) → typage de bout en bout sans génération.
- **AsyncAPI** (optionnel, v1.1) : documenter le contrat WS au format AsyncAPI pour une doc générée symétrique à l'OpenAPI.

### Pourquoi Redis pour l'état live
- Survit à un redémarrage d'instance (pas de perte de partie en cours).
- Permet le **scaling horizontal** : plusieurs instances Node servent la même partie via l'adapter Redis (pub/sub des events de room).
- TTL automatique pour nettoyer les parties abandonnées.
- Postgres ne reçoit que les **résultats consolidés** en fin de partie (pas d'écriture à chaque réponse → latence maîtrisée).

---

## 3. Modèle de données

### 3.1 Persistant (PostgreSQL)

```
User            id, oidc_subject, display_name, email, role, created_at
Quiz            id, owner_id (User), title, description, cover_media_id,
                visibility (private|unlisted), language, created_at, updated_at
Question        id, quiz_id, order_index, type (enum), prompt, media_id,
                time_limit_s, points_mode (standard|double|none), created_at
AnswerOption    id, question_id, order_index, text, media_id, is_correct,
                (numeric: value, tolerance) -- selon type
GameSessionLog  id, quiz_id, host_id, pin, started_at, ended_at, player_count
PlayerResultLog id, session_log_id, user_id (nullable), nickname,
                final_score, final_rank, correct_count, avg_response_ms
MediaAsset      id, owner_id, url, mime, size_bytes, created_at
```

> `AnswerOption.is_correct` et les `value/tolerance` ne quittent **jamais** le serveur vers les joueurs avant le reveal (cf. §7).

### 3.2 Live (Redis)

Clés (TTL ~ durée de partie + marge, ex. 4 h) :

```
game:{pin}                  Hash  -> state, quizId, hostId, currentQuestionIndex,
                                     questionStartedAt (ms epoch serveur),
                                     questionEndsAt, createdAt
game:{pin}:players          Hash  -> playerId => {nickname, userId?, connected,
                                     score, streak, joinedAt}
game:{pin}:answers:{qIdx}   Hash  -> playerId => {optionId|value, receivedAt,
                                     latencyMs, isCorrect, pointsAwarded}
game:{pin}:leaderboard      ZSet  -> playerId scored by score
session:{token}             Str   -> playerId (reconnexion)
pin:index                   Set   -> PINs actifs (unicité)
```

---

## 4. Types de questions & règles de scoring

| Type | Réponse joueur | Bonne réponse | Scoring |
|------|----------------|----------------|---------|
| **QCM réponse unique** | 1 option (couleur/forme) | 1 option correcte | Standard (cf §5) |
| **QCM multi-réponses** | N options | ensemble correct | Tout-ou-rien v1 (option : partiel proportionnel) |
| **Vrai / Faux** | 1 parmi 2 | 1 correcte | Standard |
| **Saisie texte** | texte libre | liste de réponses acceptées (normalisées : casse, accents, espaces) | Standard ; pas de bonus rapidité réduit si tolérance floue |
| **Curseur / numérique** | valeur | valeur cible ± tolérance | Standard si dans tolérance |
| **Remise en ordre** | séquence | séquence exacte | Tout-ou-rien v1 |
| **Sondage** | 1 option | aucune | **0 point** (collecte d'opinion) |

### Accessibilité des réponses
Chaque option QCM a une **couleur ET une forme** (triangle/losange/cercle/carré) pour les daltoniens.

---

## 5. Algorithme de scoring (cœur produit)

### Principe
Une bonne réponse rapide rapporte plus qu'une bonne réponse lente. Une mauvaise réponse rapporte 0.

### Formule (par question)

```
Soit:
  P_max  = points de base de la question (défaut 1000 ; 2000 si points_mode=double ; 0 si none)
  t      = temps de réponse du joueur en secondes (horodaté serveur, cf §6)
  T      = time_limit_s de la question

Si réponse incorrecte OU hors délai:
  points = 0

Si réponse correcte:
  ratio  = clamp(t / T, 0, 1)
  points = round( P_max * (1 - ratio / 2) )
  # => réponse instantanée: P_max ; au temps limite: P_max / 2
```

### Bonus de série (streak)
- Compteur de bonnes réponses consécutives par joueur.
- Bonus additionnel : `+ min(streak - 1, 5) * 100` points sur une bonne réponse (cap à +500).
- Le streak retombe à 0 sur une mauvaise réponse ou un timeout.

### Égalités
En cas d'égalité de score final, départage par : (1) temps de réponse cumulé le plus faible, (2) ordre d'arrivée dans la partie.

### Multi-réponses — option scoring partiel (v1.1)
```
points = P_max_temps * (bonnes_cochées - mauvaises_cochées) / total_bonnes   (planché à 0)
```

---

## 6. Fairness du chronomètre (timing autoritatif)

**Le serveur fait foi sur le temps.** Aucun calcul de score ne dépend de l'horloge du client.

1. À l'`question_start`, le serveur fixe `questionStartedAt` et `questionEndsAt` (epoch serveur) et les diffuse.
2. Le client affiche un compte à rebours **purement visuel** dérivé de ces timestamps + offset mesuré.
3. À la réception d'un `submit_answer`, le serveur **réhorodate** (`receivedAt`) et calcule `t = receivedAt - questionStartedAt`.
4. **Compensation de latence** : au `join`, on mesure un RTT (ping/pong) ; on soustrait `latencyMs/2` de `t` (planché à 0) pour ne pas pénaliser une connexion lente.
5. **Verrouillage serveur** : toute réponse reçue après `questionEndsAt + grace(ex. 300 ms)` est rejetée (`points = 0`, statut `late`).
6. **Une seule réponse** par joueur et par question : les soumissions ultérieures sont ignorées (pas de changement d'avis v1).

---

## 7. Anti-triche (règles fermes)

- **Jamais** envoyer `is_correct`, la `value` cible ou la séquence correcte au client avant l'événement `reveal`.
- Le payload `question_start` ne contient que : prompt, média, options (texte/couleur/forme, **sans** flag correct), temps limite, points de base.
- Validation de l'exactitude **exclusivement côté serveur**.
- Limitation de débit sur `submit_answer` (1 acceptée / question / joueur).
- PIN à usage unique pour une session, invalidé en fin de partie.
- Pseudos : filtre anti-abus (longueur, liste noire), dédoublonnage dans une partie.

---

## 8. Machine à états de la partie

> Liaison de chaque état aux **écrans** (contrôle / projeté / joueur) et au
> multi-fenêtres présentateur : voir **[SPECIFICATIONS-LIVE.md](./SPECIFICATIONS-LIVE.md)**.

```
        host crée
          │
          ▼
  ┌──────────────┐  host démarre   ┌──────────────┐
  │    LOBBY     │ ───────────────▶│ QUESTION_SHOW│ (affiche l'énoncé, pas encore les réponses)
  │ (PIN, join)  │                 └──────┬───────┘
  └──────────────┘                        │ délai lecture / host
          ▲                                ▼
          │                         ┌──────────────┐  timer écoulé OU
   (nouvelle partie)                │  ANSWERING   │  tous ont répondu
                                    └──────┬───────┘
                                           ▼
                                    ┌──────────────┐
                                    │   REVEAL     │ (bonne réponse + répartition)
                                    └──────┬───────┘
                                           ▼
                                    ┌──────────────┐  question suivante
                                    │ LEADERBOARD  │ ──────────┐
                                    └──────┬───────┘           │
                                           │ dernière question │
                                           ▼                   │
                                    ┌──────────────┐           │
                                    │   PODIUM     │           │
                                    └──────┬───────┘           │
                                           ▼                   │
                                    ┌──────────────┐           │
                                    │    ENDED     │ ◀─────────┘ (boucle vers QUESTION_SHOW)
                                    └──────────────┘
```

### Transitions
- `LOBBY → QUESTION_SHOW` : déclenchée **manuellement par l'hôte** (« Démarrer »).
- `QUESTION_SHOW → ANSWERING` : auto après court délai de lecture (configurable, défaut 3 s) ou clic hôte.
- `ANSWERING → REVEAL` : **timer écoulé** OU **tous les joueurs connectés ont répondu**.
- `REVEAL → LEADERBOARD` : auto (défaut 4 s) ou clic hôte.
- `LEADERBOARD → QUESTION_SHOW` (suivante) ou `→ PODIUM` (si dernière) : clic hôte.
- Tout état `→ ENDED` : si l'hôte termine la partie.

### Vues par rôle
- **Hôte (écran partagé/projecteur)** : compteur de réponses reçues, répartition, classement, contrôles.
- **Joueur** : énoncé minimal puis grille de réponses, feedback (juste/faux + points gagnés), son rang.

---

## 9. Contrat d'événements WebSocket (Socket.IO)

> Namespace `/game`. Tous les events serveur→client incluent `pin`. Payloads typés (TypeScript partagé front/back).

### Client → Serveur

| Event | Payload | Émetteur | Effet |
|-------|---------|----------|-------|
| `host:create` | `{ quizId, fullCapture? }` | hôte | Crée la partie, renvoie le PIN ; `fullCapture` active le mode capture intégrale |
| `host:start` | `{ pin }` | hôte | LOBBY → QUESTION_SHOW |
| `host:next` | `{ pin }` | hôte | Question suivante / podium |
| `host:reveal` | `{ pin }` | hôte | Force le reveal |
| `host:kick` | `{ pin, playerId }` | hôte | Exclut un joueur |
| `host:end` | `{ pin }` | hôte | Termine la partie |
| `player:join` | `{ pin, nickname, authToken? }` | joueur | Rejoint le LOBBY ; renvoie `sessionToken` |
| `player:reconnect` | `{ sessionToken }` | joueur | Reprend sa place et son score |
| `player:submit` | `{ pin, questionIndex, answer }` | joueur | Soumet une réponse |
| `ping` | `{ t0 }` | tous | Mesure de latence (réponse `pong`) |

### Serveur → Client

| Event | Payload | Destinataires |
|-------|---------|---------------|
| `game:created` | `{ pin }` | hôte |
| `notice` | `{ fullCapture: true }` | joueur (au join, si capture intégrale active — avis avant collecte) |
| `player:joined` | `{ playerId, nickname, playerCount }` | hôte + joueurs (liste lobby) |
| `player:left` | `{ playerId, playerCount }` | room |
| `game:state` | `{ state, questionIndex, totalQuestions }` | room |
| `question:start` | `{ questionIndex, type, prompt, media?, options:[{id,text,color,shape,media?}], timeLimitS, basePoints, startedAt, endsAt }` | room (**sans** flag correct) |
| `answer:ack` | `{ accepted, receivedAt }` | joueur émetteur |
| `answer:count` | `{ answered, total }` | hôte |
| `question:reveal` | `{ correctOptionIds \| correctValue, distribution, yourResult:{ correct, points, totalScore, rank } }` | room (résultat perso ciblé par socket) |
| `leaderboard` | `{ top:[{nickname, score, rank}], you?:{score,rank} }` | room |
| `game:podium` | `{ podium:[top3], you?:{score,rank} }` | room |
| `game:ended` | `{ }` | room |
| `error` | `{ code, message }` | ciblé |
| `pong` | `{ t0, t1 }` | émetteur |

---

## 10. API REST (builder & administration)

> Base `/api/v1`. JWT OIDC requis (hôte). JSON.

### Quiz
```
GET    /quizzes                 liste des quiz de l'utilisateur
POST   /quizzes                 crée un quiz
GET    /quizzes/:id             détail (avec questions)
PUT    /quizzes/:id             met à jour
DELETE /quizzes/:id             supprime
POST   /quizzes/:id/duplicate   duplique
```

### Questions
```
POST   /quizzes/:id/questions          ajoute une question
PUT    /questions/:qid                  modifie
DELETE /questions/:qid                  supprime
PATCH  /quizzes/:id/questions/reorder   réordonne [{questionId, orderIndex}]
```

### Médias
```
POST   /media        upload (multipart) -> { mediaId, url }
DELETE /media/:id
```

### Résultats
```
GET    /sessions/:sessionLogId/results        classement final
GET    /sessions/:sessionLogId/results.csv     export CSV
GET    /me/history                             historique (joueur connecté)
```

### Validation à la création de question
- `time_limit_s` ∈ [5, 120].
- 2 à 6 options selon le type ; ≥ 1 correcte (sauf sondage).
- Saisie texte : ≥ 1 réponse acceptée.
- Numérique : `value` + `tolerance ≥ 0`.

---

## 11. Reconnexion & robustesse

### Joueur déconnecté
- Au `join`, le serveur émet un `sessionToken` (stocké en `localStorage`).
- Sur coupure, le joueur reste dans `players` avec `connected=false` (score conservé).
- `player:reconnect` restaure place + score + état courant (`game:state` + question en cours si `ANSWERING`).
- Éviction si non reconnecté **avant la fin de partie** (les déconnectés ne bloquent pas la transition `ANSWERING → REVEAL`).

### Hôte déconnecté
- La partie **se met en pause** (gel des timers) et passe en état `HOST_DISCONNECTED`.
- Fenêtre de reconnexion (défaut 120 s) ; au-delà → partie terminée et résultats persistés en l'état.

> Détection (`OnGatewayDisconnect`), délai de grâce, UX joueur/projeté, ré-attachement
> hôte (`host:attach`), late join et persistance navigateur : **[SPECIFICATIONS-LIVE.md](./SPECIFICATIONS-LIVE.md)** §6–§8.

### Pannes d'instance
- L'état vivant étant en Redis, une autre instance reprend la room via l'adapter ; les clients se reconnectent (Socket.IO reconnection automatique).

---

## 12. PIN & cycle de partie

- PIN numérique **6 chiffres**, généré aléatoirement, vérifié unique contre `pin:index`.
- Réessai en cas de collision ; expiration et retrait de l'index en fin de partie.
- Une partie en `LOBBY` expire si non démarrée sous 30 min (TTL Redis).

---

## 13. Exigences non-fonctionnelles

| Domaine | Cible |
|---------|-------|
| **Charge** | 10–200 joueurs / partie ; viser 50 parties simultanées (≈10 000 sockets) |
| **Latence** | Diffusion `question:start` < 150 ms p95 ; ack réponse < 100 ms p95 |
| **Scalabilité** | Horizontale via instances Node + adapter Redis sans état local |
| **Disponibilité** | Reprise de partie après crash d'une instance |
| **Sécurité** | TLS partout ; JWT validés (signature, exp, audience) ; CORS strict ; rate-limit |
| **RGPD** | Pseudos = données perso si joueur connecté ; suppression de compte → anonymisation des logs ; invités non identifiables ; **capture intégrale** opt-in par session avec **avis aux apprenants avant collecte** (cf. données §2.10) |
| **Accessibilité** | Couleur **+** forme ; contraste AA ; navigation clavier ; tailles tactiles |
| **i18n** | FR/EN dès la v1 ; `language` au niveau du quiz |
| **Observabilité** | Logs structurés, métriques (parties actives, sockets, latence), traces |

---

## 14. Risques & décisions ouvertes

| Sujet | Risque | Décision / à trancher |
|-------|--------|------------------------|
| Triche réseau | Lecture du WS pour deviner la bonne réponse | **Résolu** : aucune info de correction avant reveal |
| Fairness latence | Joueurs sur 4G désavantagés | **Résolu** : compensation `latencyMs/2`, timing serveur |
| Scoring multi-réponses | Tout-ou-rien frustrant | v1 tout-ou-rien, partiel en v1.1 (§5) |
| Pic de soumissions | 200 réponses en < 1 s | Pipeline Redis, traitement batch par question |
| Abus de pseudos | Contenu offensant projeté | Filtre + modération hôte (kick) |
| Coût médias | Vidéos lourdes | v1 : images + audio courts uniquement |

---

## 15. Découpage de livraison suggéré

1. **M1 — Builder + Auth** : auth OIDC hôte, CRUD quiz/questions (REST + Postgres), upload média.
2. **M2 — Jeu de base** : lobby PIN, QCM unique, scoring temps, machine à états, leaderboard (Redis + WS).
3. **M3 — Robustesse** : reconnexion joueur/hôte, compensation latence, adapter Redis multi-instance.
4. **M4 — Types avancés** : multi-réponses, saisie texte, numérique, remise en ordre, sondage.
5. **M5 — Finitions** : podium, export CSV, historique joueur connecté, i18n, accessibilité, observabilité.

> **Règle de processus (toutes les milestones)** : à **chaque itération**, on **teste** (la fonctionnalité livrée a ses tests verts) et on **documente** (CHANGELOG + doc technique mis à jour). Une itération n'est « terminée » que si tests + doc sont à jour. Voir §16 et §18.

---

## 16. Dockerisation (Docker Compose)

Tout le projet est conteneurisé et démarrable en une commande : `docker compose up`.

### Services

| Service | Image / build | Rôle | Ports |
|---------|---------------|------|-------|
| `frontend` | build `./frontend` (Vite → Nginx) | SPA React servie en statique | 80 / 5173 (dev) |
| `backend` | build `./backend` (Node + Socket.IO) | REST + WebSocket | 3000 |
| `postgres` | `postgres:16-alpine` | Persistance durable | 5432 |
| `redis` | `redis:7-alpine` | État live + adapter Socket.IO | 6379 |
| `keycloak` | `quay.io/keycloak/keycloak` | IdP OIDC de référence (**profil `keycloak`**, optionnel) | 8080 |

> **Choix du stockage des médias** : pour un déploiement **self-hosted**, on évite toute brique objet (MinIO/SeaweedFS/Garage) et toute dépendance cloud. Les médias sont stockés sur un **volume local** (`MEDIA_DIR`) monté dans le backend, qui les **sert lui-même** via `GET /api/v1/media/:id` (proxy). Simple, direct, sans service supplémentaire. Le passage à un store objet S3-compatible reste possible plus tard si le multi-instance l'exige (volume partagé suffisant en attendant).

### Organisation des fichiers
```
docker-compose.yml            # base (prod-like)
docker-compose.override.yml   # dev : hot-reload, volumes montés, ports exposés
docker-compose.test.yml       # CI : DB éphémère, lance les suites de tests
.env / .env.example           # secrets & config (jamais commiter .env réel)
backend/Dockerfile            # multi-stage (build → runtime slim)
frontend/Dockerfile           # multi-stage (build Vite → Nginx)
```

### Exigences
- **Multi-stage builds** : images runtime minimales (pas de devDependencies en prod).
- **Healthchecks** sur chaque service ; `depends_on: condition: service_healthy` (backend attend postgres + redis + keycloak prêts).
- **Volumes nommés** persistants : `pgdata`, `redisdata`, `mediadata`, realm Keycloak.
- **Réseau interne** dédié ; seuls `frontend` (et `keycloak` si activé) exposés publiquement.
- **Auth optionnelle** : le backend valide les JWT de n'importe quel fournisseur OIDC conforme via `OidcProvider` (config `OIDC_ISSUER` / `OIDC_JWKS_URI` / `OIDC_AUDIENCE` ; issuer attendu et URI JWKS peuvent différer en Docker). Keycloak est l'**IdP OIDC de référence** fourni pour le dev/démo, derrière le profil Compose `keycloak` (`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` pour ce conteneur) ; en `AUTH_MODE=none`, ne pas le démarrer. Realm importé automatiquement au démarrage (`./keycloak/realm-export.json`) : clients, rôles (`host`, `player`), mappers.
- **Variables d'environnement** centralisées dans `.env` (URLs, secrets, identifiants DB) ; `.env.example` documenté et versionné.
- **Migrations** Postgres jouées au boot du backend (ou job dédié) de façon idempotente.
- **Profils Compose** : `--profile dev`, `--profile test` pour ne lancer que le nécessaire.

### Commandes cibles
```bash
docker compose up -d                       # stack complète (dev avec override)
docker compose -f docker-compose.yml up    # mode prod-like
docker compose -f docker-compose.test.yml run --rm backend pnpm test   # tests en CI
docker compose down -v                     # arrêt + purge des volumes
```

---

## 17. Plan de tests

Objectif : **chaque itération livre du code testé**. Aucune fonctionnalité fusionnée sans tests verts. Couverture cible : **≥ 80 %** sur la logique métier (scoring, machine à états, validation), 100 % sur la formule de scoring.

### 17.1 Tests unitaires
Isolés, rapides, sans I/O réseau (DB/Redis mockés ou en mémoire).

**Backend** (**Jest** + ts-jest) — priorités :
- **Scoring** (§5) : réponse instantanée = `P_max` ; au temps limite = `P_max/2` ; incorrecte/hors délai = 0 ; bonus streak (cap +500, reset) ; égalités/départage ; multi-réponses tout-ou-rien puis partiel.
- **Timing** (§6) : calcul de `t`, compensation latence (planché à 0), rejet après `endsAt + grace`, unicité de réponse.
- **Machine à états** (§8) : transitions valides/invalides, garde « tous ont répondu », dernière question → podium.
- **Validation** (§10) : bornes `time_limit_s`, nombre d'options, ≥1 correcte, normalisation saisie texte (casse/accents), tolérance numérique.
- **PIN** : génération, unicité, collision.
- **Anti-triche** : le payload `question:start` ne contient jamais de flag correct (§7).

**Frontend** (**Vitest** + React Testing Library) :
- Composants de réponse (QCM, vrai/faux, curseur, saisie) : rendu couleur **+** forme, états enabled/locked.
- Compte à rebours dérivé des timestamps serveur (pas d'horloge locale).
- Store : transitions d'UI selon `game:state`.

### 17.2 Tests fonctionnels / intégration
Avec services réels (Postgres + Redis éphémères via `docker-compose.test.yml`).

- **REST builder** : CRUD quiz/questions, réordonnancement, upload média, auth JWT (accès refusé sans/mauvais token, isolation par propriétaire).
- **Flux WebSocket de bout en bout** (clients Socket.IO simulés) :
  - Création partie → join (invité + connecté) → start → submit → reveal → leaderboard → podium → end.
  - Scores corrects en fonction du temps simulé.
  - **Reconnexion** joueur (score conservé) et **hôte déconnecté** (pause puis reprise/fin).
  - Transition `ANSWERING → REVEAL` quand tous ont répondu, et au timeout.
- **E2E** (Playwright) : parcours hôte (créer quiz, lancer) + plusieurs joueurs (rejoindre, répondre, voir son rang) sur navigateurs réels.
- **Charge** (k6/Artillery) : 200 joueurs/partie, pic de 200 `submit` simultanés < 1 s ; vérifier cibles latence §13. Smoke à 50 parties parallèles.

### 17.3 Tests de non-régression
- **Suite automatisée rejouée à chaque PR** (CI) : tous les tests unitaires + fonctionnels doivent rester verts avant merge — bloquant.
- **Tests de contrat WebSocket/REST** : schémas des payloads (§9, §10) figés et vérifiés ; tout changement cassant est détecté.
- **Snapshots** des réponses API et des payloads d'événements clés.
- **Golden tests de scoring** : jeu de cas de référence (entrées → points attendus) protégeant la formule §5 contre toute dérive.
- **Tickets de bug** : chaque bug corrigé ajoute un test de non-régression reproduisant le cas avant correction.
- **Tests de migration** : une migration DB ne casse pas un schéma existant (up + rollback testés).

### 17.4 Intégration continue (GitHub Actions)
- Workflows dans `.github/workflows/` : `ci.yml` (PR) et `e2e.yml`.
- Pipeline : `lint → typecheck → tests unitaires → build images → tests fonctionnels (compose.test) → e2e`.
- **Branch protection** sur `main` : merge **bloqué** si une étape échoue ou si la couverture passe sous le seuil ; au moins une relecture requise.
- Rapport de couverture publié à chaque PR (commentaire automatique).
- Cache des dépendances (`actions/setup-node` + `pnpm/action-setup` + cache pnpm) ; matrice front/back.
- Étape **`pnpm orval` + diff** : échoue si le client REST généré diffère du committé (drift OpenAPI, §17.3).

---

## 18. Politique « tester & documenter à chaque itération »

Définition de **« itération terminée »** (Definition of Done) :

1. ✅ Code revu (au moins une relecture).
2. ✅ Tests unitaires + fonctionnels associés **écrits et verts**.
3. ✅ Non-régression : suite complète verte en CI.
4. ✅ Documentation à jour dans le **même commit/PR** :
   - `CHANGELOG.md` (entrée datée par itération).
   - Cette spec (`SPECIFICATIONS.md`) si le comportement change.
   - Doc d'API (OpenAPI pour REST, table d'événements §9 pour WS) si les contrats évoluent.
   - `README` / runbook si la procédure de lancement change.
5. ✅ Démo vérifiable via `docker compose up`.

> Aucune fonctionnalité n'est considérée livrée tant que **tests** ET **documentation** ne sont pas à jour. C'est un critère de merge, pas une étape optionnelle de fin de projet.

### Application via git hooks (Husky)

La DoD est **automatisée**, pas seulement déclarative. Hooks gérés par **Husky** + **lint-staged** :

| Hook | Actions | Objectif |
|------|---------|----------|
| `pre-commit` | `lint-staged` : ESLint + Prettier sur les fichiers stagés, typecheck rapide | Bloquer le commit de code non conforme |
| `commit-msg` | **commitlint** (Conventional Commits) | Messages normalisés → génération auto du CHANGELOG |
| `pre-push` | Tests unitaires (`jest` + `vitest`) sur le périmètre impacté | Empêcher de pousser du rouge |

- **Garde-fou « doc à jour »** : un check (hook ou job CI) signale si du code métier change sans entrée `CHANGELOG.md` ni mise à jour de doc/API associée (avertissement bloquant en CI).
- Les hooks restent **rapides** (le full suite + e2e tournent en CI GitHub Actions, §17.4) pour ne pas pénaliser le flux local ; contournement d'urgence via `--no-verify` documenté mais tracé.
- Installation automatique des hooks au `pnpm install` (script `prepare` → `husky`).
