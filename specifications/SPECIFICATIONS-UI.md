# Live-Quizz — Maquettes & écrans (wireframes)

> Vue **IHM / parcours écran**, basse fidélité (ASCII). Complète `SPECIFICATIONS-METIER.md`.
> Périmètre v1 : formation entreprise, mode individuel, quiz privés.
> Version 1.0 — 2026-06-09. Les wireframes fixent le **contenu et la hiérarchie**, pas le style graphique.

---

## 0. Conventions

- 3 surfaces : **Console formateur** (desktop), **Écran de jeu projeté** (grand écran/vidéoproj), **Client apprenant** (mobile).
- `[ Bouton ]` action · `( ) / (•)` choix · `▣` zone média · `▮▮▮` barre/jauge · `⏱` chrono.
- Couleurs de réponse Kahoot-like, **chaque réponse = couleur + forme** (▲ ◆ ● ■) pour l'accessibilité.

---

## 1. Authentification / accueil

### 1.1 Accueil (non connecté)
```
┌──────────────────────────────────────────────┐
│                 LIVE-QUIZZ                     │
│                Quizz interactif                │
│                                                │
│   ┌──────────────────────────────────────┐    │
│   │  Rejoindre une session                │    │
│   │   PIN : [ _ _ _ _ _ _ ]   [ Rejoindre ]│   │
│   └──────────────────────────────────────┘    │
│                                                │
│   Formateur ?   [ Se connecter ]               │
│                 (OIDC / SSO ou mode local)     │
└──────────────────────────────────────────────┘
```
> En `AUTH_MODE=none`, « Se connecter » ouvre une simple saisie de nom local.

---

## 2. Console formateur (desktop)

### 2.1 Tableau de bord — Ma banque de quiz
```
┌───────────────────────────────────────────────────────────┐
│ LIVE-QUIZZ   Mes quiz │ Historique           Claire ▾      │
├───────────────────────────────────────────────────────────┤
│ [ + Nouveau quiz ]        Rechercher [____________]  🔍     │
│                                                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ ▣ Onboarding│ │ ▣ Sécurité  │ │ ▣ Produit   │           │
│  │ 12 questions│ │ 8 questions │ │ 5 questions │           │
│  │ PRÊT        │ │ BROUILLON   │ │ PRÊT        │           │
│  │ [Lancer][⋯] │ │ [Éditer][⋯] │ │ [Lancer][⋯] │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                            │
│  Filtres : ( ) Tous (•) Prêts ( ) Brouillons ( ) Archivés  │
└───────────────────────────────────────────────────────────┘
```
Menu `⋯` : Éditer · Dupliquer · Archiver · Supprimer · Voir les sessions passées.
> « Lancer » est désactivé pour un BROUILLON (RG-02).

### 2.2 Éditeur de quiz (builder)
```
┌───────────────────────────────────────────────────────────┐
│ ◀ Retour   Quiz : [ Onboarding sécurité      ]   [Enregistrer]│
├──────────────┬────────────────────────────────────────────┤
│ QUESTIONS    │  Question 3 / 12                            │
│ 1 ▣ QCM      │  Type : [ QCM réponse unique     ▾]        │
│ 2 ▣ V/F      │  Énoncé : [_______________________________]│
│ 3 ▣ QCM  ◀   │  Média  : [ ▣ Ajouter image/son ]          │
│ 4 ▣ Saisie   │  ⏱ Temps : [ 20 s ▾]   Points : [1000 ▾]   │
│ ...          │                                            │
│ [ + Ajouter ]│  Réponses :                                │
│              │   ▲ [ Réponse A__________ ] ( ) correcte    │
│ (glisser pour│   ◆ [ Réponse B__________ ] (•) correcte    │
│  réordonner) │   ● [ Réponse C__________ ] ( ) correcte    │
│              │   ■ [ Réponse D__________ ] ( ) correcte    │
│              │                          [+ option] (max 6) │
│              │  [ Prévisualiser ]            [ Supprimer ] │
└──────────────┴────────────────────────────────────────────┘
```
- Le **type** adapte la zone réponses (V/F = 2 options ; saisie = liste de réponses acceptées ; numérique = valeur + tolérance ; ordre = séquence ; sondage = pas de « correcte »).
- Validation inline : énoncé requis, ≥ 1 correcte (RG-03), bornes temps.

