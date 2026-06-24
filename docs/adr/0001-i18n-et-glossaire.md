# ADR 0001 — i18n front + glossaire de vocabulaire canonique

- **Statut** : implémenté (Phases 1–3 livrées le 2026-06-24) — glossaire ratifié 2026-06-24.
  Phase ultérieure (rename projet/identifiants code) toujours en attente.
- **Date** : 2026-06-24
- **Contexte** : le vocabulaire métier est incohérent entre le README (registre « formation » :
  formateur / apprenant / session) et le code (registre « jeu » : joueur / partie / game). En
  parallèle, toute la chrome UI est en français codé en dur et le backend laisse fuiter des
  messages d'erreur en français. On veut (1) harmoniser le vocabulaire vers des termes **génériques**
  (ni « jeu », ni « formation ») et (2) poser une infrastructure **i18n** côté front.

## Décisions

1. **Glossaire générique** : on converge sur **session / participant / animateur** (voir tableau).
2. **Backend = tokens uniquement** : le backend n'émet **que des codes** stables, jamais de texte
   destiné à l'utilisateur. Le dictionnaire i18n vit **exclusivement côté front**.
3. **Profondeur du rebrand** : **UI + codes d'erreur backend**. On **ne renomme pas** les
   identifiants internes (events WebSocket `game:*`/`player:*`, enum `GameState`, modèles Prisma).
   Ce sont des identifiants protocole/persistance, pas du texte utilisateur.
4. **Langues** : **FR seul** livré, mais infra multi-langue prête (structure de dictionnaire,
   sélection de langue, pluriels ICU). Aucune traduction supplémentaire dans cette passe.
5. **Validation** : erreurs class-validator renvoyées en **codes structurés** `{ field, code }`,
   traduites côté front (ValidationPipe custom).
6. **Hors scope (phases ultérieures)** : renommage projet `roux-quizz` → `live-quizz` ; renommage
   des identifiants code `game` → `session` (contrat WS, enum, modèles). « Chaque chose en son temps. »

## Glossaire canonique

| Concept | Termes actuels (mélangés) | **Cible** | Notes |
|---|---|---|---|
| Contenu créé par le propriétaire | quiz | **quiz** | conservé (générique) |
| Exécution live d'un quiz | partie / game / session | **session** | DB déjà en `session` |
| Personne qui répond | joueur / apprenant / participant | **participant** | |
| Personne qui anime | formateur / animateur / hôte | **animateur** | identifiants code `host:*` conservés |
| Code d'accès | PIN | **PIN** | conservé |

> Le glossaire s'applique au **texte utilisateur** (valeurs du dictionnaire) et aux **codes** de
> tokens d'erreur. Les identifiants code (`GameState`, `host:create`, modèle Prisma) **restent** —
> notamment le terme protocole `host` ≠ terme utilisateur « animateur » (écart volontaire et assumé).

## Architecture i18n (front)

- **Lib** : `react-i18next` + `i18next` (compatible React 19 / Vite ; namespaces, interpolation,
  pluriels ICU).
- **Emplacement** : `apps/frontend/src/i18n/` → `index.ts` (init) + `locales/fr/<namespace>.json`.
- **Découpage en namespaces** par surface : `common`, `dashboard`, `editor`, `live` (hôte/écran/joueur),
  `join`, `sessions`, `errors` (codes backend), `validation` (codes de champ).
- **Nommage des clés** : par **feature/emplacement**, pas par nom de domaine
  (`dashboard.activeGames.stop`, pas `partie.stop`) — pour que le glossaire puisse encore bouger
  sans casser les clés. Les **valeurs** portent le glossaire (« session », « participant »…).
- **Pluriels** : on utilise les pluriels ICU natifs (`{count, plural, ...}`) — on **ne porte pas**
  les `joueur(s)` / `question(s)` littéraux.
