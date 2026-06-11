# Roux-Quizz — Spécifications métier (fonctionnel)

> Vue **domaine / fonctionnelle** de l'application. Complète `SPECIFICATIONS.md` (technique).
> Contexte retenu : **entreprise / formation**. Mode v1 : **classique individuel**. Quiz **privés**.
> Version 1.0 — 2026-06-09.

---

## 1. Contexte & objectifs métier

Roux-Quizz est un outil de **quiz interactif en temps réel pour la formation professionnelle** : un formateur anime une session live, les apprenants répondent depuis leur appareil, et la rapidité comme l'exactitude sont récompensées. L'objectif est de **dynamiser la formation**, **mesurer l'acquisition de connaissances** et **restituer des résultats exploitables** au formateur et à l'organisation.

### Objectifs métier
- **Engager** les apprenants (gamification, classement, rythme).
- **Évaluer** les connaissances de façon formative (avant/pendant/après une formation).
- **Tracer** la participation et la performance (reporting RH/formation).
- **Réutiliser** facilement les contenus (banque de quiz du formateur).

### Bénéfices attendus
| Partie prenante | Bénéfice |
|-----------------|----------|
| Formateur | Anime, évalue en direct, identifie les notions mal acquises |
| Apprenant | Apprentissage actif, feedback immédiat, émulation |
| Responsable formation | Preuve de participation, indicateurs d'acquisition, traçabilité |

---

## 2. Acteurs & personas

| Acteur | Description | Auth |
|--------|-------------|------|
| **Formateur** (créateur/hôte) | Conçoit les quiz et anime les sessions. Acteur principal. | OIDC (rôle `host`) ou mode local |
| **Apprenant invité** | Rejoint une session par PIN + pseudo, sans compte. | Aucune |
| **Apprenant connecté** | Apprenant identifié (SSO entreprise) : son historique est conservé. | OIDC (rôle `player`) |
| **Administrateur formation** | (v1.1) Supervise les formateurs, consulte les rapports agrégés. | OIDC (rôle `admin`) |

> Les rôles `host`/`player`/`admin` proviennent des rôles du token OIDC (claim configurable, défaut `realm_access.roles` pour compatibilité Keycloak).

### Personas
- **Claire, formatrice interne** — anime des sessions d'onboarding de 20–40 personnes ; veut créer vite, projeter, et récupérer qui a participé et les scores.
- **Marc, apprenant onboarding** — rejoint via un lien/PIN sur son téléphone, sans créer de compte ; veut une expérience fluide et ludique.
- **Sophie, responsable L&D** *(v1.1)* — veut des indicateurs d'acquisition par session et par thème.

---

## 3. Glossaire métier

| Terme | Définition |
|-------|------------|
| **Quiz** | Ensemble ordonné de questions, propriété d'un formateur. |
| **Question** | Énoncé chronométré avec un ou plusieurs types de réponse (cf. spec technique §4). |
| **Session (partie)** | Une exécution live d'un quiz, identifiée par un PIN, animée par un formateur. |
| **Apprenant / Joueur** | Participant à une session. |
| **Score** | Points cumulés d'un apprenant sur une session (exactitude + rapidité). |
| **Classement** | Ordre des apprenants par score, mis à jour entre les questions. |
| **Restitution** | Rapport de fin de session (participation, scores, réponses par question). |
| **Banque de quiz** | Ensemble des quiz privés d'un formateur. |

---

## 4. Périmètre fonctionnel v1

### Inclus
- Création/édition de quiz privés (banque personnelle du formateur).
- Tous les types de questions (cf. technique §4) + sondage (sans points).
- Animation d'une session live en **mode individuel** : lobby, déroulé, classement, podium.
- Participation **invité** (PIN + pseudo) ou **connectée** (SSO).
- Notation au temps de réponse + séries (cf. technique §5).
- Restitution de fin de session + export CSV.
- Historique pour l'apprenant connecté.
- **Mode capture intégrale** (optionnel par session) : conservation de chaque réponse individuelle pour audit/certification, avec avis aux apprenants.

### Exclus v1 (backlog)
- Mode **équipes** → v1.1.
- Mode **asynchrone / devoir** → v1.2.
- **Partage** de quiz entre formateurs / bibliothèque publique → ultérieur (v1 : privé uniquement).
- Tableau de bord **administrateur** agrégé → v1.1.
- Génération de questions par IA, import de banques externes.

---

## 5. Cycle de vie des objets métier

### 5.1 Quiz
```
BROUILLON ──(complété & valide)──▶ PRÊT ──(joué en session)──▶ PRÊT (réutilisable)
    │                                  │
    └────────── ARCHIVÉ ◀──────────────┘   (le formateur archive ; non supprimé, retiré des listes actives)
```
- Un quiz **BROUILLON** ne peut pas être lancé (validation : ≥ 1 question valide).
- L'**archivage** conserve l'historique des sessions passées.
- La **suppression** est définitive et refusée si des restitutions doivent être conservées (cf. §10 conservation).

