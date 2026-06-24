# QuizDock — Spécifications de la partie live

> Cadrage **détaillé** de l'animation temps réel : architecture multi-fenêtres du
> présentateur, écrans joueurs, attachement/reconnexion, et liaison de chaque
> état de partie à un écran. Approfondit et **ne duplique pas** : machine à états
> (technique §8), contrat WebSocket (technique §9), reconnexion (technique §11),
> anti-triche (technique §7), scoring (technique §5/§6), wireframes (UI §3–§5).
>
> Statut : **spécification** (sert de référence à l'implémentation `P3-FRONT-2/3/4`
> et aux compléments backend listés au §10). Aucune de ces sections n'est encore
> codée sauf mention contraire.

---

## 1. Objet & motivation

La fondation backend de la boucle live existe (création de partie, lobby, machine
à états, scoring, reveal/leaderboard/podium). Manquent **les écrans de jeu** et
**trois comportements robustes** explicitement demandés :

1. **Présentateur multi-fenêtres** : un **écran projeté** (grand écran/vidéoproj)
   *et* un **tableau de bord de contrôle** séparés, ouvrables indépendamment,
   **éventuellement sur deux ordinateurs différents**.
2. **Rejoindre une partie en cours** : un joueur arrivé en retard doit pouvoir
   entrer alors que la partie a déjà démarré.
3. **Persistance navigateur** : une partie lancée dans un navigateur doit pouvoir
   être **retrouvée si elle est toujours en cours** après fermeture/réouverture —
   côté présentateur **comme** côté joueur.

S'y ajoutent deux gaps identifiés à la revue et traités ici :

- **Présentateur qui quitte** → aujourd'hui les joueurs ne voient **aucune erreur**
  (il n'existe pas de `handleDisconnect` ; l'état `HOST_DISCONNECTED` n'est jamais
  posé). À spécifier (§7).
- **Comptage « tous ont répondu »** basé sur le total de joueurs *jamais* connectés
  et non sur les **connectés** → la convergence anticipée casse dès qu'un joueur se
  déconnecte. À corriger (§8).

---

## 2. Acteurs, fenêtres et rôles socket

| Fenêtre | Qui | Auth | Socket | Pilote `host:*` ? | Contenu |
|---|---|---|---|---|---|
| **Contrôle** (dashboard) | présentateur | **requise** (hôte) | hôte (attaché à la partie) | **oui** | compteur de réponses, répartition, classement, boutons (révéler / suivant / pause / terminer / exclure) |
| **Projeté** (grand écran) | présentateur (ou poste dédié) | **non** | **spectateur** (room en lecture seule) | non | énoncé, options (sans bonne réponse), chrono, compteur, classement, podium |
| **Joueur** | apprenant | optionnelle (invité ou SSO) | joueur | non | énoncé minimal, grille de réponses, feedback perso, rang |

> **Une seule partie, plusieurs fenêtres.** La partie est identifiée par son **PIN**
> côté Redis (état §technique 8). Chaque fenêtre est un **socket distinct** qui
> s'attache à la room `pin` selon son rôle. Aucune fenêtre n'est « maître » d'une
> autre : elles convergent toutes sur l'état serveur (source de vérité).

---

## 3. Architecture temps réel — décision : socket spectateur (option B)

**Décision arrêtée.** Le projeté est un **socket spectateur** qui rejoint la room
`pin` en **lecture seule**. Il reçoit les events de room déjà diffusés
(`game:state`, `question:start`, `question:reveal` avec `yourResult` absent,
`leaderboard` avec `you` absent, `game:podium`, `answer:count`) — **sans aucun
calcul serveur supplémentaire**, le reveal et le classement étant déjà émis
**par socket** (un spectateur reçoit naturellement la version « sans résultat
personnel »).

**Pourquoi pas le relai `BroadcastChannel` (option A, écartée).** A consiste à
ouvrir le projeté comme fenêtre esclave de la fenêtre de contrôle, alimentée par
`BroadcastChannel`. Écartée car :
- **ne traverse pas deux machines** — or l'exigence est explicitement « deux
  ordinateurs différents » ;
- l'onglet de contrôle passe en arrière-plan quand le présentateur regarde le
  projeté → **throttling** du relai (chrono/compteur qui figent) ;
- le projeté ne peut **pas se recharger/récupérer** seul (esclave sans socket) ;
- testerait un chemin de relai inédit au lieu du **contrat WS déjà éprouvé**.

> Coût backend de B : **un handler `spectator:join {pin}`** (~10 lignes) qui fait
> `socket.join(pin)` sans créer d'enregistrement joueur. Les spectateurs **ne
> polluent rien** : absents du hash `players`, ils n'affectent ni `answer:count`
> ni la convergence « tous ont répondu » (§8).