- **Distinction importante** : `quiz.language` (champ existant = langue **du contenu** des questions)
  ≠ langue de l'**UI**. Deux notions séparées.

## Plan d'intégration (par phases)

> Contrainte d'ordre : **figer le glossaire (ce doc) AVANT d'extraire les chaînes**, sinon on grave
> des termes périmés. Chaque phase = un commit/PR autonome, testé.

### Phase 1 — Infra i18n (aucun changement visible)
- Ajouter `react-i18next` / `i18next`.
- Créer `src/i18n/index.ts`, namespaces vides + `common`.
- **Brancher le harness de test** (`src/test/harness.tsx`) sur l'`I18nextProvider` avec `fr` réel
  chargé en synchrone → sinon les ~10 assertions `getByText(/français/)` cassent.
- Ajouter un sélecteur de langue inerte (FR seul) pour valider le câblage.

### Phase 2 — Extraction UI → dictionnaire `fr`
- Migrer les chaînes route par route (dashboard → editor → live → join → sessions), en appliquant
  le glossaire dans les **valeurs**.
- Remplacer les maps locales type `STATUS_LABEL` par des clés i18n.
- Convertir les pluriels manuels en ICU.
- Mettre à jour les tests touchés au fil de chaque route (clé via `t()` ou texte FR résolu).

### Phase 3 — Backend = tokens
- **Enveloppe d'erreur unique** `{ code, params? }`, émise par **deux** filtres alimentant le **même**
  namespace front `errors` :
  - **REST** (la majorité des `throw`) : `HttpExceptionFilter` global. ⚠️ Sans lui, un `HttpException`
    Nest sérialise `{ statusCode, message, error }` — un code plat peut tenir dans `message` mais
    les `params` n'ont nulle part où aller → les erreurs interpolées (`transition_forbidden`)
    perdraient leurs paramètres ou garderaient du FR. C'est la moitié silencieuse de « backend = tokens ».
  - **WS** : `WsExceptionFilter` — faire évoluer l'event `error` de `{ code, message }` vers
    `{ code, params? }` dans `@roux-quizz/contracts` (le `message` FR disparaît ; fallback dev EN seulement).
- Remplacer chaque `throw new XxxException('texte FR')` par un **code** stable
  (ex. `quiz.not_found`, `session.finished`, `nickname.taken`, `quiz.transition_forbidden` + `params`).
- **ValidationPipe custom** : `exceptionFactory` renvoyant `{ code, errors: [{ field, code, params }] }`.
- Front : namespace `errors` (codes domaine, **niché** pour matcher les codes pointés) +
  `validation` (codes Zod génériques). `apiErrorText` résout `code`/`params` ; pour
  `{ code: 'validation', errors }` il traduit **chaque** `{ field, code }` via `validation`.
- **Source de vérité** : les codes émis par le backend font foi ; `errors.json`/`validation.json`
  doivent rester en phase avec eux (pas de garde automatique — un code sans clé renvoie la clé brute).
- Hors scope : descriptions Swagger/OpenAPI (doc **dev**, pas UX).

### Phase ultérieure (séparée) — non planifiée ici
- Rename projet `roux-quizz` → `live-quizz` (packages, scopes npm, images Docker, README).
- Rename identifiants code `game` → `session` (events WS, `GameState`, modèles Prisma, Orval régénéré,
  migrations). Gros blast-radius — à traiter avec le rename projet.

## Conséquences

- **+** Vocabulaire cohérent et neutre ; ajout d'une 2ᵉ langue trivial (un dossier `locales/en/`).
- **+** Backend découplé de la présentation ; clients responsables du texte.
- **−** Changement de contrat (`error` payload) → version `contracts` à bumper, front/back synchronisés.
- **−** ~10 assertions `getByText` accentuées **+ requêtes `getByRole('button', {name})`** sur libellés
  FR (« Arrêter », « Présenter », « Éditer »…) à adapter + harness à instrumenter (Phase 1).
