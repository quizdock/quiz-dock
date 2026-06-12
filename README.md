# Roux-Quizz

**Plateforme de quiz interactifs en temps réel pour la formation professionnelle** — un clone de Kahoot : un formateur anime une session live, les apprenants répondent depuis leur appareil, et la rapidité comme l'exactitude rapportent des points.

> 🚧 **Statut : conception.** Le code n'est pas encore écrit ; le dépôt contient les spécifications qui font foi et la doc de développement à venir.

---

## ✨ Ce que fait Roux-Quizz

- 🎯 **Quiz chronométrés** avec notation au temps de réponse (réponse rapide = plus de points) + bonus de série.
- 👥 **Multijoueur temps réel** : 10 à 200 apprenants par session, via un simple **PIN**.
- 🧩 **Builder de quiz** : QCM, vrai/faux, saisie, numérique, remise en ordre, sondage.
- 🏆 **Classement live** entre les questions et **podium** final.
- 📊 **Restitution** de session pour le formateur (participation, scores, notions à retravailler) + export CSV.
- 🔐 **Auth entreprise** (Keycloak/SSO) — facultative : on peut jouer en invité.

Contexte cible : **formation en entreprise** (onboarding, montée en compétences, évaluation formative).

---

## 🧱 Stack (en bref)

**pnpm** monorepo · **React + Vite + shadcn/ui + TanStack** (front) · **NestJS + Socket.IO** (back) · **Redis** (live) · **PostgreSQL** (durable, ULID) · **Keycloak** (auth) · **SeaweedFS** (médias) · **Docker Compose** · **GitHub Actions**.

Synchro front/back : OpenAPI auto → **Orval** (REST) + package de contrats TS partagé (WebSocket).

---

## 📁 Organisation du dépôt

```
.
├── README.md            ← vous êtes ici (présentation générale)
├── specifications/      ← spécifications de référence (figées par version)
│   └── README.md        ← index des specs (point d'entrée détaillé)
└── docs/                ← documentation vivante, tenue à jour pendant le dev
    └── README.md
```

- 📐 **[specifications/](./specifications/README.md)** — la conception qui fait foi (métier, UI, technique, données, séquences, roadmap). À lire pour comprendre *ce qu'on construit et pourquoi*.
- 📖 **[docs/](./docs/README.md)** — la doc opérationnelle qui évolue au fil du code (décisions, guides, exploitation). À tenir à jour *à chaque itération*.

---

## 🗺️ Avancement

Le développement est incrémental à partir de **v0.1.0**, en versions `0.x` successives (la v1.0.0 n'est pas planifiée : elle ne sera envisagée que par éligibilité). Voir la **[feuille de route](./specifications/SPECIFICATIONS-ROADMAP.md)**.

---

## 🚀 Démarrage (cible, une fois le code en place)

```bash
pnpm install
docker compose up -d
# Front : http://localhost:45173   API : http://localhost:43000   Doc API : http://localhost:43000/api/docs
```

> En dev, on monte les **sources + manifestes** (jamais `node_modules` : glibc hôte ≠ musl Alpine).
> Les conteneurs lancent `pnpm install` (frozen) au démarrage : après un `pnpm add`, un simple
> `docker compose restart <service>` applique la dépendance — **pas de rebuild d'image** (réservé
> aux changements de `Dockerfile`).

---

*Specs versionnées — voir [specifications/README.md](./specifications/README.md) pour le détail et l'ordre de lecture.*