### 5.2 Session
```
PROGRAMMÉE/IMMÉDIATE → LOBBY → EN COURS → TERMINÉE → ARCHIVÉE
```
(détail des états temps réel : technique §8). Une session **TERMINÉE** génère une **restitution** figée.

---

## 6. Parcours utilisateurs (user journeys)

### 6.1 Formateur — créer un quiz
1. Se connecte (ou mode local).
2. « Nouveau quiz » → titre, description, langue, visuel.
3. Ajoute des questions (choix du type, énoncé, média, options, **temps limite**, **points**).
4. Réordonne, prévisualise.
5. Le quiz passe **PRÊT** quand il est valide. Enregistré dans sa banque privée.

### 6.2 Formateur — animer une session
1. Choisit un quiz **PRÊT** → « Lancer une session ».
2. Le système génère un **PIN** ; le formateur projette l'écran lobby.
3. Les apprenants rejoignent (PIN + pseudo, ou SSO) ; leurs pseudos s'affichent.
4. « Démarrer » → déroulé question par question (énoncé → réponses → bonne réponse → classement).
5. À la dernière question → **podium**.
6. Consulte la **restitution**, l'exporte si besoin, termine la session.

### 6.3 Apprenant — participer
1. Saisit le **PIN** et un **pseudo** (ou se connecte en SSO).
2. Attend dans le lobby.
3. À chaque question : lit l'énoncé, choisit sa réponse **avant la fin du chrono**.
4. Reçoit un **feedback immédiat** (juste/faux, points gagnés, rang).
5. Voit le **podium** final et son classement.
6. *(connecté)* retrouve la session dans son **historique**.

---

## 7. User stories (épopées)

### Épopée A — Conception de quiz
- En tant que **formateur**, je veux **créer un quiz** avec plusieurs questions afin de préparer ma session.
- … **choisir le type de question** (QCM, vrai/faux, saisie, numérique, ordre, sondage) afin d'adapter l'évaluation.
- … **définir le temps limite et les points** par question afin de calibrer la difficulté.
- … **ajouter une image / un son** afin d'illustrer une question.
- … **réordonner et prévisualiser** afin de vérifier le déroulé.
- … **dupliquer un quiz** afin de gagner du temps sur une variante.
- … **archiver** un quiz obsolète afin de garder ma banque propre.

### Épopée B — Animation de session
- En tant que **formateur**, je veux **lancer une session et obtenir un PIN** afin que les apprenants rejoignent.
- … **voir qui a rejoint** (pseudos, nombre) afin de savoir quand démarrer.
- … **piloter le rythme** (démarrer, révéler, question suivante, mettre en pause) afin de m'adapter au groupe.
- … **exclure un participant** (pseudo inapproprié) afin de garder un cadre pro.
- … **voir le nombre de réponses en temps réel** afin de savoir quand passer à la suite.
- … **terminer la session** et obtenir la restitution.

### Épopée C — Participation
- En tant qu'**apprenant**, je veux **rejoindre avec un PIN sans créer de compte** afin de participer sans friction.
- … **répondre rapidement** afin de marquer plus de points.
- … **voir si j'ai eu juste et mes points** afin d'avoir un retour immédiat.
- … **voir mon classement** afin de me situer.
- … *(connecté)* **retrouver mon historique** afin de suivre ma progression.

### Épopée D — Restitution & suivi
- En tant que **formateur**, je veux une **restitution de session** (participation, scores, réussite par question) afin d'identifier les notions à retravailler.
- … **exporter les résultats (CSV)** afin de les intégrer au suivi formation.
- *(v1.1)* En tant que **responsable formation**, je veux des **indicateurs agrégés** afin de mesurer l'efficacité des formations.

---

## 8. Règles métier

### 8.1 Quiz & banque
- Un quiz appartient à **un seul formateur** ; **privé** (visible de lui seul) en v1.
- Un quiz doit contenir **≥ 1 question valide** pour être **PRÊT** / lançable.
- Bornes : `temps limite` 5–120 s ; **2 à 6 options** selon le type ; **≥ 1 bonne réponse** (sauf sondage).
- La duplication crée une copie indépendante en **BROUILLON**.