Un spectateur **n'émet jamais** d'event de jeu ; toute tentative est ignorée
(les events `host:*` exigent l'identité hôte, `player:submit` exige un `playerId`).

---

## 4. Ouverture des fenêtres depuis le détail du quiz

### 4.1 Lancement et liens

Depuis le **détail du quiz** (éditeur, quiz `ready`), le présentateur :

1. clique **« Présenter »** → `host:create {quizId}` crée la partie et renvoie le
   **PIN** (la fenêtre courante devient la fenêtre de **contrôle**, attachée à la room) ;
2. le détail du quiz affiche alors un **panneau de partie en cours** exposant
   **trois accès indépendants**, chacun **copiable et ouvrable** (y compris sur un
   autre poste) :

| Accès | Route | Auth | Usage |
|---|---|---|---|
| **Contrôle** | `/present/$pin/control` | requise (hôte) | tableau de bord & contrôles |
| **Projeté** | `/present/$pin/screen` | non | grand écran à vidéoprojeter |
| **Rejoindre** | `/join/$pin` (+ QR) | non | lien/QR distribué aux joueurs |

> Les slugs sont en **anglais** (cohérence `/login`, `/dashboard`, `/present`,
> `/join`). Le panneau affiche aussi le **PIN en clair + QR** (cf. partage déjà
> livré, P3-FRONT-1) et un bouton **« Partager »**.
>
> **État actuel (interim)** : une seule route `/present/:pin` (lobby hôte mono-fenêtre,
> P3-FRONT-1) existe. Le découpage **contrôle / projeté** ci-dessus est la **cible** à
> implémenter (P3-FRONT-2/3) ; `/present/:pin` actuel deviendra `/present/$pin/control`.

### 4.2 Attachement cross-device

- **Contrôle sur un 2ᵉ ordinateur** : la fenêtre s'ouvre sur `/present/$pin/control`,
  s'authentifie comme hôte, puis émet **`host:attach {pin}`** ; le serveur vérifie
  `meta.hostUserId === user.id` (RG anti-usurpation §7) et **rebinde** ce socket à la
  room. L'**identité hôte est la clé** : aucun jeton secret à transporter dans l'URL.
  *(Mode `none` : l'hôte se ré-identifie par le même nom local → même `sub`. Mode
  `oidc` : même compte. Limite du mode `none` documentée, technique §1.)*
- **Projeté sur un 3ᵉ ordinateur** : ouvre `/present/$pin/screen` → `spectator:join {pin}`.
  Aucune auth ; le PIN suffit (écran public, jamais de bonne réponse, §7).

> Plusieurs fenêtres de contrôle et plusieurs projetés peuvent coexister (ex. deux
> salles). Tous convergent sur l'état serveur ; les boutons de contrôle restent
> **idempotents** (verrous NX déjà en place : reveal-lock, advance-lock).

---

## 5. Rejoindre une partie en cours (late join)

**Exigence : un joueur doit pouvoir rejoindre une partie déjà démarrée.**

`player:join {pin, nickname}` est **autorisé tant que la partie n'est pas terminée**
(états `LOBBY`, `QUESTION_SHOW`, `ANSWERING`, `REVEAL`, `LEADERBOARD`,
`PODIUM` ; refusé en `ENDED`). Au join, le serveur **renvoie l'état courant** pour
que le client se positionne immédiatement :

- création du joueur (score 0, pseudo unique atomique — inchangé) ;
- émission ciblée d'un **`game:state`** courant + (si `ANSWERING`) du `question:start`
  en cours (mêmes `startedAt`/`endsAt` → le chrono est juste) ou (si `REVEAL`/
  `LEADERBOARD`) du dernier `leaderboard`.

**Règles de scoring du late join :**
- Le retardataire **ne peut pas répondre** à une question dont la fenêtre est déjà
  fermée (rejet `too_late`/hors fenêtre — règle de timing inchangée, §6 technique) ;
  il **observe** jusqu'à la prochaine question.
- S'il arrive **pendant** `ANSWERING` et qu'il reste du temps, il **peut** répondre
  (timing serveur identique). Pas de rattrapage rétroactif des questions manquées :
  son score démarre à 0 et ne compte que les questions auxquelles il a pu répondre.
- Le **classement** le place naturellement (score cumulé) ; aucun traitement spécial.

> Le late join réutilise le `player:joined` (room) → la liste de la fenêtre de
> contrôle et du projeté se met à jour en direct.

---

## 6. Persistance navigateur & reconnexion

**Exigence : une partie en cours doit être retrouvable après fermeture/réouverture
du navigateur**, côté présentateur **et** joueur. L'état vit dans Redis (TTL ~4 h) :
la partie survit aux fenêtres. Il faut donc **ré-attacher** un nouveau socket à la
partie existante.

### 6.1 Côté joueur
- Au join, le client **persiste** `{ pin, sessionToken, playerId, nickname }` dans
  `localStorage` (clé `live.session`).
- À l'ouverture, si une session locale existe **et** que la partie est encore vivante,
  le client émet **`player:reconnect {sessionToken}`** (déjà au contrat §9) → le
  serveur restaure place + score, repasse `connected=true`, et renvoie l'**état courant**
  (comme un late join). Sinon (partie finie/expirée), on nettoie le `localStorage` et
  on retombe sur l'écran *Rejoindre*.
- Un **bandeau** « Reprendre la partie en cours ? » peut être proposé si la session
  locale est encore valide.

### 6.2 Côté présentateur
- Le présentateur authentifié **n'a pas besoin de jeton** : à la réouverture de
  `/present/$pin/control` (ou via « parties en cours » sur le tableau de bord),
  le client émet **`host:attach {pin}`** ; l'**ownership** (`hostUserId`) rouvre la
  room. Reprise des contrôles immédiate.
- Le **tableau de bord** liste les **parties en cours** de l'hôte (clé Redis
  `host:{userId}:games` à introduire) afin de retrouver une partie même sans avoir
  gardé l'URL/PIN.
