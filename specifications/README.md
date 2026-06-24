# QuizDock — Spécifications (index)

> Hub des **spécifications de référence** du projet. Pour une présentation générale, voir le **[README racine](../README.md)**. La doc de développement vivante est dans **[../docs/](../docs/README.md)**.

> **Clone de Kahoot** : quiz interactifs en temps réel, chronométrés, avec notation au temps de réponse. 10–200 apprenants par session.

🚧 **Statut : phase de spécifications** (pas encore de code). Ces documents de conception font foi pour le développement.

---

## 📚 Documents de spécification

Lire dans cet ordre pour découvrir le projet :

| # | Document | Contenu | Pour qui |
|---|----------|---------|----------|
| 1 | **[SPECIFICATIONS-METIER.md](./SPECIFICATIONS-METIER.md)** | Vision, acteurs, parcours, règles de gestion (RG-xx), reporting, priorisation MoSCoW | Product, formateurs, toute l'équipe |
| 2 | **[SPECIFICATIONS-UI.md](./SPECIFICATIONS-UI.md)** | Wireframes des écrans (console formateur, projeté, mobile apprenant), ergonomie | Design, frontend |
| 3 | **[SPECIFICATIONS.md](./SPECIFICATIONS.md)** | Architecture, stack, scoring, timing, contrat WebSocket, REST, Docker, tests, CI | Backend, frontend, DevOps |
| 4 | **[SPECIFICATIONS-DONNEES.md](./SPECIFICATIONS-DONNEES.md)** | Dictionnaire de données (PostgreSQL + Redis), enums, RGPD, index | Backend, data |
| 5 | **[SPECIFICATIONS-SEQUENCES.md](./SPECIFICATIONS-SEQUENCES.md)** | Diagrammes de séquence (Mermaid) des flux clés | Backend, frontend |
| 6 | **[SPECIFICATIONS-ROADMAP.md](./SPECIFICATIONS-ROADMAP.md)** | Jalons à partir de v0.1.0 (suite ouverte en `0.x`), tâches par phase, dépendances ; v1.0.0 **non planifiée** (par éligibilité) | Lead, product, toute l'équipe |
| 7 | **[SPECIFICATIONS-LIVE.md](./SPECIFICATIONS-LIVE.md)** | Partie live : présentateur multi-fenêtres (projeté + contrôle, cross-device), écrans joueurs, late join, reconnexion/persistance, `HOST_DISCONNECTED`, matrice état→écran | Frontend, backend |

> Les documents se renvoient mutuellement (ex. `technique §5`, `RG-13`, `données §2.10`). Toute évolution de comportement doit mettre à jour **le document concerné dans le même commit** (cf. politique « tester & documenter », technique §18).

---

## 🎯 En bref

- **Contexte** : entreprise / formation. **Mode v1** : classique individuel. **Quiz** : privés (banque du formateur).
- **Notation** : exactitude **+** rapidité (réponse instantanée = points max ; au temps limite = la moitié) + bonus de série. Timing **autoritatif serveur**.
- **Participation** : invité (PIN + pseudo) **ou** connecté (SSO) — auth mixte.
- **Anti-triche** : la bonne réponse n'est **jamais** envoyée au client avant la révélation.

---

## 🧱 Stack technique (décisions arrêtées)

| Couche | Choix |
|--------|-------|
| Monorepo | **pnpm** workspaces (front + back + `@quiz-dock/contracts`) |
| Frontend | **React + Vite + TypeScript**, **shadcn/ui** + icônes **lucide-react**, **TanStack** Query/Form/Router/Table, client REST généré par **Orval** |
| Backend | **Node.js + TypeScript (NestJS)** + **Socket.IO** |
| Temps réel | Socket.IO + **adapter Redis** |
| État live | **Redis** (source de vérité pendant la partie) |
| Persistance | **PostgreSQL 16** (ORM Prisma), clés **ULID** |
| Auth | **OIDC (JWT)** — Keycloak en IdP de référence — `AUTH_MODE=none\|oidc` (auth facultative) |
| Médias | **Volume local** servi par le backend (self-hosted, sans service objet) |
| Sync front/back | OpenAPI auto (`@nestjs/swagger`) → **Orval** pour le REST ; package de contrats TS partagé pour le WebSocket |
| Conteneurs | **Docker Compose** (front, back, postgres, redis, keycloak, storage) |
| Tests | **Jest** (back) + **Vitest** (front) + Playwright (e2e) + k6 (charge) |
| CI | **GitHub Actions** ; git hooks **Husky** (pre-commit / commit-msg / pre-push) |

Détails et justifications : [SPECIFICATIONS.md §2](./SPECIFICATIONS.md).

---

## 🚀 Lancement (cible, une fois le code en place)

```bash
pnpm install                 # installe le monorepo + hooks Husky
docker compose up -d         # stack complète (dev)
# Front : http://localhost:5173   API : http://localhost:3000   Doc API : /api/docs
```

> En `AUTH_MODE=none`, le service Keycloak n'est pas démarré (profil Compose `keycloak`). Voir [SPECIFICATIONS.md §16](./SPECIFICATIONS.md).

---

## 🗺️ Périmètre v1 & au-delà

- **v1 (Must)** : builder quiz privés, tous types de questions, session live individuelle (lobby→podium), join invité/SSO, notation temps+série, restitution + export CSV.
- **Optionnel v1** : historique apprenant connecté, archivage, **mode capture intégrale** (audit/certification, avec avis aux apprenants).
- **Backlog** : mode équipes (v1.1), mode asynchrone/devoir (v1.2), partage/bibliothèque publique, dashboard admin agrégé, générateur d'avatars (multiavatar).

Détail : [SPECIFICATIONS-METIER.md §13](./SPECIFICATIONS-METIER.md).

---

## 📌 Conventions de documentation

- Une **décision arrêtée** est marquée comme telle ; les alternatives écartées sont conservées avec leur justification.
- Les **règles de gestion** sont numérotées `RG-xx` (référence rapide : [métier §12](./SPECIFICATIONS-METIER.md)).
- Les renvois inter-documents utilisent la forme `technique §N`, `métier §N`, `données §N`, `séquences §N`.
- Version courante des specs : **1.0 — 2026-06-09**.