### 8.2 Session
- Une session est rattachée à **un quiz** et **un formateur** (l'hôte).
- **PIN** unique à 6 chiffres, à usage unique, invalidé en fin de session.
- Une session en **LOBBY** non démarrée expire (30 min) afin de libérer le PIN.
- Capacité : **10 à 200** apprenants par session.
- **Mode individuel** uniquement : un score par apprenant, pas de regroupement.

### 8.3 Participation
- Un **pseudo** doit être unique dans une session ; filtré (longueur, liste noire de termes).
- Un apprenant ne répond **qu'une fois** par question ; pas de changement d'avis.
- Réponse **hors délai = 0 point** (cf. technique §6).
- Un apprenant **exclu** ne peut pas rejoindre la même session avec le même pseudo.

### 8.3 bis Traçabilité des réponses (mode capture intégrale)
- Par défaut, seules les **données agrégées** par question sont conservées (taux de réussite, répartition) — minimisation des données.
- Le formateur peut activer, **à la création de la session**, le **mode capture intégrale** : chaque réponse individuelle (qui, quoi, quand, points) est alors conservée pour audit/certification.
- Lorsque ce mode est actif, **les apprenants en sont informés par un avis affiché en début de session**, avant toute collecte (transparence/consentement).
- La conservation suit la même échéance que la restitution *(RG-11)*.

### 8.4 Notation (métier)
- Points = exactitude **et** rapidité (formule technique §5) ; sondage = 0.
- **Série** (bonnes réponses consécutives) → bonus, valorise la régularité.
- Égalité départagée par temps de réponse cumulé (cf. technique §5).
- Le score n'est **pas une note académique** : c'est un indicateur formatif et ludique. *(Le seuil de « réussite » par taux de bonnes réponses est une notion de reporting, cf. §9.)*

---

## 9. Évaluation & reporting (clé en formation)

### 9.1 Restitution de session (générée à la fin)
Disponible au formateur, **figée** :
- **Participation** : nombre d'apprenants, liste des pseudos (+ identité si connectés).
- **Classement final** : rang, pseudo, score, nombre de bonnes réponses, temps moyen.
- **Analyse par question** : taux de bonnes réponses, répartition des réponses, temps moyen → repère les **notions mal acquises**.
- **Taux de réussite global** de la session (paramétrable : % de bonnes réponses moyen).
- **Export CSV** (intégration au suivi formation / SIRH).

### 9.2 Historique apprenant (connecté)
- Liste de ses sessions, score, rang, date.
- Progression simple dans le temps.

### 9.3 Indicateurs agrégés *(v1.1)*
- Par formateur, par quiz, par thème : taux de réussite, participation, évolution.
- Destinés au **responsable formation**.

---

## 10. Conformité & qualité (métier)

- **RGPD** : pseudos d'invités = non identifiants ; apprenants connectés = données perso → information, droit d'accès/suppression (anonymisation des restitutions à la suppression de compte, cf. technique §13).
- **Conservation** : les restitutions de session sont conservées selon une durée paramétrable (défaut 24 mois en contexte formation) ; suppression de quiz refusée si une rétention l'exige.
- **Capture intégrale** : collecte des réponses individuelles uniquement si le formateur l'active ; **avis obligatoire aux apprenants en début de session** avant toute collecte ; même durée de conservation que la restitution. Réservée aux besoins d'audit/certification (proportionnalité RGPD).
- **Modération de contenu** : pseudos filtrés, exclusion par le formateur ; les contenus de quiz relèvent de la responsabilité du formateur (privé).
- **Accessibilité** : couleur **+** forme pour les réponses, contraste, clavier (cf. technique §13) — important en contexte pro inclusif.
- **Langue** : FR/EN dès la v1 ; langue définie au niveau du quiz.

---

## 11. Indicateurs de succès (KPIs métier)

| KPI | Cible indicative |
|-----|------------------|
| Temps de création d'un quiz de 10 questions | < 15 min |
| Taux d'apprenants rejoignant une session lancée | > 90 % |
| Taux de complétion d'une session (présents jusqu'au podium) | > 85 % |
| Sessions générant une restitution exportée | suivi (adoption reporting) |
| Satisfaction apprenant (post-session, v1.1) | > 4/5 |

---

## 12. Règles de gestion — synthèse (référence rapide)

| # | Règle |
|---|-------|
| RG-01 | Un quiz est privé et appartient à un unique formateur (v1). |
| RG-02 | Un quiz lançable a ≥ 1 question valide (état PRÊT). |
| RG-03 | Temps limite par question ∈ [5, 120] s ; 2–6 options ; ≥ 1 correcte (hors sondage). |
| RG-04 | PIN unique 6 chiffres, usage unique, expire (lobby 30 min). |
| RG-05 | 10–200 apprenants par session ; mode individuel. |
| RG-06 | Pseudo unique par session, filtré ; 1 réponse/question ; pas de changement d'avis. |
| RG-07 | Réponse hors délai = 0 point ; sondage = 0 point. |
| RG-08 | Points = exactitude + rapidité + bonus de série. |
| RG-09 | Égalité départagée par temps de réponse cumulé. |
| RG-10 | Une session terminée produit une restitution figée + export CSV. |
| RG-11 | Restitutions conservées selon durée paramétrable (défaut 24 mois). |
| RG-12 | Apprenant exclu non réadmis avec le même pseudo. |
| RG-13 | Capture intégrale optionnelle, choisie à la création de la session ; avis obligatoire aux apprenants en début de session avant toute collecte. |

---

## 13. Priorisation (MoSCoW) v1

- **Must** : création quiz privés, tous types de questions, session live individuelle (lobby→podium), join invité/SSO, notation temps+série, restitution + export CSV.
- **Should** : historique apprenant connecté, archivage quiz, pause/exclusion hôte, accessibilité couleur+forme, i18n FR/EN.
- **Could** : duplication de quiz, taux de réussite paramétrable, statistiques par question enrichies, **mode capture intégrale** (audit/certification).
- **Won't (v1)** : mode équipes, mode asynchrone, partage/bibliothèque publique, dashboard admin agrégé, génération IA.