- La fenêtre **projetée** se reconnecte seule via `spectator:join {pin}` (le PIN est
  dans l'URL) — d'où l'intérêt de l'option B (§3).

> **Limite mono-instance assumée (v1).** Les **timers** de fin de question vivent en
> mémoire process (mémoire `gameplay-v0-3`). Un **redémarrage backend** perd le timer
> courant : la reprise est traitée par P4 (adapter Redis + ré-armement des timers au
> boot depuis `questionEndsAt`). Hors périmètre de cette spec ; ne pas confondre avec
> la reconnexion **client**, qui est, elle, dans le périmètre.

---

## 7. Présentateur déconnecté (`HOST_DISCONNECTED`)

**Gap actuel : aucun `handleDisconnect` → les joueurs ne sont pas prévenus.** À
implémenter.

### 7.1 Détection (backend, nouveau)
- Le gateway implémente `OnGatewayDisconnect`. À la déconnexion d'un socket :
  - si `socket.data.user` est l'hôte d'une partie active (et qu'**aucune autre
    fenêtre de contrôle** de cette partie n'est connectée — comptage des sockets hôtes
    de la room), alors **après un court délai de grâce** (ex. 5 s, pour absorber un
    simple rechargement) : passer l'état en **`HOST_DISCONNECTED`**, **mettre le timer
    en pause** (figer `questionEndsAt` restant), et diffuser `game:state`.
  - si `socket.data.playerId` : marquer le joueur `connected=false` (§8).

### 7.2 UX joueur & projeté
- À réception de `game:state { state: HOST_DISCONNECTED }`, les joueurs et le projeté
  affichent **« Le présentateur s'est déconnecté — partie en pause »** (overlay non
  bloquant, le score/place sont conservés). Aucune réponse n'est acceptée.

### 7.3 Reprise
- Si l'hôte **revient** dans la **fenêtre de reconnexion** (technique §11, défaut
  **120 s**) via `host:attach {pin}`, l'état repart de là où il était : reprise en
  `ANSWERING` avec un `questionEndsAt` recalculé (temps restant figé), ou maintien de
  l'écran courant (`REVEAL`/`LEADERBOARD`). Diffusion d'un `game:state` de reprise.
- Si l'hôte **ne revient pas** dans cette fenêtre, la partie **se termine** et les
  résultats sont persistés en l'état (technique §11) ; `game:ended` est diffusé.
  *(Le TTL Redis ~4 h reste le filet de sécurité absolu en cas de partie orpheline.)*

---

## 8. Déconnexion joueur & comptage des connectés

- À la déconnexion d'un socket joueur : `connected=false` dans le hash `players`
  (place et score **conservés** — il peut revenir via `player:reconnect`). Diffuser
  `player:left { playerId, playerCount }` (où `playerCount` = **connectés**).
- **Correctif de convergence (bug).** « Tous ont répondu → REVEAL anticipé » doit
  comparer le nombre de réponses au **nombre de joueurs connectés**, pas au total
  jamais joint. Sinon un seul départ fige la question jusqu'au timer.
  → la condition devient `answered ≥ count(players where connected)`.
- `answer:count` diffuse `{ answered, total }` avec `total` = **connectés**.

---

## 9. Matrice état → écran (par rôle)

Chaque `GameState` (technique §8) se lie à un rendu et aux events qui le pilotent.
Les wireframes (UI §3–§5) donnent le *look* ; cette matrice donne la *liaison*.