### 2.3 Prévisualisation d'une question
```
┌───────────────────────────────────────────────────────────┐
│  Aperçu (vue apprenant)                        [ Fermer ]  │
│  ▣ média                                                   │
│  « Quel comportement signale un e-mail de phishing ? »     │
│  ⏱ 20 s                                                    │
│  ▲ Rouge            ◆ Bleu                                  │
│  ● Jaune            ■ Vert                                  │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Animation de session — console formateur

### 3.1 Lobby (côté formateur)
```
┌───────────────────────────────────────────────────────────┐
│  Session : Onboarding sécurité                             │
│  PIN : 4 8 2 9 1 7        [ Afficher en grand ]            │
│  Apprenants connectés : 23                                 │
│                                                            │
│  marc · sophie · leo · nadia · ... (liste, clic = exclure) │
│                                                            │
│  ☐ Enregistrer toutes les réponses (audit / certification) │
│     ⓘ Les apprenants en seront informés au démarrage.      │
│                                                            │
│  [ Démarrer la session ]                  [ Annuler ]      │
└───────────────────────────────────────────────────────────┘
```
> La case « Enregistrer toutes les réponses » active le **mode capture intégrale** (RG-13). Verrouillée une fois la session démarrée.

### 3.2 Pendant une question (côté formateur)
```
┌───────────────────────────────────────────────────────────┐
│  Question 3 / 12                              ⏱ 12 s       │
│  « Quel comportement signale un e-mail de phishing ? »     │
│                                                            │
│  Réponses reçues : 18 / 23   ▮▮▮▮▮▮▮▮░░                    │
│                                                            │
│  [ Révéler maintenant ]  [ Pause ]  [ Terminer la session ]│
└───────────────────────────────────────────────────────────┘
```

### 3.3 Révélation + classement (côté formateur)
```
┌───────────────────────────────────────────────────────────┐
│  Bonne réponse : ◆ « Expéditeur inconnu + lien urgent »    │
│  Répartition :  ▲ 4   ◆ 15 ✓   ● 2   ■ 2                   │
│                                                            │
│  Classement                                                │
│   1. sophie    8 450                                       │
│   2. marc      8 120                                       │
│   3. nadia     7 900                                       │
│   ...                                                      │
│                               [ Question suivante ▶ ]      │
└───────────────────────────────────────────────────────────┘
```

---

## 4. Écran de jeu projeté (grand écran)

### 4.1 Lobby projeté
```
┌───────────────────────────────────────────────────────────┐
│        Rejoignez sur  live-quizz.app   —   PIN : 482917     │
│                                                            │
│      marc   sophie   leo   nadia   karim   inès   ...       │
│                         23 joueurs                         │
└───────────────────────────────────────────────────────────┘
```

### 4.2 Question projetée
```
┌───────────────────────────────────────────────────────────┐
│  « Quel comportement signale un e-mail de phishing ? »  ⏱14│
│  ▣ média                                                   │
│  ┌───────────────┐ ┌───────────────┐                       │
│  │ ▲  Réponse A  │ │ ◆  Réponse B  │                       │
│  └───────────────┘ └───────────────┘                       │
│  ┌───────────────┐ ┌───────────────┐                       │
│  │ ●  Réponse C  │ │ ■  Réponse D  │                       │
│  └───────────────┘ └───────────────┘                       │
│            Réponses reçues : 18 / 23                       │
└───────────────────────────────────────────────────────────┘
```
> Le projeté **n'indique jamais** la bonne réponse avant la révélation (anti-triche, technique §7).

---

## 5. Client apprenant (mobile)

### 5.1 Rejoindre
```
┌───────────────────┐   ┌───────────────────┐
│   PIN              │   │  Ton pseudo        │
│  [ 4 8 2 9 1 7 ]   │ → │  [ marc________ ]  │
│   [ Rejoindre ]    │   │  [ C'est parti ! ] │
└───────────────────┘   └───────────────────┘
```

### 5.2 Salle d'attente
```
┌───────────────────┐
│   Tu es dans la    │
│      partie !      │
│      « marc »      │
│  En attente du     │
│  formateur…        │
└───────────────────┘
```

### 5.2 bis Avis de capture intégrale (si activé)
Affiché au join **avant** toute collecte, lorsque le formateur a activé l'enregistrement complet :
```
┌───────────────────────────────┐
│  ⓘ Session enregistrée         │
│  Tes réponses individuelles    │
│  seront conservées pour le     │
│  suivi de formation.           │
│            [ J'ai compris ]    │
└───────────────────────────────┘
```
> Correspond à l'event `notice { fullCapture:true }` (séquences §2 / technique §9). Informatif (transparence RGPD, RG-13).

### 5.3 Répondre (le cœur de l'app)
```
┌───────────────────┐
│       ⏱ 14        │
│ (énoncé sur le     │
│  grand écran)      │
│ ┌──────┐ ┌──────┐ │
│ │  ▲   │ │  ◆   │ │
│ └──────┘ └──────┘ │
│ ┌──────┐ ┌──────┐ │
│ │  ●   │ │  ■   │ │
│ └──────┘ └──────┘ │
└───────────────────┘
```
- Saisie texte → champ de saisie ; numérique → curseur/clavier ; ordre → liste à glisser.
- Après réponse : « Réponse enregistrée ✓ » + verrouillage (1 réponse, RG-06).

### 5.4 Feedback immédiat
```
┌───────────────────┐    ┌───────────────────┐
│       ✓ Juste !    │ ou │       ✗ Raté       │
│      +850 points   │    │      +0 point      │
│   Série : 🔥 x3     │    │   Rang : 7e        │
│   Rang : 3e        │    │                    │
└───────────────────┘    └───────────────────┘
```

### 5.5 Podium final (apprenant + projeté)
```
┌───────────────────────────────┐
│            🏆 Podium           │
│           ┌────┐                │
│      ┌────┤ 1  ├────┐           │
│  ┌───┤ 2  │sophie│ 3 ├───┐      │
│  │marc│   │ 8450 │   │nadia│    │
│                                │
│   Ton classement : 2e — 8 120  │
│   [ Voir mes réponses ]        │
└───────────────────────────────┘
```

---

## 6. Restitution de session (formateur)

### 6.1 Synthèse
```
┌───────────────────────────────────────────────────────────┐
│  Restitution — Onboarding sécurité — 09/06/2026            │
│  Participants : 23   Taux de réussite moyen : 72 %         │
│  [ Exporter CSV ]                                           │
│                                                            │
│  Classement final                                          │
│   Rang  Pseudo   Score   Bonnes   Tps moyen                │
│    1    sophie   8 450    11/12     6.2 s                  │
│    2    marc     8 120    10/12     7.1 s                  │
│   ...                                                       │
└───────────────────────────────────────────────────────────┘
```

### 6.2 Analyse par question (notions à retravailler)
```
┌───────────────────────────────────────────────────────────┐
│  Question                          Réussite   Tps moyen    │
│  Q1  Définition phishing            91 %        5.0 s   ✅  │
│  Q2  Mot de passe fort              48 %        9.8 s   ⚠️  │  ← à retravailler
│  Q3  Signaux d'e-mail suspect       65 %        7.3 s      │
│  ...                                                       │
│  (clic sur une ligne → répartition détaillée des réponses) │
└───────────────────────────────────────────────────────────┘
```

---

## 7. Historique apprenant (connecté)
```
┌───────────────────────────────────────────────────────────┐
│  Mes sessions                                              │
│  Date        Quiz                 Score    Rang            │
│  09/06/2026  Onboarding sécurité  8 120    2e / 23         │
│  02/06/2026  Produit v2           5 600    5e / 18         │
│  (progression dans le temps ▮▮▮▮▮▮▯▯)                      │
└───────────────────────────────────────────────────────────┘
```
> Disponible uniquement si `AUTH_MODE=oidc` (apprenant identifié).

---

## 8. États & messages transverses

| Situation | Message / écran |
|-----------|-----------------|
| PIN invalide / session close | « Aucune session pour ce PIN. » |
| Pseudo déjà pris | « Ce pseudo est déjà utilisé, choisis-en un autre. » |
| Déconnexion apprenant | Bandeau « Reconnexion… » → reprise auto (technique §11) |
| Hôte déconnecté | « Le formateur s'est déconnecté, la partie est en pause. » |
| Apprenant exclu | « Tu as été retiré de la session par le formateur. » |
| Réponse hors délai | « Temps écoulé — réponse non comptée. » |
| Session enregistrée (capture) | Avis « Tes réponses seront conservées » → [ J'ai compris ] (RG-13) |
| Fin de session | Podium → écran de remerciement |

---

## 9. Principes d'ergonomie (v1)

- **Mobile-first** côté apprenant : grandes cibles tactiles, une action par écran.
- **Lisibilité projetée** : énoncé sur le grand écran, choix minimal sur le mobile (le mobile peut n'afficher que les couleurs/formes).
- **Feedback immédiat** systématique (juste/faux + points + rang).
- **Accessibilité** : couleur **+** forme, contraste AA, navigation clavier (console formateur), tailles tactiles ≥ 44 px.
- **i18n** FR/EN ; libellés externalisés.
- **Charge cognitive minimale** pour l'apprenant pendant le chrono.
