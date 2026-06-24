# Documentation (vivante)

> 👤 **Vous hébergez / configurez QuizDock ?** La doc **utilisateur / intégrateur**
> (installation, configuration, branding, OIDC) est dans
> [`self-hosting/`](self-hosting/README.md). Ce dossier-ci est pour les **contributeurs**.

Ce dossier contient la **documentation de développement**, tenue à jour **au fil du code** — par opposition au dossier [`../specifications/`](../specifications/README.md) qui fige la conception de référence par version.

> Règle (cf. specs technique §18) : à **chaque itération**, on **teste** et on **documente**. Toute évolution de comportement met à jour la doc concernée **dans le même commit/PR**.

## Que mettre ici

| Type | Exemple |
|------|---------|
| **ADR** (Architecture Decision Records) | `adr/0001-choix-nestjs.md` — décisions techniques datées et leur justification |
| **Guides développeur** | mise en route locale, conventions de code, workflow git/CI |
| **Doc d'API vivante** | notes complémentaires à l'OpenAPI généré, exemples d'usage |
| **Exploitation / runbook** | déploiement, variables d'env, sauvegarde/purge, incidents |
| **Notes de fonctionnalité** | comportement réel d'une feature livrée, écarts éventuels vs spec |
| **CHANGELOG** | (à la racine ou ici) historique des versions `0.x` |

## Différence specifications/ vs docs/

- **`specifications/`** = *ce qu'on a décidé de construire* (intention, figée et versionnée). Source de vérité de la conception.
- **`docs/`** = *comment c'est réellement fait et exploité* (état courant, évolutif). Source de vérité de l'implémentation.

Quand l'implémentation diverge volontairement d'une spec, on met à jour la spec **et** on note l'écart ici.

## Structure suggérée (à créer au besoin)

```
docs/
├── README.md
├── adr/                 # décisions d'architecture
├── dev/                 # guides développeur (setup, conventions)
├── api/                 # compléments à l'OpenAPI / contrat WS
└── ops/                 # runbook, déploiement, exploitation
```