| État | Contrôle (hôte) | Projeté (spectateur) | Joueur | Events déclencheurs |
|---|---|---|---|---|
| `LOBBY` | liste joueurs + capture intégrale + **Démarrer** | PIN/QR + liste joueurs (UI §4.1) | « Tu es dans la partie » (UI §5.2) | `player:joined`/`left` |
| `QUESTION_SHOW`* | n° question + énoncé | énoncé + média, **réponses masquées** | énoncé minimal, grille **verrouillée** | `question:start` (fenêtre de lecture, `startedAt` futur) |
| `ANSWERING` | compteur `x/total`, **Révéler**/**Pause** | énoncé + options (sans bonne réponse) + chrono + compteur (UI §4.2) | grille active, puis « Réponse enregistrée ✓ » (UI §5.3) | `question:start`, `answer:count`, `answer:ack` |
| `REVEAL` | bonne réponse + répartition + classement (UI §3.3) | bonne réponse + répartition | feedback **perso** : juste/faux, points, série, rang (UI §5.4) | `question:reveal` (par socket), `leaderboard` |
| `LEADERBOARD`† | classement + **Question suivante** | classement | « ton rang » | `leaderboard` |
| `PODIUM` | podium + fin | podium (UI §5.5) | podium + ton rang + « Voir mes réponses » | `game:podium` |
| `HOST_DISCONNECTED` | (l'hôte est parti) | « Partie en pause » | « Présentateur déconnecté — en pause » | `game:state` (§7) |
| `ENDED` | retour restitution | écran de fin | « Merci ! » | `game:ended` |

> \* `QUESTION_SHOW` est, côté serveur, la **fenêtre de lecture** intégrée à
> `question:start` (`startedAt` dans le futur). Le client déverrouille la grille à
> `startedAt`. *(Implémenté : l'état serveur passe directement en `ANSWERING` avec
> `startedAt = now + délai`, cf. moteur actuel.)*
> † `LEADERBOARD` est en v1 **fusionné dans `REVEAL`** (le serveur émet
> `question:reveal` puis `leaderboard` au même pas — décision livrée P3-BACK-7). La
> colonne reste pour le mapping d'écran (le contrôle/projeté affichent le classement
> après la révélation).

---

## 10. Extensions nécessaires (à implémenter après cette spec)

### 10.1 Contrat WebSocket (technique §9 + package `@quiz-dock/contracts`)
Nouveaux events à ajouter (typés bout-en-bout) :

| Event | Sens | Payload | Effet |
|---|---|---|---|
| `host:attach` | C→S | `{ pin }` (ack `{ ok }`) | rebinde un hôte authentifié propriétaire à sa partie (reconnexion / fenêtre de contrôle) |
| `spectator:join` | C→S | `{ pin }` (ack `{ ok }`) | rejoint la room en lecture seule (fenêtre projetée) |

Ajustements d'events existants :
- `player:join` : autorisé **hors LOBBY** (sauf `ENDED`) + renvoi de l'**état courant** (§5).
- `player:reconnect` : renvoi de l'**état courant** (§6.1) — déjà au contrat.
- `game:state` : ajouter l'usage `HOST_DISCONNECTED` (déjà dans l'enum).
- `answer:count` / `player:left` : `total`/`playerCount` = **connectés** (§8).

### 10.2 Backend
- `OnGatewayDisconnect` (détection hôte/joueur, délai de grâce, pause timer) — §7.
- `spectator:join` / `host:attach` (ownership) — §3/§4.
- Late join : renvoi d'état + autorisation hors LOBBY — §5.
- Convergence sur **connectés** + `connected` flag — §8.
- Index Redis `host:{userId}:games` (lister les parties en cours d'un hôte) — §6.2.

### 10.3 Frontend (`P3-FRONT-2/3/4`)
- Routes : `/present/$pin/control`, `/present/$pin/screen`, écrans joueur par état.
- Hook machine d'état client (s'abonne à `game:state` + events, rend selon §9).
- Reprise : `localStorage live.session` (joueur) ; panneau « parties en cours » (hôte).
- Avatars (cosmétique §11) en lobby/classement/podium.

---

## 11. Hors périmètre de cette spec / évolutions

- **Reprise après redémarrage backend** (ré-armement timers, adapter Redis) → **P4**.
- **Mode équipes**, asynchrone → backlog (métier §13).
- **Générateur d'avatars** (multiavatar) : avatar **déterministe** dérivé du
  pseudo/seed, affiché en lobby, classement et podium. **Purement cosmétique côté
  client → n'altère pas le contrat live ni le scoring.** Inscrit au backlog
  (roadmap §7, métier §13).
```
