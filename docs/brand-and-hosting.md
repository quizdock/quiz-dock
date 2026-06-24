# Marque & hébergement — QuizDock

> État au 2026-06-24. Marque issue du renommage `live-quizz` → `QuizDock` (cf.
> [ADR 0003](adr/0003-rename-quizdock.md)). Positionnement : **quiz live temps réel,
> open-source et auto-hébergeable** (« dock » ⇒ déploiement conteneur).

## Identité

| Élément | Valeur |
|---|---|
| Marque affichée | **QuizDock** |
| Slug / package / repo | `quiz-dock` |
| DB / namespace Docker Hub | `quizdock` |
| Scope npm | `@quiz-dock/*` |
| Repo de code | `github.com/fchaussin/quiz-dock` |

Le nom de marque est **white-label runtime** : une instance peut afficher tout autre nom via
`APP_NAME` + le dossier `branding/` sans rebuild (cf. [ADR 0002](adr/0002-rename-live-quizz-et-white-label.md)).

## Disponibilité des surfaces (au 2026-06-24)

| Surface | `quizdock` | `quiz-dock` | Statut |
|---|---|---|---|
| npm (+ scope) | libre | libre | à réserver si publication |
| Docker Hub (namespace) | libre | libre | à réserver à la 1ʳᵉ image |
| GitHub (user/org) | **libre** | libre | **à réserver** (cf. ci-dessous) |
| Domaine `.io` | libre | libre | optionnel |
| Domaine `.app` | libre | libre | optionnel |
| Domaine `.fr` | libre | libre | optionnel |
| Domaine `.com` | **pris** | libre | — |
| GitLab | non concluant (anti-bot) | — | à vérifier si besoin |

## Hébergement du site — GitHub Pages

Objectif visé : **`https://quizdock.github.io`**. Cette URL exige une **organisation (ou un
compte) GitHub nommé littéralement `quizdock`**, propriétaire d'un repo `quizdock.github.io`.
Le compte actuel étant `fchaussin`, la voie par défaut donnerait `fchaussin.github.io`.

### Voie recommandée — organisation `quizdock`

1. **Créer l'org gratuite** `quizdock` : <https://github.com/account/organizations/new> (plan *Free*).
   ⚠️ Non automatisable — GitHub n'a pas d'API de création d'org ; action navigateur (~1 min).
   Réserve aussi le nom face aux tiers.
2. Créer le repo **`quizdock.github.io`** dans l'org → site servi sur `https://quizdock.github.io`.
3. (Optionnel) **Transférer le code** `fchaussin/quiz-dock` → `quizdock/quiz-dock` pour tout
   regrouper. Le remote local devra être mis à jour (`git remote set-url`).
4. (Optionnel) **Domaine custom** (`quizdock.io` / `.fr`) : fichier `CNAME` dans le repo Pages
   + enregistrement DNS.

### Repli immédiat — Pages de projet (sans nouvelle org)

Activer Pages sur `fchaussin/quiz-dock` → `https://fchaussin.github.io/quiz-dock/`.
URL moins propre, mais disponible tout de suite et sans org.

## Reste à faire

- [ ] **Réserver l'org GitHub `quizdock`** (action manuelle navigateur — voir lien ci-dessus).
- [ ] Une fois l'org créée : échafauder le repo `quizdock.github.io` (landing + workflow Pages).
- [ ] Décider du transfert du repo de code sous l'org.
- [ ] (Optionnel) Réserver domaine(s) + npm + Docker Hub avant la 1ʳᵉ publication publique.
